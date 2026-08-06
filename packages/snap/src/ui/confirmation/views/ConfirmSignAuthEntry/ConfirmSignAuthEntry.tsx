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
  Section,
  Text as SnapText,
  Tooltip,
} from '@metamask/snaps-sdk/jsx';

import { ConfirmSignAuthEntryFormNames } from './events';
import type { ReadableAuthEntry } from '../../../../handlers/keyring/signAuthEntry';
import type { StellarKeyringAccount } from '../../../../services/account';
import type { Locale } from '../../../../utils';
import { i18n } from '../../../../utils';
import type { ConfirmationBaseProps } from '../../api';
import { Authorizations } from '../../components/Authorizations';
import { NetworkRow } from '../../components/Network';
import { getAccountName } from '../../utils';

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
  const translate = i18n(locale);
  const { address } = account;
  const addressCaip10 = getAccountName(scope, address);
  const { authorizations, nonce, signatureExpirationLedger } =
    readableAuthEntry;

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
          {/* Network */}
          <NetworkRow
            networkImage={networkImage}
            scope={scope}
            locale={locale as Locale}
          />
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
        </Section>

        {authorizations.length > 0 ? (
          <Authorizations locale={locale} authorizations={authorizations} />
        ) : null}
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
