import type { ComponentOrElement } from '@metamask/snaps-sdk';
import {
  Address,
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

import { ConfirmSignMessageFormNames } from './events';
import type { StellarKeyringAccount } from '../../../../services/account';
import type { Locale } from '../../../../utils';
import { i18n } from '../../../../utils';
import type { ConfirmationBaseProps } from '../../api';
import { NetworkRow } from '../../components/Network';
import { getAccountName } from '../../utils';

export type ConfirmSignMessageProps = Pick<
  ConfirmationBaseProps,
  'scope' | 'locale' | 'networkImage' | 'origin'
> & {
  message: string;
  account: StellarKeyringAccount;
};

export const ConfirmSignMessage = ({
  message,
  account,
  scope,
  locale,
  networkImage,
  origin,
}: ConfirmSignMessageProps): ComponentOrElement => {
  const translate = i18n(locale);
  const { address } = account;
  const addressCaip10 = getAccountName(scope, address);

  return (
    <Container>
      <Box>
        <Box alignment="center" center>
          <Box>{null}</Box>
          <Heading size="lg">
            {translate('confirmation.signMessage.title')}
          </Heading>
          <Box>{null}</Box>
        </Box>

        <Section>
          <SnapText fontWeight="medium">
            {translate('confirmation.signMessage.message')}
          </SnapText>
          <SnapText>{message}</SnapText>
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
          {/* Network */}
          <NetworkRow
            networkImage={networkImage}
            scope={scope}
            locale={locale as Locale}
          />
        </Section>
      </Box>
      <Footer>
        <Button name={ConfirmSignMessageFormNames.Cancel}>
          {translate('confirmation.cancelButton')}
        </Button>
        <Button name={ConfirmSignMessageFormNames.Confirm}>
          {translate('confirmation.confirmButton')}
        </Button>
      </Footer>
    </Container>
  );
};
