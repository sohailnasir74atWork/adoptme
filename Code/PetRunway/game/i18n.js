// ---------- Text and settings from the app ----------
// The app writes window.__RW_INIT into the page before this script (see Code/PetRunway/runwayBridge.js):
// language strings (Code/Translation/*.json → "pet_runway"), saved cards, insets, Pro, nickname.
// English stays in the code as the fallback, so the page also works on its own in a browser.
const INIT = window.__RW_INIT || {};
const STR = INIT.strings || {};
const T = (k, d) => STR[k] || d;
const Tf = (k, d, vars) => T(k, d).replace(/\{(\w+)\}/g, (_, n) => (vars[n] ?? ''));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Letters the title fonts lack (Arabic, Cyrillic, Korean) fall back to the phone's own font.
const FALLBACK_FONT = "'Nunito', system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif";
// Messages to the app (react-native-webview); nothing when opened in a plain browser.
const post = msg => { try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch (_) {} };
