import type { ComponentOrElement } from '@metamask/snaps-sdk';
import {
  Address,
  Box,
  Container,
  Copyable,
  Heading,
  Icon,
  Section,
  Text as SnapText,
  Tooltip,
  Divider,
} from '@metamask/snaps-sdk/jsx';
import type { Json } from '@metamask/utils';
import { isNullOrUndefined } from '@metamask/utils';

import { ConfirmSignTransactionFormNames } from './events';
import type { KnownCaip2ChainId } from '../../../../api';
import type { StellarKeyringAccount } from '../../../../services/account';
import type { ReadableTransactionJson } from '../../../../services/transaction';
import type { Locale, LocalizedMessage } from '../../../../utils';
import { i18n } from '../../../../utils';
import type { ConfirmationBaseProps, FeeData } from '../../api';
import { FetchStatus } from '../../api';
import { Asset } from '../../components/Asset';
import { ConfirmationFooter } from '../../components/ConfirmationFooter';
import { EstimatedChanges } from '../../components/EstimatedChanges/EstimatedChanges';
import { FeeRow } from '../../components/Fee';
import { NetworkRow } from '../../components/Network';
import { TransactionAlert } from '../../components/TransactionAlert';
import {
  getAccountName,
  hasEnabledTransactionScan,
  requiresMaliciousAcknowledgement,
  resolveAssetDisplay,
  shouldDisableConfirmation,
} from '../../utils';

export type ConfirmSignTransactionProps = Omit<
  ConfirmationBaseProps,
  'feeData'
> & {
  feeData: FeeData;
  readableTransaction: ReadableTransactionJson;
  account: StellarKeyringAccount;
};

const AmountRow = ({ amount }: { amount: string }): ComponentOrElement => {
  return <SnapText>{amount}</SnapText>;
};

const AssetParam = ({
  scope,
  assetReference,
  amount,
  preferences,
  price,
  priceLoading,
}: {
  scope: KnownCaip2ChainId;
  assetReference: string;
  amount?: string;
  preferences?: ConfirmationBaseProps['preferences'];
  price?: string | null;
  priceLoading?: boolean;
}): ComponentOrElement => {
  const resolved = resolveAssetDisplay(scope, assetReference);
  if (!resolved) {
    // Liquidity pool ids and other non-classic references fall back to the raw string.
    if (amount === undefined) {
      return <SnapText>{assetReference}</SnapText>;
    }
    return (
      <Box direction="horizontal" alignment="end">
        <SnapText>{amount}</SnapText>
        <SnapText>{assetReference}</SnapText>
      </Box>
    );
  }

  return (
    <Asset
      symbol={resolved.symbol}
      amount={amount}
      iconUrl={resolved.iconUrl}
      link={resolved.link}
      preferences={preferences}
      price={price ?? null}
      priceLoading={priceLoading}
    />
  );
};

const AddressRow = ({
  address,
  scope,
}: {
  address: string;
  scope: KnownCaip2ChainId;
}): ComponentOrElement => {
  return (
    <Address
      address={getAccountName(scope, address)}
      truncate
      displayName
      avatar
    />
  );
};

/**
 * Renders decoded Soroban args as labeled rows (`Arg 1`, `Arg 2`, …).
 * All values are {@link Copyable}, including address / contract strkeys.
 *
 * @param params - Field value from {@link ReadableOperationField}.
 * @param params.value - JSON field value (typically `string[]`).
 * @param params.translate - Translation function.
 * @returns JSX for the confirmation row value.
 */
const JsonParamValue = ({
  value,
  translate,
}: {
  value: Json;
  translate: ReturnType<typeof i18n>;
}): ComponentOrElement => {
  if (Array.isArray(value)) {
    return (
      <Box direction="vertical" alignment="end">
        {value.map((item, index) => {
          const display =
            typeof item === 'string' ? item : JSON.stringify(item);
          return (
            <Box key={`arg-${index}`} direction="vertical" alignment="end">
              <SnapText fontWeight="medium" color="alternative">
                {translate('confirmation.transaction.param.argument', {
                  index: (index + 1).toString(),
                })}
              </SnapText>
              <Copyable value={display} />
            </Box>
          );
        })}
      </Box>
    );
  }
  return <Copyable value={JSON.stringify(value, null, 2)} />;
};

