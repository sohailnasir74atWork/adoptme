// tradeHelpers pulls in Firebase, i18n and UI modules jest cannot load; the
// matcher under test uses none of them.
jest.mock('@react-native-firebase/database', () => ({}));
jest.mock('@react-native-firebase/firestore', () => ({}));
jest.mock('react-native-popup-menu', () => ({}));
jest.mock('react-native-vector-icons/Ionicons', () => () => null);
jest.mock('../Code/Helper/Environment', () => ({ colors: {} }));
jest.mock('../i18n', () => ({ t: (k) => k }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }));

const { tradeMatchesSearchWithVariants } = require('../Code/Trades/tradeHelpers');

// "Only this pet" (2026-11-20): a searched side must hold nothing but the pet.
const giraffe = { name: 'Giraffe' };
const owl = { name: 'Owl' };

describe('tradeMatchesSearchWithVariants onlyThis', () => {
  const both = { hasItems: [giraffe, owl], wantsItems: [giraffe] };
  it('keeps the old behaviour without onlyThis', () => {
    expect(tradeMatchesSearchWithVariants(both, 'giraffe', [], { inHas: true, inWants: false })).toBe(true);
  });
  it('rejects a side that has adds', () => {
    expect(tradeMatchesSearchWithVariants(both, 'giraffe', [], { inHas: true, inWants: false, onlyThis: true })).toBe(false);
  });
  it('accepts a side that is only the pet (twice is fine)', () => {
    expect(tradeMatchesSearchWithVariants(both, 'giraffe', [], { inHas: false, inWants: true, onlyThis: true })).toBe(true);
    expect(tradeMatchesSearchWithVariants({ hasItems: [giraffe, giraffe] }, 'giraffe', [], { onlyThis: true, inWants: false })).toBe(true);
  });
  it('rejects empty sides', () => {
    expect(tradeMatchesSearchWithVariants({ hasItems: [], wantsItems: [] }, 'giraffe', [], { onlyThis: true })).toBe(false);
  });
});
