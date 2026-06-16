import type {
  ComponentOrElement,
  GetPreferencesResult,
} from '@metamask/snaps-sdk';
import {
  Box,
  Icon,
  Image,
  Section,
  Text as SnapText,
  Tooltip,
} from '@metamask/snaps-sdk/jsx';
import { BigNumber } from 'bignumber.js';

import type {
  TransactionScanAssetChange,
  TransactionScanEstimatedChanges,
} from '../../../../services/transaction-scan';
import type { Locale } from '../../../../utils';
import { i18n } from '../../../../utils';

type EstimatedChangesProps = {
  changes: TransactionScanEstimatedChanges | null;
  preferences: GetPreferencesResult;
};

/**
 * Formats an estimated-change value without scientific notation.
 *
 * @param value - The human-readable asset amount, or null.
 * @returns The amount as a plain decimal string.
 */
function formatValue(value: number | null): string {
  return new BigNumber(value ?? 0).toFixed();
}

const AssetChangeRow = ({
  asset,
}: {
  asset: TransactionScanAssetChange;
}): ComponentOrElement => {
  const isOut = asset.type === 'out';
  return (
    <Box direction="horizontal" alignment="end" center>
      {asset.logo ? (
        <Image src={asset.logo} borderRadius="full" height={16} width={16} />
      ) : null}
      <SnapText color={isOut ? 'error' : 'success'}>
        {`${isOut ? '-' : '+'}${formatValue(asset.value)} ${asset.symbol}`}
      </SnapText>
    </Box>
  );
};

/**
 * Renders the signer's estimated balance changes (send / receive breakdown)
 * derived from the local on-chain simulation. Hidden entirely when there are no
 * modeled changes (for example Soroban invokes or unsupported transactions).
 *
 * @param props - The component props.
 * @param props.changes - The estimated changes, or null when unavailable.
 * @param props.preferences - Snap preferences (used for locale).
 * @returns The estimated-changes section, or null when there is nothing to show.
 */
export const EstimatedChanges = ({
  changes,
  preferences,
}: EstimatedChangesProps): ComponentOrElement | null => {
  const assets = changes?.assets ?? [];
  if (assets.length === 0) {
    return null;
  }

  const t = i18n(preferences.locale as Locale);
  const send = assets.filter((asset) => asset.type === 'out');
  const receive = assets.filter((asset) => asset.type === 'in');

  return (
    <Section>
      <Box direction="horizontal" alignment="start">
        <SnapText fontWeight="medium">
          {t('confirmation.estimatedChanges.title')}
        </SnapText>
        <Tooltip content={t('confirmation.estimatedChanges.tooltip')}>
          <Icon name="question" color="muted" />
        </Tooltip>
      </Box>
      {send.length > 0 ? (
        <Box alignment="space-between" direction="horizontal">
          <SnapText fontWeight="medium" color="alternative">
            {t('confirmation.estimatedChanges.send')}
          </SnapText>
          <Box direction="vertical" alignment="end">
            {send.map((asset) => (
              <AssetChangeRow asset={asset} />
            ))}
          </Box>
        </Box>
      ) : null}
      {receive.length > 0 ? (
        <Box alignment="space-between" direction="horizontal">
          <SnapText fontWeight="medium" color="alternative">
            {t('confirmation.estimatedChanges.receive')}
          </SnapText>
          <Box direction="vertical" alignment="end">
            {receive.map((asset) => (
              <AssetChangeRow asset={asset} />
            ))}
          </Box>
        </Box>
      ) : null}
    </Section>
  );
};
