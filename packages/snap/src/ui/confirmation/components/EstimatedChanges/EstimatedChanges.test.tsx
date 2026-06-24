import { EstimatedChanges } from './EstimatedChanges';
import { AssetChangeDirection } from '../../../../services/transaction-scan';
import { xlmIcon } from '../../../images';
import {
  defaultPreferences as preferences,
  getType,
} from '../../__fixtures__/confirmation.fixtures';
import { FetchStatus } from '../../api';

function collectImageSources(node: unknown): unknown[] {
  if (!node || typeof node !== 'object') {
    return [];
  }

  const element = node as {
    type?: string;
    props?: { src?: unknown; children?: unknown };
  };
  const sources = element.type === 'Image' ? [element.props?.src] : [];
  const children = element.props?.children;

  if (Array.isArray(children)) {
    return [
      ...sources,
      ...children.flatMap((child) => collectImageSources(child)),
    ];
  }

  return [...sources, ...collectImageSources(children)];
}

describe('EstimatedChanges', () => {
  const xlmOut = {
    type: AssetChangeDirection.Out,
    value: 10,
    price: null,
    symbol: 'XLM',
    name: 'XLM',
    logo: null,
  };
  const usdcIn = {
    type: AssetChangeDirection.In,
    value: 5,
    price: null,
    symbol: 'USDC',
    name: 'USDC',
    logo: 'https://example.com/usdc.png',
  };

  it('renders a skeleton while the remote scan is fetching', () => {
    const component = EstimatedChanges({
      changes: { assets: [xlmOut] },
      preferences,
      scanFetchStatus: FetchStatus.Fetching,
    });

    expect(JSON.stringify(component)).toContain('"type":"Skeleton"');
    expect(JSON.stringify(component)).not.toContain('-10 XLM');
  });

  it('shows not available when the remote scan errors', () => {
    const component = EstimatedChanges({
      changes: { assets: [xlmOut] },
      preferences,
      scanFetchStatus: FetchStatus.Error,
    });

    expect(JSON.stringify(component)).toContain(
      'Estimated changes are not available',
    );
  });

  it('shows no changes when fetched with empty assets', () => {
    const component = EstimatedChanges({
      changes: { assets: [] },
      preferences,
      scanFetchStatus: FetchStatus.Fetched,
    });

    expect(JSON.stringify(component)).toContain('No estimated changes');
  });

  it('renders a section containing the send and receive assets once fetched', () => {
    const component = EstimatedChanges({
      changes: { assets: [xlmOut, usdcIn] },
      preferences,
      scanFetchStatus: FetchStatus.Fetched,
    });

    expect(getType(component)).toBe('Section');

    const serialized = JSON.stringify(component);
    const imageSources = collectImageSources(component);
    // Outflows render in red with a leading "-", inflows in green with "+".
    expect(serialized).toContain('-10 XLM');
    expect(serialized).toContain('+5 USDC');
    expect(imageSources).toContain(xlmIcon);
    expect(serialized).toContain(usdcIn.logo);
    expect(serialized).toContain('"color":"error"');
    expect(serialized).toContain('"color":"success"');
  });
});
