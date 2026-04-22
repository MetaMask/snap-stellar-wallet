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
  Link,
  Divider,
} from '@metamask/snaps-sdk/jsx';
import type { Json, CaipAccountId } from '@metamask/utils';
import { isNullOrUndefined } from '@metamask/utils';
import { BigNumber } from 'bignumber.js';

import { ConfirmSignTransactionFormNames } from './events';
import type { KnownCaip2ChainId } from '../../../../api';
import type { StellarKeyringAccount } from '../../../../services/account';
import {
  OperationMapper,
  type Transaction,
} from '../../../../services/transaction';
import type { Locale, LocalizedMessage } from '../../../../utils';
import { i18n, parseClassicAssetCodeIssuer } from '../../../../utils';
import { STELLAR_IMAGE } from '../../../images/icon';
import type { ContextWithPrices, FeeData } from '../../api';
import {
  getAccountName,
  getClassicAssetExplorerUrl,
  getNetworkName,
} from '../../utils';

export type ConfirmSignTransactionProps = ContextWithPrices & {
  transaction: Transaction;
  account: StellarKeyringAccount;
  scope: KnownCaip2ChainId;
  locale: Locale;
  networkImage: string | null;
  origin: string;
  feeData: FeeData;
};

const AmountRow = ({ amount }: { amount: string }): ComponentOrElement => {
  return <SnapText>{new BigNumber(amount).toString()}</SnapText>;
};

const AssetRow = ({
  asset,
  amount,
}: {
  asset: string;
  amount?: string;
}): ComponentOrElement => {
  let assetRow;
  if (asset === 'native') {
    assetRow = <SnapText>{'Native'}</SnapText>;
  } else {
    const { assetCode } = parseClassicAssetCodeIssuer(asset);
    assetRow = (
      <Link href={getClassicAssetExplorerUrl(asset)}>${assetCode}</Link>
    );
  }

  if (amount === undefined) {
    return assetRow;
  }
  return (
    <Box direction="horizontal" alignment="start">
      <SnapText>{new BigNumber(amount).toString()}</SnapText>
      {assetRow}
    </Box>
  );
};

const AddressRow = ({
  address,
  scope,
}: {
  address: string;
  scope: KnownCaip2ChainId;
}): ComponentOrElement => {
  const addressCaip10 = `${scope}:${address}` as `0x${string}` | CaipAccountId;
  return <Address address={addressCaip10} truncate displayName avatar />;
};

const RenderReadableParamValue = (params: {
  type: string;
  value: Json;
  scope: KnownCaip2ChainId;
}): ComponentOrElement | null => {
  const { type, value, scope } = params;
  if (isNullOrUndefined(value)) {
    return null;
  }
  switch (type) {
    case 'assetWithAmount':
      if (Array.isArray(value)) {
        return (
          <AssetRow asset={value[0] as string} amount={value[1] as string} />
        );
      }
      return null;
    case 'address':
      return <AddressRow address={value as string} scope={scope} />;
    case 'amount':
      return <AmountRow amount={value as string} />;
    case 'asset':
      return <AssetRow asset={value as string} />;
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
  transaction,
  account,
  scope,
  locale,
  networkImage,
  origin,
}: ConfirmSignTransactionProps): ComponentOrElement => {
  const t = i18n(locale);
  const { address } = account;
  const addressCaip10 = getAccountName(scope, address);

  const readableTransaction = new OperationMapper().mapTransaction(transaction);

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
          <Box alignment="space-between" direction="horizontal">
            <SnapText fontWeight="medium" color="alternative">
              {t('confirmation.transactionFee')}
            </SnapText>
            <SnapText>{readableTransaction.feeStroops} stroops</SnapText>
          </Box>
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
            <Box alignment="space-between" direction="vertical">
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
