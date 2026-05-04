import type { ComponentOrElement } from '@metamask/snaps-sdk';
import {
  Address,
  Banner,
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
} from '@metamask/snaps-sdk/jsx';

import { ConfirmSignAuthEntryFormNames } from './events';
import type { ReadableAuthEntry } from '../../../../handlers/keyring/signAuthEntry';
import type { StellarKeyringAccount } from '../../../../services/account';
import type { Locale } from '../../../../utils';
import { i18n } from '../../../../utils';
import { STELLAR_IMAGE } from '../../../images/icon';
import type { ConfirmationBaseProps } from '../../api';
import { getAccountName, getNetworkName } from '../../utils';

export type ConfirmSignAuthEntryProps = Pick<
  ConfirmationBaseProps,
  'scope' | 'locale' | 'networkImage' | 'origin'
> & {
  readableAuthEntry: ReadableAuthEntry;
  account: StellarKeyringAccount;
};

export const ConfirmSignAuthEntry = ({
  readableAuthEntry,
  account,
  scope,
  locale,
  networkImage,
  origin,
}: ConfirmSignAuthEntryProps): ComponentOrElement => {
  const translate = i18n(locale as Locale);
  const { address } = account;
  const addressCaip10 = getAccountName(scope, address);
  const {
    functionType,
    contractAddress,
    functionName,
    signatureExpirationLedger,
    nonce,
    subInvocationsCount,
  } = readableAuthEntry;

  return (
    <Container>
      <Box>
        <Box alignment="center" center>
          <Box>{null}</Box>
          <Heading size="lg">
            {translate('confirmation.signAuthEntry.title')}
          </Heading>
          <Box>{null}</Box>
        </Box>

        <Banner severity="warning" title="">
          <SnapText>{translate('confirmation.signAuthEntry.warning')}</SnapText>
        </Banner>

        <Section>
          {functionType === 'invoke' && contractAddress !== null ? (
            <Box alignment="space-between" direction="horizontal">
              <SnapText fontWeight="medium" color="alternative">
                {translate('confirmation.signAuthEntry.contract')}
              </SnapText>
              <Address address={`${scope}:${contractAddress}`} truncate />
            </Box>
          ) : (
            <Box alignment="space-between" direction="horizontal">
              <SnapText fontWeight="medium" color="alternative">
                {translate('confirmation.signAuthEntry.contract')}
              </SnapText>
              <SnapText>
                {translate('confirmation.signAuthEntry.createContract')}
              </SnapText>
            </Box>
          )}

          {functionName === null ? null : (
            <Box alignment="space-between" direction="horizontal">
              <SnapText fontWeight="medium" color="alternative">
                {translate('confirmation.signAuthEntry.function')}
              </SnapText>
              <SnapText>{functionName}</SnapText>
            </Box>
          )}

          <Box alignment="space-between" direction="horizontal">
            <SnapText fontWeight="medium" color="alternative">
              {translate('confirmation.signAuthEntry.expiresAt')}
            </SnapText>
            <SnapText>{String(signatureExpirationLedger)}</SnapText>
          </Box>

          <Box alignment="space-between" direction="horizontal">
            <SnapText fontWeight="medium" color="alternative">
              {translate('confirmation.signAuthEntry.nonce')}
            </SnapText>
            <SnapText>{nonce}</SnapText>
          </Box>

          {subInvocationsCount > 0 ? (
            <Box alignment="space-between" direction="horizontal">
              <SnapText fontWeight="medium" color="alternative">
                {translate('confirmation.signAuthEntry.subInvocations')}
              </SnapText>
              <SnapText>{String(subInvocationsCount)}</SnapText>
            </Box>
          ) : null}
        </Section>

        <Section>
          {origin ? (
            <Box alignment="space-between" direction="horizontal">
              <Box direction="horizontal" alignment="start">
                <SnapText fontWeight="medium" color="alternative">
                  {translate('confirmation.origin')}
                </SnapText>
                <Tooltip content={translate('confirmation.origin.tooltip')}>
                  <Icon name="question" color="muted" />
                </Tooltip>
              </Box>
              <SnapText>{origin}</SnapText>
            </Box>
          ) : null}
          <Box alignment="space-between" direction="horizontal">
            <SnapText fontWeight="medium" color="alternative">
              {translate('confirmation.account')}
            </SnapText>
            <Address address={addressCaip10} truncate displayName avatar />
          </Box>
          <Box alignment="space-between" direction="horizontal">
            <SnapText fontWeight="medium" color="alternative">
              {translate('confirmation.network')}
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
        </Section>
      </Box>
      <Footer>
        <Button name={ConfirmSignAuthEntryFormNames.Cancel}>
          {translate('confirmation.cancelButton')}
        </Button>
        <Button name={ConfirmSignAuthEntryFormNames.Confirm}>
          {translate('confirmation.confirmButton')}
        </Button>
      </Footer>
    </Container>
  );
};
