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
import { STELLAR_IMAGE } from '../../../images/icon';
import type { ConfirmationBaseProps, FeeData } from '../../api';
import { FetchStatus } from '../../api';
import { Asset } from '../../components/Asset';
import { FeeRow } from '../../components/Fee';
import {
  getAccountName,
  getNetworkName,
  resolveAssetDisplay,
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

const RenderReadableParamValue = (params: {
  type: string;
  value: Json;
  scope: KnownCaip2ChainId;
  preferences?: ConfirmationBaseProps['preferences'];
  tokenPrices?: ConfirmationBaseProps['tokenPrices'];
  priceLoading?: boolean;
}): ComponentOrElement | null => {
  const { type, value, scope, preferences, tokenPrices, priceLoading } = params;
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
    case 'json':
      return <SnapText>{JSON.stringify(value, null, 2)}</SnapText>;
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
}: ConfirmSignTransactionProps): ComponentOrElement => {
  const t = i18n(locale as Locale);
  const { address } = account;
  const addressCaip10 = getAccountName(scope, address);
  const priceLoading = tokenPricesFetchStatus === FetchStatus.Fetching;
  const feePrice = tokenPrices?.[feeData.assetId] ?? null;

  return (
    <Container>
      <Box>
        <Box alignment="center" center>
          <Box>{null}</Box>
          <Heading size="lg">{t('confirmation.signTransaction.title')}</Heading>
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
          <Box alignment="space-between" direction="horizontal">
            <SnapText fontWeight="medium" color="alternative">
              {t('confirmation.account')}
            </SnapText>
            <Address address={addressCaip10} truncate displayName avatar />
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
          <FeeRow
            fee={feeData}
            preferences={preferences}
            price={feePrice}
            tokenPricesFetchStatus={tokenPricesFetchStatus}
          />
          {[readableTransaction.memo].filter(Boolean).map((memo) => (
            <Box alignment="space-between" direction="horizontal">
              <SnapText fontWeight="medium" color="alternative">
                {t('confirmation.memo' as LocalizedMessage)}
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
      <Footer>
        <Button name={ConfirmSignTransactionFormNames.Cancel}>
          {t('confirmation.cancelButton')}
        </Button>
        <Button name={ConfirmSignTransactionFormNames.Confirm}>
          {t('confirmation.confirmButton')}
        </Button>
      </Footer>
    </Container>
  );
};
