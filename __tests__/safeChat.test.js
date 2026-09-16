import { ageFromDob, isMinorDob, resolveSafeChat, MINOR_AGE_THRESHOLD } from '../Code/Helper/ageGate';
import {
  SAFE_TEMPLATES,
  TEMPLATE_BY_ID,
  TEMPLATE_ID_BY_TEXT,
  GAME_ID_TEMPLATE_ID,
  isValidGameId,
  isAllowedSafeMessage,
} from '../Code/ChatScreen/safeTemplates';
import en from '../Code/Translation/en.json';

// Fixed "today" so a birthday-boundary test doesn't start failing next year.
const NOW = new Date('2026-09-16T12:00:00Z');
beforeAll(() => { jest.useFakeTimers().setSystemTime(NOW); });
afterAll(() => { jest.useRealTimers(); });

const dobForAge = (years, offsetDays = 0) => {
  const d = new Date(NOW);
  d.setFullYear(d.getFullYear() - years);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

describe('ageFromDob', () => {
  test('counts whole years', () => {
    expect(ageFromDob(dobForAge(20))).toBe(20);
    expect(ageFromDob(dobForAge(13))).toBe(13);
  });

  test('flips exactly on the birthday, not before', () => {
    expect(ageFromDob(dobForAge(13, 1))).toBe(12);   // birthday is tomorrow
    expect(ageFromDob(dobForAge(13, 0))).toBe(13);   // birthday is today
  });

  test('returns null rather than throwing on junk', () => {
    ['', null, undefined, 'not-a-date', '20260916', '2026/09/16', {}, 42]
      .forEach((bad) => expect(ageFromDob(bad)).toBeNull());
  });

  test('returns null for a future date', () => {
    expect(ageFromDob('2030-01-01')).toBeNull();
  });
});

describe('isMinorDob', () => {
  test('under the threshold is a minor', () => {
    expect(isMinorDob(dobForAge(MINOR_AGE_THRESHOLD - 1))).toBe(true);
    expect(isMinorDob(dobForAge(7))).toBe(true);
  });

  test('at or over the threshold is not', () => {
    expect(isMinorDob(dobForAge(MINOR_AGE_THRESHOLD))).toBe(false);
    expect(isMinorDob(dobForAge(30))).toBe(false);
  });

  // Fails OPEN on purpose — see the comment on isMinorDob. The Postgres
  // trigger is the gate that actually protects the child.
  test('unknown DOB is not treated as a minor', () => {
    expect(isMinorDob(null)).toBe(false);
    expect(isMinorDob('garbage')).toBe(false);
  });
});

describe('resolveSafeChat', () => {
  const adult = dobForAge(25);
  const kid = dobForAge(9);

  test('either side under age restricts the thread', () => {
    expect(resolveSafeChat(kid, adult)).toBe('me');
    expect(resolveSafeChat(adult, kid)).toBe('them');
    expect(resolveSafeChat(kid, kid)).toBe('both');
  });

  test('two adults are unrestricted', () => {
    expect(resolveSafeChat(adult, adult)).toBeNull();
  });
});

describe('template catalogue', () => {
  test('ids and canonical texts are unique', () => {
    const ids = new Set(SAFE_TEMPLATES.map((t) => t.id));
    const texts = new Set(SAFE_TEMPLATES.map((t) => t.en));
    expect(ids.size).toBe(SAFE_TEMPLATES.length);
    expect(texts.size).toBe(SAFE_TEMPLATES.length);
  });

  test('every template has English copy under its i18n key', () => {
    const missing = SAFE_TEMPLATES
      .filter((t) => !en.chat[t.key.replace('chat.', '')])
      .map((t) => t.id);
    expect(missing).toEqual([]);
  });

  test('no id collides with the reserved game-ID id', () => {
    expect(TEMPLATE_BY_ID[GAME_ID_TEMPLATE_ID]).toBeUndefined();
  });

  test('lookups round-trip', () => {
    SAFE_TEMPLATES.forEach((t) => {
      expect(TEMPLATE_BY_ID[t.id]).toBe(t);
      expect(TEMPLATE_ID_BY_TEXT[t.en]).toBe(t.id);
    });
  });
});

describe('isValidGameId', () => {
  test('accepts real Roblox username shapes', () => {
    ['Builderman', 'a_b', 'Player123', 'x1_y', 'abc', 'A'.repeat(20)]
      .forEach((u) => expect(isValidGameId(u)).toBe(true));
  });

  test('rejects anything that could carry a sentence or contact detail', () => {
    [
      'ab',                       // too short
      'A'.repeat(21),             // too long
      '_lead', 'trail_',          // underscore at an edge
      'a__b', 'a_b_c',            // more than one underscore
      'hi there',                 // whitespace
      'add.me', 'a-b', 'a@b',     // punctuation
      'http://x.co',
      '', null, undefined,
    ].forEach((u) => expect(isValidGameId(u)).toBe(false));
  });
});

describe('isAllowedSafeMessage', () => {
  const tpl = SAFE_TEMPLATES[0];

  test('accepts a template whose text matches its id', () => {
    expect(isAllowedSafeMessage(tpl.id, tpl.en)).toBe(true);
  });

  test('rejects free text wearing a template id', () => {
    expect(isAllowedSafeMessage(tpl.id, 'what is your address')).toBe(false);
  });

  test('rejects a template id that does not exist', () => {
    expect(isAllowedSafeMessage('no_such_template', 'anything')).toBe(false);
  });

  test('rejects text with no id at all', () => {
    expect(isAllowedSafeMessage(null, tpl.en)).toBe(false);
    expect(isAllowedSafeMessage('', tpl.en)).toBe(false);
  });

  test('accepts a valid game ID and rejects a smuggled one', () => {
    expect(isAllowedSafeMessage(GAME_ID_TEMPLATE_ID, 'Builderman')).toBe(true);
    expect(isAllowedSafeMessage(GAME_ID_TEMPLATE_ID, 'call me on 5551234')).toBe(false);
  });
});
