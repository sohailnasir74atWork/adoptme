const admin = require("firebase-admin");
const functions = require("firebase-functions/v1");
const axios = require("axios");

admin.initializeApp();

exports.scheduledFunction = functions.pubsub
  .schedule("every 4 hours")
  .onRun(async (context) => {
    try {
      const response = await axios.get("https://elvebredd.com/api/pets/get-latest");

      if (!response.data || !response.data.pets) {
        console.error("❌ Invalid API response format.");
        return;
      }

      function safeParseJSON(str) {
        try {
          return JSON.parse(str);
        } catch (e) {
          console.error("❌ JSON parse failed:", e.message);
          return null;
        }
      }

      let rawPetsData = safeParseJSON(response.data.pets);
      if (!rawPetsData) {
        console.error("❌ Failed to decode pets JSON.");
        return;
      }
      
      // Convert object-with-numeric-keys to proper array
      if (!Array.isArray(rawPetsData) && typeof rawPetsData === "object") {
        rawPetsData = Object.values(rawPetsData);
      }
      
      console.log(`📦 Raw items count: ${Array.isArray(rawPetsData) ? rawPetsData.length : "Not an array"}`);

      // 🧹 Remove nulls and log count
      const nonNullItems = Array.isArray(rawPetsData)
        ? rawPetsData.filter((item, i) => {
            const isValid = item !== null && typeof item === "object" && Object.keys(item).length > 0;
            if (!isValid) console.log(`⚠️ Skipped invalid item at index ${i}: ${JSON.stringify(item)}`);
            return isValid;
          })
        : [];

      console.log(`✅ Valid items count after filtering: ${nonNullItems.length}`);

      // 🧼 Clean remaining objects
      const cleanedPetsData = nonNullItems.map(cleanObject);

      console.log(`🔍 Sample cleaned pet: ${cleanedPetsData[0]?.name || "N/A"}`);

      const normalizedNewData = normalizeForComparison(cleanedPetsData);

      const ref = admin.database().ref("xlsData");
      const snapshot = await ref.once("value");
      const firebaseRawData = snapshot.val() || {};
      const cleanedExistingData = cleanObject(firebaseRawData);
      const normalizedExistingData = normalizeForComparison(cleanedExistingData);

      logDifferences(normalizedExistingData, normalizedNewData);
      await ref.set(normalizedNewData);

      console.log("✅ Data pushed to Firebase successfully without root nulls.");

    } catch (error) {
      console.error("❌ Error during process:", error);
    }
  });

// 🧼 Cleaning helpers
function cleanObject(obj) {
  if (Array.isArray(obj)) return obj.map(cleanObject);
  if (typeof obj === "object" && obj !== null) {
    const cleaned = {};
    for (let key in obj) {
      let value = obj[key];
      const sanitizedKey = key.replace(/[.#$/\[\]]/g, "_");

      if (typeof value === "string" && value.trim().toLowerCase() === "true") value = true;
      if (typeof value === "string" && value.trim().toLowerCase() === "false") value = false;

      if (
        typeof value === "string" &&
        !isNaN(value) &&
        !["id", "name", "image", "rarity", "type", "categoryd", "categoryn", "categorym"].includes(key)
      ) {
        value = Number(value);
      }

      cleaned[sanitizedKey] = cleanObject(value);
    }
    return cleaned;
  }
  return obj;
}

function normalizeForComparison(obj) {
  if (Array.isArray(obj)) return obj.map(normalizeForComparison);
  if (typeof obj === "object" && obj !== null) {
    return Object.keys(obj)
      .sort()
      .reduce((sorted, key) => {
        sorted[key] = normalizeForComparison(obj[key]);
        return sorted;
      }, {});
  }
  return obj;
}

function logDifferences(oldData, newData, path = "") {
  for (const key in newData) {
    const fullPath = path ? `${path}.${key}` : key;
    if (!(key in oldData)) {
      console.log(`🆕 New key: ${fullPath}`);
    } else if (
      typeof newData[key] === "object" &&
      newData[key] !== null &&
      typeof oldData[key] === "object" &&
      oldData[key] !== null
    ) {
      logDifferences(oldData[key], newData[key], fullPath);
    } else if (newData[key] !== oldData[key]) {
      console.log(`🔁 Changed: ${fullPath}`);
    }
  }
}
