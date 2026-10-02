// Country flags are a moderation aid, not a public badge (2026-10-03).
//
// Where they come from: the device region (CountryCheck.getFlag), saved to
// users/{uid}/flage for every signed-in user by the effect in GlobelStats.js
// and refreshed whenever the device region changes. There is no user switch.
//
// Where they show: exactly one place, the profile bottom drawer
// (Code/ChatScreen/GroupChat/BottomDrawer.jsx), and only when the viewer is an
// admin. No other screen renders them, and messages, posts and trades no
// longer carry a copy.
export const canSeeCountryFlags = (isAdmin) => !!isAdmin;
