import type {
  ComponentOrElement,
  GetPreferencesResult,
} from '@metamask/snaps-sdk';
import {
  Box,
  Icon,
  Image,
  Section,
  Skeleton,
  Text as SnapText,
  Tooltip,
} from '@metamask/snaps-sdk/jsx';
import { BigNumber } from 'bignumber.js';

import { NATIVE_ASSET_SYMBOL } from '../../../../constants';
import type {
  TransactionScanAssetChange,
  TransactionScanEstimatedChanges,
} from '../../../../services/transaction-scan';
import type { Locale } from '../../../../utils';
import { i18n } from '../../../../utils';
import { xlmIcon } from '../../../images';
import { FetchStatus } from '../../api';
import { isFetchStatusLoadingOrFetching } from '../../utils';

type EstimatedChangesProps = {
  changes: TransactionScanEstimatedChanges | null;
  preferences: GetPreferencesResult;
  scanFetchStatus: FetchStatus;
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

const EstimatedChangesHeader = ({
  preferences,
}: {
  preferences: GetPreferencesResult;
}): ComponentOrElement => {
  const t = i18n(preferences.locale as Locale);

  return (
    <Box direction="horizontal" alignment="start">
      <SnapText fontWeight="medium">
        {t('confirmation.estimatedChanges.title')}
      </SnapText>
      <Tooltip content={t('confirmation.estimatedChanges.tooltip')}>
        <Icon name="question" color="muted" />
      </Tooltip>
    </Box>
  );
};

const EstimatedChangesSkeleton = ({
  preferences,
}: {
  preferences: GetPreferencesResult;
}): ComponentOrElement => {
  return (
    <Section direction="vertical">
      <EstimatedChangesHeader preferences={preferences} />
      <Box alignment="space-between" direction="horizontal">
        <Skeleton width={60} />
        <Skeleton width={100} />
      </Box>
    </Section>
  );
};

/**
 * Renders one asset-change row.
 *
 * @param props - The component props.
 * @param props.asset - The asset change to render.
 * @returns The row element.
 */
const AssetChangeRow = ({
  asset,
}: {
  asset: TransactionScanAssetChange;
}): ComponentOrElement => {
  const isOut = asset.type === 'out';
  const iconSrc =
    asset.logo ?? (asset.symbol === NATIVE_ASSET_SYMBOL ? xlmIcon : null);

  return (
    <Box direction="horizontal" alignment="end" center>
      {iconSrc ? (
        <Image src={iconSrc} borderRadius="full" height={16} width={16} />
      ) : null}
      <SnapText color={isOut ? 'error' : 'success'}>
        {`${isOut ? '-' : '+'}${formatValue(asset.value)} ${asset.symbol}`}
      </SnapText>
    </Box>
  );
};

/**
 * Renders the signer's estimated balance changes (send / receive breakdown).
 * Shows a loading skeleton while the remote scan is in flight, then the best
 * available estimate (Blockaid when displayable, otherwise the local fallback).
 *
 * @param props - The component props.
 * @param props.changes - The estimated changes, or null when unavailable.
 * @param props.preferences - Snap preferences (used for locale).
 * @param props.scanFetchStatus - Latest remote scan fetch status.
 * @returns The estimated-changes section.
 */
export const EstimatedChanges = ({
  changes,
  preferences,
  scanFetchStatus,
}: EstimatedChangesProps): ComponentOrElement => {
  const t = i18n(preferences.locale as Locale);
  const isFetching = isFetchStatusLoadingOrFetching(scanFetchStatus);
  const isFetched = scanFetchStatus === FetchStatus.Fetched;
  const isFetchError = scanFetchStatus === FetchStatus.Error;

  if (isFetching) {
    return <EstimatedChangesSkeleton preferences={preferences} />;
  }

  if (isFetchError) {
    return (
      <Section direction="vertical">
        <EstimatedChangesHeader preferences={preferences} />
        <SnapText color="alternative">
          {t('confirmation.estimatedChanges.notAvailable')}
        </SnapText>
      </Section>
    );
  }

  const send = changes?.assets.filter((asset) => asset.type === 'out') ?? [];
  const receive = changes?.assets.filter((asset) => asset.type === 'in') ?? [];
  const hasChanges = send.length > 0 || receive.length > 0;

  if (isFetched && !hasChanges) {
    return (
      <Section direction="vertical">
        <EstimatedChangesHeader preferences={preferences} />
        <SnapText color="alternative">
          {t('confirmation.estimatedChanges.noChanges')}
        </SnapText>
      </Section>
    );
  }

  return (
    <Section>
      <EstimatedChangesHeader preferences={preferences} />
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
