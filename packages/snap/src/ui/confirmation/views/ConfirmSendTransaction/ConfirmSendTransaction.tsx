import type { ComponentOrElement } from '@metamask/snaps-sdk';
import {
  Address,
  Box,
  Container,
  Heading,
  Icon,
  Image,
  Link,
  Section,
  Text as SnapText,
  Tooltip,
} from '@metamask/snaps-sdk/jsx';

import { ConfirmSendTransactionFormNames } from './events';
import type { StellarKeyringAccount } from '../../../../services/account';
import { i18n } from '../../../../utils';
import { STELLAR_IMAGE } from '../../../images/icon';
import type {
  ContextWithPrices,
  ConfirmationBaseProps,
  FeeData,
} from '../../api';
import { FetchStatus } from '../../api';
import {
  ConfirmationAlerts,
  ConfirmationFooter,
  EstimatedChanges,
  FeeRow,
} from '../../components';
import {
  getAccountExplorerUrl,
  getAccountName,
  getNetworkName,
  requiresMaliciousAcknowledgement,
  shouldDisableConfirmation,
} from '../../utils';

export type ConfirmSendTransactionProps = ConfirmationBaseProps &
  ContextWithPrices & {
    account: StellarKeyringAccount;
    feeData: FeeData;
    toAddress: string;
  };

export const ConfirmSendTransaction = ({
  account,
  toAddress,
  scope,
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
          <Heading size="lg">{t(`confirmation.transaction.title`)}</Heading>
          <Box>{null}</Box>
        </Box>

        {preferences.simulateOnChainActions ? (
          <EstimatedChanges
            changes={scan?.estimatedChanges ?? null}
            preferences={preferences}
            scanFetchStatus={scanFetchStatus}
          />
        ) : null}

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
      <ConfirmationFooter
        locale={locale}
        cancelButtonName={ConfirmSendTransactionFormNames.Cancel}
        confirmButtonName={ConfirmSendTransactionFormNames.Confirm}
        confirmDisabled={shouldDisableConfirmButton}
        requiresAcknowledgement={requiresMaliciousAcknowledgement({
          preferences,
          scan,
        })}
      />
    </Container>
  );
};
