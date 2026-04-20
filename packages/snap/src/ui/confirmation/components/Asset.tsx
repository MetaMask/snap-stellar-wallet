import type {
  ComponentOrElement,
  GetPreferencesResult,
} from '@metamask/snaps-sdk';
import { Box, Skeleton, Text as SnapText } from '@metamask/snaps-sdk/jsx';

import { AssetIcon } from './AssetIcon';
import { AssetText } from './AssetText';
import { formatFiat, tokenToFiat } from '../../../utils';

type AssetProps = {
  symbol: string;
  amount?: string;
  iconUrl?: string;
  price?: string | null;
  preferences?: GetPreferencesResult;
  priceLoading?: boolean;
  link?: string;
};

/**
 * Asset component for displaying assets with optional icon, amount, and price.
 * Pure component with no business logic - just visual display.
 *
 * @param props - The props for the asset component.
 * @returns The rendered asset element.
 */
export const Asset = (props: AssetProps): ComponentOrElement => {
  const { symbol, link, amount, iconUrl, price, preferences, priceLoading } =
    props;

  const fiatValue =
    preferences && price && amount !== undefined
      ? formatFiat(
          tokenToFiat(amount, price),
          preferences.currency,
          preferences.locale,
        )
      : '';

  const showPriceInfo = preferences !== undefined && amount !== undefined;
  const showSkeleton = showPriceInfo && priceLoading;
  const showFiat = showPriceInfo && !priceLoading && fiatValue;
  const assetText = amount === undefined ? symbol : `${amount} ${symbol}`;

  return (
    <Box direction="horizontal" alignment="center">
      {showSkeleton ? <Skeleton width={80} /> : null}
      {showFiat ? <SnapText color="muted">{fiatValue}</SnapText> : null}

      <Box alignment="center" center>
        <AssetIcon iconUrl={iconUrl} size="sm" />
      </Box>
      <AssetText aseset={assetText} link={link} />
    </Box>
  );
};
