/**
 * The admin's "Links & emails in chat" switch (RTDB /links_allowed →
 * Helper/linksSwitch.js). While it is on, validateContent lets links and
 * email addresses through for everyone; profanity is still rejected.
 */
jest.mock('../i18n', () => ({ t: (k) => k }));

import { validateContent, containsLink } from '../Code/Helper/ContentModeration';
import { setLinksAllowed, areLinksAllowed } from '../Code/Helper/linksSwitch';

describe('links switch', () => {
  afterEach(() => setLinksAllowed(false));

  test('off by default: links and emails are rejected as links', () => {
    expect(areLinksAllowed()).toBe(false);
    expect(containsLink('mail me at kid@gmail.com')).toBe(true);
    expect(validateContent('mail me at kid@gmail.com')).toMatchObject({ isValid: false, category: 'link' });
    expect(validateContent('join example.gg/abc')).toMatchObject({ isValid: false, category: 'link' });
    // Off-platform handles are a separate, kid-safety blocklist category; the
    // links switch does not touch them (see blocklist.js OFF-PLATFORM CONTACT).
    expect(validateContent('join discord.gg/abc')).toMatchObject({ isValid: false, category: 'offplatform' });
    expect(validateContent('trade me a frost dragon').isValid).toBe(true);
  });

  test('on: links and emails pass for everyone, other checks still run', () => {
    setLinksAllowed(true);
    expect(validateContent('mail me at kid@gmail.com').isValid).toBe(true);
    expect(validateContent('see https://example.com/trade').isValid).toBe(true);
    expect(validateContent('fuck https://example.com').isValid).toBe(false);
    expect(validateContent('add me on discord').isValid).toBe(false);
  });

  test('skipLinkCheck still works while the switch is off', () => {
    expect(validateContent('see https://example.com', { skipLinkCheck: true }).isValid).toBe(true);
  });

  test('only an explicit true turns it on', () => {
    setLinksAllowed('true'); expect(areLinksAllowed()).toBe(false);
    setLinksAllowed(1); expect(areLinksAllowed()).toBe(false);
    setLinksAllowed(null); expect(areLinksAllowed()).toBe(false);
    setLinksAllowed(true); expect(areLinksAllowed()).toBe(true);
    setLinksAllowed(false); expect(areLinksAllowed()).toBe(false);
  });
});
