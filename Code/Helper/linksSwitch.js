/**
 * linksSwitch.js — the global "links & emails allowed in chat" switch.
 *
 * Source of truth is RTDB /links_allowed (Admin Dashboard → Restrictions).
 * GlobelStats live-subscribes to that leaf and calls setLinksAllowed();
 * ContentModeration.validateContent reads areLinksAllowed() and skips its
 * link check while the switch is on, so every chat input (group, private,
 * design comments) lets players share emails, Discord invites and other
 * links without each call site being rewired. Staff are never blocked
 * either way (they pass skipLinkCheck / skipAll).
 *
 * Default OFF (links blocked, YouTube/TikTok only); only an explicit `true`
 * turns it on. No imports on purpose, so GlobelStats and ContentModeration
 * can both require it without a cycle.
 */
let linksAllowed = false;

export const setLinksAllowed = (value) => { linksAllowed = value === true; };
export const areLinksAllowed = () => linksAllowed;
