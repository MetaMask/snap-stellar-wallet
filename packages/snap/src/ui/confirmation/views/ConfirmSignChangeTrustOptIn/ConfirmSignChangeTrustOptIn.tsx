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

import { ConfirmSignChangeTrustOptInFormNames } from './events';
import type { StellarKeyringAccount } from '../../../../services/account';
import type { StellarAssetMetadata } from '../../../../services/asset-metadata';
import { i18n } from '../../../../utils';
import { STELLAR_IMAGE } from '../../../images/icon';
import usdtSvg from '../../../images/usdt.svg';
import type {
  ContextWithPrices,
  ConfirmationBaseProps,
  FeeData,
} from '../../api';
import { FetchStatus } from '../../api';
import {
  Asset,
  AssetIcon,
  ConfirmationFooter,
  FeeRow,
  TransactionAlert,
  TransactionValidationAlert,
} from '../../components';
import {
  getAccountName,
  getClassicAssetExplorerUrl,
  hasEnabledTransactionScan,
  isConfirmDisabledByScan,
  isConfirmDisabledByTransactionValidation,
  getNetworkName,
  requiresMaliciousAcknowledgement,
} from '../../utils';

export type ConfirmSignChangeTrustOptInProps = ConfirmationBaseProps &
  ContextWithPrices & {
    account: StellarKeyringAccount;
    assetMetadata: StellarAssetMetadata;
    feeData: FeeData;
  };

export const ConfirmSignChangeTrustOptIn = ({
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
}: ConfirmSignChangeTrustOptInProps): ComponentOrElement => {
  const t = i18n(locale);
  const { address } = account;
  const shouldDisableConfirmButton =
    isConfirmDisabledByScan({ scanFetchStatus }) ||
    isConfirmDisabledByTransactionValidation(transactionsFetchStatus);

  return (
    <Container>
      <Box>
        <TransactionValidationAlert
          preferences={preferences}
          transactionsFetchStatus={transactionsFetchStatus}
        />
        {transactionsFetchStatus !== FetchStatus.Error &&
        hasEnabledTransactionScan(preferences) ? (
          <TransactionAlert
            scanFetchStatus={scanFetchStatus}
            validation={scan?.validation ?? null}
            error={scan?.error ?? null}
            preferences={preferences}
          />
        ) : null}
        <Box alignment="center" center>
          <Box>{null}</Box>
          <Heading size="lg">
            {t('confirmation.signChangeTrustOptIn.title', {
              asset: assetMetadata.symbol,
            })}
          </Heading>
          <Box>
            {/* TODO: Replace with the asset icon, dummy for testing */}
            <AssetIcon iconUrl={usdtSvg} size="xl" />
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

            {/* TODO: Replace with the asset icon, dummy for testing */}
            <Asset
              symbol={assetMetadata.symbol}
              iconUrl={usdtSvg}
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
        cancelButtonName={ConfirmSignChangeTrustOptInFormNames.Cancel}
        confirmButtonName={ConfirmSignChangeTrustOptInFormNames.Confirm}
        confirmDisabled={shouldDisableConfirmButton}
        requiresAcknowledgement={requiresMaliciousAcknowledgement({
          preferences,
          scan,
        })}
      />
    </Container>
  );
};
