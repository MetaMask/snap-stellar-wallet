import type { ComponentOrElement } from '@metamask/snaps-sdk';
import {
  Address,
  Box,
  Button,
  Container,
  Footer,
  Heading,
  Icon,
  Image,
  Link,
  Section,
  Text as SnapText,
  Tooltip,
} from '@metamask/snaps-sdk/jsx';
import { parseCaipAssetType } from '@metamask/utils';

import { ConfirmSendTransactionFormNames } from './events';
import type { StellarKeyringAccount } from '../../../../services/account';
import type { StellarAssetMetadata } from '../../../../services/asset-metadata';
import { isSlip44Id, i18n } from '../../../../utils';
import { xlmIcon } from '../../../images';
import { STELLAR_IMAGE } from '../../../images/icon';
import type {
  ContextWithPrices,
  ConfirmationBaseProps,
  FeeData,
} from '../../api';
import { FetchStatus } from '../../api';
import { Asset, ConfirmationAlerts, FeeRow } from '../../components';
import {
  getAccountExplorerUrl,
  getAccountName,
  getClassicAssetExplorerUrl,
  getNetworkName,
  getSepAssetExplorerUrl,
  isConfirmDisabledByScan,
  isConfirmDisabledByTransactionValidation,
} from '../../utils';

export type ConfirmSendTransactionProps = ConfirmationBaseProps &
  ContextWithPrices & {
    account: StellarKeyringAccount;
    assetMetadata: StellarAssetMetadata;
    feeData: FeeData;
  } & {
    toAddress: string;
    amount: string;
  };

export const ConfirmSendTransaction = ({
  account,
  toAddress,
  amount,
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
}: ConfirmSendTransactionProps): ComponentOrElement => {
  const t = i18n(locale);
  const { address } = account;
  const { assetId, symbol } = assetMetadata;
  const shouldDisableConfirmButton =
    isConfirmDisabledByScan({
      preferences,
      scan,
      scanFetchStatus,
    }) || isConfirmDisabledByTransactionValidation(transactionsFetchStatus);
  const parsedAsset = parseCaipAssetType(assetId);
  let assetLink: string | undefined;
  if (!isSlip44Id(assetId)) {
    assetLink =
      parsedAsset.assetNamespace === 'sep41'
        ? getSepAssetExplorerUrl(parsedAsset.assetReference)
        : getClassicAssetExplorerUrl(parsedAsset.assetReference);
  }
  const assetIconUrl = isSlip44Id(assetId) ? xlmIcon : assetMetadata.iconUrl;
  const assetPrice = tokenPrices?.[assetId] ?? null;

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
          <Heading size="lg">{t(`confirmation.transaction.title`)}</Heading>
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
            <Link href={getAccountExplorerUrl(address)}>
              <Address
                address={`${scope}:${address}`}
                truncate
                displayName
                avatar
              />
            </Link>
          </Box>
          {/* To */}
          <Box alignment="space-between" direction="horizontal">
            <SnapText fontWeight="medium" color="alternative">
              {t('confirmation.to')}
            </SnapText>
            <Link href={getAccountExplorerUrl(toAddress)}>
              <Address
                address={getAccountName(scope, toAddress)}
                truncate
                displayName
                avatar
              />
            </Link>
          </Box>
          <Box alignment="space-between" direction="horizontal">
            <SnapText fontWeight="medium" color="alternative">
              {t('confirmation.estimatedChanges.send')}
            </SnapText>
            <Asset
              symbol={symbol}
              amount={amount}
              iconUrl={assetIconUrl}
              link={assetLink}
              price={assetPrice}
              preferences={preferences}
              priceLoading={
                preferences?.useExternalPricingData &&
                tokenPricesFetchStatus === FetchStatus.Fetching
              }
            />
          </Box>
          {/* Network */}
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
      <Footer>
        <Button name={ConfirmSendTransactionFormNames.Cancel}>
          {t('confirmation.cancelButton')}
        </Button>
        <Button
          name={ConfirmSendTransactionFormNames.Confirm}
          disabled={shouldDisableConfirmButton}
        >
          {t('confirmation.confirmButton')}
        </Button>
      </Footer>
    </Container>
  );
};
