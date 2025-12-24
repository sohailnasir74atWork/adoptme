import { showMessage } from 'react-native-flash-message';

// Store the last shown messages and their timestamps
const messageHistory = new Map();
const DEBOUNCE_TIME = 2000; // 2 seconds debounce time (increased from 1.2s)
let currentlyVisibleMessage = null;
let clearVisibleMessageTimeout = null;

/**
 * Enhanced version of showMessage that prevents duplicate messages
 * and manages message history
 * 
 * @param {Object} options - The message options
 * @param {string} options.message - The message title
 * @param {string} [options.description] - The message description
 * @param {string} [options.type] - The message type (success, danger, warning, info)
 * @param {number} [options.duration] - How long to show the message (in ms)
 * @param {string} [options.id] - Unique identifier for the message
 */
export const showUniqueMessage = (options) => {
  const now = Date.now();
  const { message, description, type, duration, id } = options;
  
  // Normalize description (handle undefined/null)
  const normalizedDescription = description || '';
  
  // Create a unique key for the message
  const messageKey = `${message}-${normalizedDescription}-${type}`;
  
  // Check if this exact message is currently visible
  if (currentlyVisibleMessage === messageKey) {
    console.log('🚫 [MessageHelper] Duplicate message blocked (currently visible):', messageKey);
    return; // Skip if the same message is already visible
  }
  
  // Check if this message was shown recently
  const lastShown = messageHistory.get(messageKey);
  if (lastShown && (now - lastShown) < DEBOUNCE_TIME) {
    console.log('🚫 [MessageHelper] Duplicate message blocked (recent):', messageKey, `(${now - lastShown}ms ago)`);
    return; // Skip if shown within debounce time
  }
  
  // Clear any existing timeout
  if (clearVisibleMessageTimeout) {
    clearTimeout(clearVisibleMessageTimeout);
    clearVisibleMessageTimeout = null;
  }
  
  // Update the message history
  messageHistory.set(messageKey, now);
  
  // Set the currently visible message
  currentlyVisibleMessage = messageKey;
  
  // Clean up old messages from history (older than 10 seconds)
  for (const [key, timestamp] of messageHistory.entries()) {
    if (now - timestamp > 10000) {
      messageHistory.delete(key);
    }
  }
  
  // Calculate total duration (message duration + buffer)
  const messageDuration = duration || 3000;
  const totalDuration = messageDuration + 500; // Add 500ms buffer
  
  // Set timeout to clear currently visible message
  clearVisibleMessageTimeout = setTimeout(() => {
    if (currentlyVisibleMessage === messageKey) {
      currentlyVisibleMessage = null;
    }
    clearVisibleMessageTimeout = null;
  }, totalDuration);
  
  // Show the message with unique ID to prevent flash-message's own duplicates
  showMessage({
    message,
    description: normalizedDescription,
    type,
    duration: messageDuration,
    id: id || `msg-${messageKey}-${now}`, // More unique ID
    floating: true,
    onShow: () => {
      // Message is now visible
    },
    onHide: () => {
      // Clear when message is hidden
      if (currentlyVisibleMessage === messageKey) {
        currentlyVisibleMessage = null;
      }
      if (clearVisibleMessageTimeout) {
        clearTimeout(clearVisibleMessageTimeout);
        clearVisibleMessageTimeout = null;
      }
    }
  });
};

// Convenience methods for common message types
export const showSuccessMessage = (message, description) => {
  showUniqueMessage({ message, description, type: 'success' });
};

export const showErrorMessage = (message, description) => {
  showUniqueMessage({ message, description, type: 'danger' });
};

export const showWarningMessage = (message, description) => {
  showUniqueMessage({ message, description, type: 'warning' });
};

export const showInfoMessage = (message, description) => {
  showUniqueMessage({ message, description, type: 'info' });
}; 