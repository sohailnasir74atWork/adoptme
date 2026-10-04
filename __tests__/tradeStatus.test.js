const { tradeStatus, valueGap } = require('../Code/Helper/tradeStatus');

describe('tradeStatus (give, get)', () => {
  it('is fair within 5% either way, 5% itself included', () => {
    expect(tradeStatus(100, 100)).toBe('fair');
    expect(tradeStatus(100, 103)).toBe('fair');
    expect(tradeStatus(100, 95)).toBe('fair');
    expect(tradeStatus(95, 100)).toBe('fair');
  });

  it('wins or loses past 5%', () => {
    expect(tradeStatus(100, 106)).toBe('win');
    expect(tradeStatus(100, 94)).toBe('lose');
    expect(tradeStatus(10, 0)).toBe('lose');
    expect(tradeStatus(0, 10)).toBe('win');
  });

  it('treats empty and junk totals as zero', () => {
    expect(tradeStatus(0, 0)).toBe('fair');
    expect(tradeStatus(undefined, '12')).toBe('win');
    expect(valueGap(0, 0)).toBe(0);
  });
});
