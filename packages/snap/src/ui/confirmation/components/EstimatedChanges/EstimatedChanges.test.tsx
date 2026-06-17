import { EstimatedChanges } from './EstimatedChanges';
import {
  defaultPreferences as preferences,
  getType,
} from '../../__fixtures__/confirmation.fixtures';

describe('EstimatedChanges', () => {
  const xlmOut = {
    type: 'out' as const,
    value: 10,
    price: null,
    symbol: 'XLM',
    name: 'XLM',
    logo: null,
  };
  const usdcIn = {
    type: 'in' as const,
    value: 5,
    price: null,
    symbol: 'USDC',
    name: 'USDC',
    logo: 'https://example.com/usdc.png',
  };

  it('returns null when there are no asset changes', () => {
    expect(
      EstimatedChanges({ changes: { assets: [] }, preferences }),
    ).toBeNull();
  });

  it('returns null when changes is null', () => {
    expect(EstimatedChanges({ changes: null, preferences })).toBeNull();
  });

  it('renders a section containing the send and receive assets', () => {
    const component = EstimatedChanges({
      changes: { assets: [xlmOut, usdcIn] },
      preferences,
    });

    expect(getType(component)).toBe('Section');

    const serialized = JSON.stringify(component);
    // Outflows render in red with a leading "-", inflows in green with "+".
    expect(serialized).toContain('-10 XLM');
    expect(serialized).toContain('+5 USDC');
    expect(serialized).toContain('"color":"error"');
    expect(serialized).toContain('"color":"success"');
  });
});
