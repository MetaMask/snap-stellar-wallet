import type { ComponentOrElement } from '@metamask/snaps-sdk';
import {
  Address,
  Box,
  Container,
  Heading,
  Icon,
  Image,
  Section,
  Text as SnapText,
  Tooltip,
} from '@metamask/snaps-sdk/jsx';
import { parseCaipAssetType } from '@metamask/utils';

import { ConfirmSignChangeTrustOptOutFormNames } from './events';
import type { StellarKeyringAccount } from '../../../../services/account';
import type { StellarAssetMetadata } from '../../../../services/asset-metadata';
import { i18n } from '../../../../utils';
import { STELLAR_IMAGE } from '../../../images/icon';
import type {
  ConfirmationBaseProps,
  ContextWithPrices,
  FeeData,
} from '../../api';
import { FetchStatus } from '../../api';
import {
  Asset,
  AssetIcon,
  ConfirmationAlerts,
  ConfirmationFooter,
  FeeRow,
} from '../../components';
import {
  getAccountName,
  getClassicAssetExplorerUrl,
  getNetworkName,
  requiresMaliciousAcknowledgement,
  shouldDisableConfirmation,
} from '../../utils';

export type ConfirmSignChangeTrustOptOutProps = ConfirmationBaseProps &
  ContextWithPrices & {
    account: StellarKeyringAccount;
    assetMetadata: StellarAssetMetadata;
    feeData: FeeData;
  };

export const ConfirmSignChangeTrustOptOut = ({
  account,
  scope,
  assetMetadata,
  locale,
  networkImage,
  feeData,
  tokenPrices,
  origin,
  preferences,
  tokenPricesFetchStatus = FetchStatus.Initial,
  scan,
  scanFetchStatus = FetchStatus.Initial,
  transactionsFetchStatus = FetchStatus.Initial,
}: ConfirmSignChangeTrustOptOutProps): ComponentOrElement => {
  const t = i18n(locale);
  const { address } = account;
  const shouldDisableConfirmButton = shouldDisableConfirmation({
    scanFetchStatus,
    transactionsFetchStatus,
  });

  return (
    <Container>
      <Box>
        <ConfirmationAlerts
          preferences={preferences}
          scan={scan}
          scanFetchStatus={scanFetchStatus}
          transactionsFetchStatus={transactionsFetchStatus}
        />
        <Box alignment="center" center>
          <Box>{null}</Box>
          <Heading size="lg">
            {t('confirmation.signChangeTrustOptOut.title', {
              asset: assetMetadata.symbol,
            })}
          </Heading>
          <Box>
            <AssetIcon iconUrl={assetMetadata.iconUrl} size="xl" />
          </Box>
          <Box>{null}</Box>
          <Box>{null}</Box>
        </Box>

        <Section>
          {origin ? (
            <Box alignment="space-between" direction="horizontal">
              <Box direction="horizontal" alignment="start">
                <SnapText fontWeight="medium" color="alternative">
                  {t('confirmation.origin')}
                </SnapText>
                <Tooltip content={t('confirmation.origin.tooltip')}>
                  <Icon name="question" color="muted" />
                </Tooltip>
              </Box>
              <SnapText>{origin}</SnapText>
            </Box>
          ) : null}
          {/* From */}
          <Box alignment="space-between" direction="horizontal">
            <SnapText fontWeight="medium" color="alternative">
              {t('confirmation.account')}
            </SnapText>
            <Address
              address={getAccountName(scope, address)}
              truncate
              displayName
              avatar
            />
          </Box>
          <Box alignment="space-between" direction="horizontal">
            <SnapText fontWeight="medium" color="alternative">
              {t('confirmation.asset')}
            </SnapText>

            <Asset
              symbol={assetMetadata.symbol}
              iconUrl={assetMetadata.iconUrl}
              link={getClassicAssetExplorerUrl(
                parseCaipAssetType(assetMetadata.assetId).assetReference,
              )}
            />
          </Box>

          <Box alignment="space-between" direction="horizontal">
            <SnapText fontWeight="medium" color="alternative">
              {t('confirmation.network')}
            </SnapText>
            <Box direction="horizontal" alignment="end">
              <Image
                borderRadius="medium"
                src={networkImage ?? STELLAR_IMAGE}
                height={16}
                width={16}
              />
              <SnapText>{getNetworkName(scope)}</SnapText>
            </Box>
          </Box>
          <Box>{null}</Box>
          {/* Fee Breakdown */}
          <FeeRow
            fee={feeData}
            price={tokenPrices?.[feeData.assetId] ?? null}
            preferences={preferences}
            tokenPricesFetchStatus={tokenPricesFetchStatus}
          />
        </Section>
      </Box>
      <ConfirmationFooter
        locale={locale}
        cancelButtonName={ConfirmSignChangeTrustOptOutFormNames.Cancel}
        confirmButtonName={ConfirmSignChangeTrustOptOutFormNames.Confirm}
        confirmDisabled={shouldDisableConfirmButton}
        requiresAcknowledgement={requiresMaliciousAcknowledgement({
          preferences,
          scan,
        })}
      />
    </Container>
  );
};
