// Tiny UUIDv4 generator. Avoids pulling `react-native-uuid` / `uuid` just
// for client_msg_id. Not cryptographically strong — fine for
// idempotency-key use where collision risk only needs to be "effectively
// zero within one user's session."
export function uuidv4() {
  // RFC4122-ish: 8-4-4-4-12 hex with version (4) and variant (8/9/a/b) bits.
  let d = Date.now();
  if (typeof performance !== 'undefined' && performance.now) {
    d += performance.now();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (d + Math.random() * 16) % 16 | 0;
    d = Math.floor(d / 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
