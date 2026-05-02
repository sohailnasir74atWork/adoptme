// Analytics removed. Wrapper kept as a no-op so the ~33 existing
// `mixpanel.track(...)` call sites compile and run without edits.
// Safe to delete this file and remove imports if/when those call sites
// are cleaned up.

export const mixpanel = {
  track: () => {},
};
