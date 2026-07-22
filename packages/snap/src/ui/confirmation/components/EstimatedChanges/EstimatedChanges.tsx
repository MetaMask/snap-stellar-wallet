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

import { NATIVE_ASSET_SYMBOL } from '../../../../constants';
import { AssetChangeDirection } from '../../../../services/transaction-scan';
import type {
  TransactionScanAssetChange,
  TransactionScanEstimatedChanges,
} from '../../../../services/transaction-scan';
import { i18n } from '../../../../utils';
import { xlmIcon } from '../../../images';
import { FetchStatus } from '../../api';
import { isFetchInProgress } from '../../utils';

type EstimatedChangesProps = {
  changes: TransactionScanEstimatedChanges | null;
  preferences: GetPreferencesResult;
  scanFetchStatus: FetchStatus;
};

/**
 * Resolves the text color for an estimated-change row.
 *
 * @param isUnknownValue - True when the amount could not be determined.
 * @param isOut - True for an outflow row.
 * @returns The SnapText color: neutral for unknown, red for out, green for in.
 */
function resolveRowColor(
  isUnknownValue: boolean,
  isOut: boolean,
): 'alternative' | 'error' | 'success' {
  if (isUnknownValue) {
    return 'alternative';
  }
  return isOut ? 'error' : 'success';
}

/**
 * Builds a stable list key for an estimated-change row.
 *
 * @param asset - The asset change row.
 * @param index - The row index within its send/receive group.
 * @returns A stable key for JSX list rendering.
 */
function getAssetChangeKey(
  asset: TransactionScanAssetChange,
  index: number,
): string {
  return `${asset.type}-${asset.symbol}-${asset.value ?? 'unknown'}-${index}`;
}

const EstimatedChangesHeader = ({
  preferences,
}: {
  preferences: GetPreferencesResult;
}): ComponentOrElement => {
  const t = i18n(preferences.locale);

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
  const isOut = asset.type === AssetChangeDirection.Out;
  const iconSrc =
    asset.logo ?? (asset.symbol === NATIVE_ASSET_SYMBOL ? xlmIcon : null);

  // A null value means the amount is unknown (e.g. a contract token Blockaid
  // cannot quantify); render a neutral placeholder rather than a misleading 0.
  const isUnknownValue = asset.value === null;
  const label = isUnknownValue
    ? `– ${asset.symbol}`
    : `${isOut ? '-' : '+'}${asset.value} ${asset.symbol}`;
  const color = resolveRowColor(isUnknownValue, isOut);

  return (
    <Box direction="horizontal" alignment="end" center>
      {iconSrc ? (
        <Image src={iconSrc} borderRadius="full" height={16} width={16} />
      ) : null}
      <SnapText color={color}>{label}</SnapText>
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
  const t = i18n(preferences.locale);
  const isFetching = isFetchInProgress(scanFetchStatus);
  const isFetched = scanFetchStatus === FetchStatus.Fetched;
  const isFetchError = scanFetchStatus === FetchStatus.Error;
  // Locally-seeded rows (send flow) are final regardless of the remote scan, so
  // keep them visible instead of replacing them with the loading/error chrome
  // that the remote scan status would otherwise drive.
  const hasSeededRows = (changes?.assets.length ?? 0) > 0;

  if (isFetching && !hasSeededRows) {
    return <EstimatedChangesSkeleton preferences={preferences} />;
  }

  if (isFetchError && !hasSeededRows) {
    return (
      <Section direction="vertical">
        <EstimatedChangesHeader preferences={preferences} />
        <SnapText color="alternative">
          {t('confirmation.estimatedChanges.notAvailable')}
        </SnapText>
      </Section>
    );
  }

  const send =
    changes?.assets.filter(
      (asset) => asset.type === AssetChangeDirection.Out,
    ) ?? [];
  const receive =
    changes?.assets.filter((asset) => asset.type === AssetChangeDirection.In) ??
    [];
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
            {send.map((asset, index) => (
              <Box key={getAssetChangeKey(asset, index)}>
                <AssetChangeRow asset={asset} />
              </Box>
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
            {receive.map((asset, index) => (
              <Box key={getAssetChangeKey(asset, index)}>
                <AssetChangeRow asset={asset} />
              </Box>
            ))}
          </Box>
        </Box>
      ) : null}
    </Section>
  );
};
