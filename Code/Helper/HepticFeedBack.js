import { useCallback } from 'react';
import HapticFeedback from 'react-native-haptic-feedback';
import { useLocalState } from '../LocalGlobelStats';

export const useHaptic = () => {
  const { localState } = useLocalState(); // Access global state

  // Function to trigger haptic feedback - use useCallback to ensure it reads current isHaptic value
  const triggerHapticFeedback = useCallback((type = 'impactLight') => {
    // ✅ Check isHaptic setting in real-time (not captured in closure)
    if (!localState?.isHaptic) return; // Exit if haptics are disabled or not defined

    const options = {
      enableVibrateFallback: true, // Fallback to vibration if haptics aren't supported
      ignoreAndroidSystemSettings: true, // Respect system-level haptic settings
    };

    HapticFeedback.trigger(type, options);
  }, [localState?.isHaptic]); // ✅ Re-create function when isHaptic changes

  return { triggerHapticFeedback };
};
