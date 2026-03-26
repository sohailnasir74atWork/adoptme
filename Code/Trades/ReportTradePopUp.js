import React, { useState, useMemo } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useGlobalState } from "../GlobelStats";
import config from "../Helper/Environment";
import { ref, push } from "@react-native-firebase/database";
import { useTranslation } from "react-i18next";

const ReportTradePopup = ({ visible, trade, onClose }) => {
  const [selectedReason, setSelectedReason] = useState("Inappropriate");
  const [customReason, setCustomReason] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [loading, setLoading] = useState(false);
  const { theme, user, appdatabase } = useGlobalState();
  const { t } = useTranslation();
  const isDarkMode = theme === "dark";

  const handleSubmit = () => {
    if (showCustomInput && !customReason.trim()) {
      Alert.alert(t("home.alert.error"), t("trade.report.reason_required"));
      return;
    }

    if (!trade?.id) {
      Alert.alert(t("home.alert.error"), t("trade.report.invalid_trade"));
      return;
    }

    setLoading(true);


    const reportsRef = ref(appdatabase, "tradeReports"); // New node for trade reports
    const reportData = {
      tradeId: trade.id,
      reportedBy: user?.id,
      reason: showCustomInput ? customReason : selectedReason,
      timestamp: Date.now(),
    };

    push(reportsRef, reportData)
      .then(() => {
        setLoading(false); // Stop loader
        Alert.alert(
          t("trade.report.success_title"),
          `${t("trade.report.trade_id_label")}${trade.id}\n${t("trade.report.reason_label") || "Reason"}: ${showCustomInput ? customReason : selectedReason
          }\n${t("trade.report.success_message")}`
        );
        onClose(true); // Indicate success
      })
      .catch((error) => {
        console.error("Error reporting trade:", error);
        setLoading(false); // Stop loader
        Alert.alert(t("home.alert.error"), t("trade.report.submit_error"));
      });
  };

  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.popup}>
          <Text style={styles.title}>{t("trade.report.title")}</Text>
          <Text style={styles.messageText}>{`${t("trade.report.trade_id_label")}${trade?.id || t("profile.anonymous")}`}</Text>
          <Text style={styles.messageText}>{`${t("trade.report.trader_label")}${trade?.traderName || t("profile.anonymous")}`}</Text>

          <View style={styles.optionsContainer}>
            {["Inappropriate", "Fraud"].map((reason) => {
              const reasonKey = reason === "Inappropriate" ? "trade.report.reason_inappropriate" : "trade.report.reason_fraud";
              return (
                <TouchableOpacity
                  key={reason}
                  style={[
                    styles.option,
                    selectedReason === reason && styles.selectedOption,
                  ]}
                  onPress={() => {
                    setSelectedReason(reason);
                    setShowCustomInput(false);
                  }}
                >
                  <Text
                    style={[
                      styles.optionText,
                      selectedReason === reason && styles.selectedOptionText,
                    ]}
                  >
                    {t(reasonKey)}
                  </Text>
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              style={[
                styles.option,
                showCustomInput && styles.selectedOption,
              ]}
              onPress={() => setShowCustomInput(true)}
            >
              <Text
                style={[
                  styles.optionText,
                  showCustomInput && styles.selectedOptionText,
                ]}
              >
                {t("trade.report.reason_other")}
              </Text>
            </TouchableOpacity>
          </View>

          {showCustomInput && (
            <TextInput
              style={styles.input}
              placeholder={t("trade.report.custom_reason_placeholder")}
              placeholderTextColor="#888"
              value={customReason}
              onChangeText={setCustomReason}
            />
          )}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.button} onPress={onClose}>
              <Text style={styles.buttonText}>{t("trade.report.button_cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.button,
                { backgroundColor: config.colors.hasBlockGreen },
              ]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{t("trade.report.button_submit")}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const getStyles = (isDarkMode) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "center",
      alignItems: "center",
    },
    popup: {
      width: "90%",
      backgroundColor: isDarkMode ? "#0f172a" : "#f2f2f7",
      borderRadius: 10,
      padding: 20,
      elevation: 5,
    },
    title: {
      fontSize: 18,
      fontWeight: 'bold',
      marginBottom: 10,
      color: isDarkMode ? "white" : "black",
    },
    messageText: {
      fontSize: 14,
      color: isDarkMode ? "white" : "black",
      marginBottom: 15,
    },
    optionsContainer: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginBottom: 10,
    },
    option: {
      paddingHorizontal: 3,
      backgroundColor: "#ddd",
      borderRadius: 10,
      marginRight: 10,
      marginBottom: 10,
    },
    selectedOption: {
      borderColor: config.colors.primary,
      backgroundColor: config.colors.hasBlockGreen,
    },
    optionText: {
      fontSize: 14,
      color: isDarkMode ? "#888" : "#444",
      paddingHorizontal: 5,
    },
    selectedOptionText: {
      color: "white",
    },
    input: {
      borderWidth: 1,
      borderColor: "#ddd",
      borderRadius: 5,
      padding: 5,
      marginTop: 10,
    },
    actions: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 15,
    },
    button: {
      paddingVertical: 5,
      paddingHorizontal: 20,
      backgroundColor: config.colors.primary,
      borderRadius: 5,
    },
    buttonText: {
      color: "white",
      fontSize: 16,
    },
  });

export default ReportTradePopup;
