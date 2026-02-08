export const isMatch = (name, query) => {
    // Empty query matches all items
    if (!query || query.trim() === '') return true;
    if (!name) return false;
    const lowerName = name.toLowerCase();
    const lowerQuery = query.toLowerCase();

    // 1. Standard search: name includes query
    if (lowerName.includes(lowerQuery)) return true;

    // 2. Acronym search
    // Split by space, hyphen, or underscore to get words
    const words = lowerName.split(/[\s-_]+/);
    // Get first character of each word
    const acronym = words.map(w => w[0]).join('');

    // Check if query matches the start of the acronym or is included in it
    // The user requirement said: "if user search with name ldl then it show too...lie 1st char of each"
    return acronym.includes(lowerQuery);
};