const RenderReadableParamValue = (params: {
  translate: ReturnType<typeof i18n>;
  type: string;
  value: Json;
  scope: KnownCaip2ChainId;
  preferences?: ConfirmationBaseProps['preferences'];
  tokenPrices?: ConfirmationBaseProps['tokenPrices'];
  priceLoading?: boolean;
}): ComponentOrElement | null => {
  const {
    type,
    value,
    scope,
    preferences,
    tokenPrices,
    priceLoading,
    translate,
  } = params;
  if (isNullOrUndefined(value)) {
    return null;
  }
  switch (type) {
    case 'assetWithAmount': {
      if (!Array.isArray(value)) {
        return null;
      }
      const [assetReference, amount] = value as [string, string];
      const resolved = resolveAssetDisplay(scope, assetReference);
      const price = resolved ? (tokenPrices?.[resolved.assetId] ?? null) : null;
      return (
        <AssetParam
          scope={scope}
          assetReference={assetReference}
          amount={amount}
          preferences={preferences}
          price={price}
          priceLoading={priceLoading}
        />
      );
    }
    case 'asset':
      return <AssetParam scope={scope} assetReference={value as string} />;
    case 'address':
      return <AddressRow address={value as string} scope={scope} />;
    case 'amount':
      return <AmountRow amount={value as string} />;
    case 'copyable':
      return (
        <Copyable
          value={typeof value === 'string' ? value : JSON.stringify(value)}
        />
      );
    case 'json':
      return <JsonParamValue value={value} translate={translate} />;
    default:
      if (Array.isArray(value)) {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        return <SnapText>{value.join(', ')}</SnapText>;
      } else if (typeof value === 'object') {
        return <SnapText>{JSON.stringify(value, null, 2)}</SnapText>;
      }
      return <SnapText>{String(value)}</SnapText>;
  }
};

export const ConfirmSignTransaction = ({
  readableTransaction,
  account,
  scope,
  locale,
  networkImage,
  origin,
  preferences,
  feeData,
  tokenPrices,
  tokenPricesFetchStatus = FetchStatus.Initial,
  scan,
  scanFetchStatus = FetchStatus.Initial,
}: ConfirmSignTransactionProps): ComponentOrElement => {
  const t = i18n(locale);
  const { address } = account;
  const addressCaip10 = getAccountName(scope, address);
  const priceLoading = tokenPricesFetchStatus === FetchStatus.Fetching;
  const feePrice = tokenPrices?.[feeData.assetId] ?? null;
  // Sign-transaction has no local simulation/re-validation step, so only the
  // remote-scan-loading guard applies here.
  const shouldDisableConfirmButton = shouldDisableConfirmation({
    scanFetchStatus,
  });

  return (
    <Container>
      <Box>
        {hasEnabledTransactionScan(preferences) ? (
          <TransactionAlert
            scanFetchStatus={scanFetchStatus}
            validation={scan?.validation ?? null}
            error={scan?.error ?? null}
            preferences={preferences}
          />
        ) : null}
        <Box alignment="center" center>
          <Box>{null}</Box>
          <Heading size="lg">{t('confirmation.signTransaction.title')}</Heading>
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
          <Box alignment="space-between" direction="horizontal">
            <SnapText fontWeight="medium" color="alternative">
              {t('confirmation.account')}
            </SnapText>
            <Address address={addressCaip10} truncate displayName avatar />
          </Box>
          {/* Network */}
          <NetworkRow
            networkImage={networkImage}
            scope={scope}
            locale={locale as Locale}
          />
          <Box>{null}</Box>
          {/* Fee */}
          <FeeRow
            fee={feeData}
            preferences={preferences}
            price={feePrice}
            tokenPricesFetchStatus={tokenPricesFetchStatus}
          />
          {[readableTransaction.memo].filter(Boolean).map((memo) => (
            <Box alignment="space-between" direction="horizontal">
              <SnapText fontWeight="medium" color="alternative">
                {t('confirmation.memo')}
              </SnapText>
              <SnapText>{memo}</SnapText>
            </Box>
          ))}
        </Section>

        <Section>
          {readableTransaction.operations.map((operationJson, index) => (
            <Box
              key={`op-${index}`}
              alignment="space-between"
              direction="vertical"
            >
              <Heading>
                {t(
                  `confirmation.transaction.${operationJson.type.toLowerCase()}` as LocalizedMessage,
                )}
              </Heading>
              {[
                ...(operationJson.explicitSource
                  ? [
                      {
                        key: 'source',
                        value: operationJson.explicitSource as Json,
                        type: 'address' as const,
                      },
                    ]
                  : []),
                ...operationJson.params,
              ]
                .filter((param) => !isNullOrUndefined(param.value))
                .map((param) => {
                  const useVertical =
                    param.type === 'json' ||
                    (typeof param.value === 'string' &&
                      param.value.length > 40);
                  return (
                    <Box
                      key={param.key}
                      alignment="space-between"
                      direction={useVertical ? 'vertical' : 'horizontal'}
                    >
                      <SnapText fontWeight="medium" color="alternative">
                        {t(
                          `confirmation.transaction.param.${param.key}` as LocalizedMessage,
                        )}
                      </SnapText>
                      <RenderReadableParamValue
                        translate={t}
                        type={param.type}
                        value={param.value}
                        scope={scope}
                        preferences={preferences}
                        tokenPrices={tokenPrices}
                        priceLoading={priceLoading}
                      />
                    </Box>
                  );
                })}

              {index < readableTransaction.operations.length - 1 && <Divider />}
            </Box>
          ))}
        </Section>
      </Box>
      <ConfirmationFooter
        locale={locale}
        cancelButtonName={ConfirmSignTransactionFormNames.Cancel}
        confirmButtonName={ConfirmSignTransactionFormNames.Confirm}
        confirmDisabled={shouldDisableConfirmButton}
        requiresAcknowledgement={requiresMaliciousAcknowledgement({
          preferences,
          scan,
        })}
      />
    </Container>
  );
};
