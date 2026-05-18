import { Animated, Easing } from 'react-native';

// Singleton shimmer driver. One Animated.Value, one Animated.loop, started
// the first time anyone asks for it and kept running for the lifetime of
// the app. Every shimmer pill in the app subscribes to this same value, so
// 1 pill or 50 pills cost identically — and they all animate in sync.
//
// useNativeDriver: true → the timing loop is driven on the UI thread by
// native code. The JS thread does zero work per frame, no bridge calls,
// no re-renders. Native compositor handles the transform interpolation.
//
// Memory cost: ~one Animated.Value (a few bytes of native state) for the
// whole app, regardless of how many pills are mounted.

let _value = null;
let _started = false;

const DURATION_MS = 1600; // full loop period — flash every ~1.6s

export const getShimmerValue = () => {
  if (!_value) _value = new Animated.Value(0);
  if (!_started) {
    _started = true;
    Animated.loop(
      Animated.timing(_value, {
        toValue: 1,
        duration: DURATION_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  }
  return _value;
};
