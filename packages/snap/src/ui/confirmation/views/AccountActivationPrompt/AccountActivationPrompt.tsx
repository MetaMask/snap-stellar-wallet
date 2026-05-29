import type { ComponentOrElement } from '@metamask/snaps-sdk';
import {
  Box,
  Button,
  Container,
  Copyable,
  Footer,
  Heading,
  Image,
  Section,
  Text as SnapText,
} from '@metamask/snaps-sdk/jsx';

import { AccountActivationPromptFormNames } from './events';
import type { Locale } from '../../../../utils';
import { i18n } from '../../../../utils';
import { generateAddressQrCode } from '../../qrcode';

export type AccountActivationPromptProps = {
  accountAddress: string;
  locale: Locale;
};

export const AccountActivationPrompt = ({
  accountAddress,
  locale,
}: AccountActivationPromptProps): ComponentOrElement => {
  const translate = i18n(locale);

  const qrCode = generateAddressQrCode(accountAddress);

  return (
    <Container>
      <Box>
        <Box alignment="center" center>
          <Box>{null}</Box>
          <Heading size="lg">
            {translate('confirmation.accountActivation.title')}
          </Heading>
          <Box>{null}</Box>
          <Box>{null}</Box>
          <Box>{null}</Box>
        </Box>
        <Section>
          <Box direction="vertical" center>
            {qrCode ? <Image src={qrCode} width={230} /> : null}
            <SnapText fontWeight="bold" color="alternative" alignment="center">
              {translate('confirmation.accountActivation.address')}
            </SnapText>
            <Box>{null}</Box>
            <Copyable value={accountAddress} />
            <Box>{null}</Box>
            <Box>{null}</Box>
            <SnapText color="alternative" alignment="center">
              {translate('confirmation.accountActivation.description')}
            </SnapText>
            <Box>{null}</Box>
            <Box>{null}</Box>
            <SnapText color="alternative" alignment="center">
              {translate('confirmation.accountActivation.description2')}
            </SnapText>
          </Box>
        </Section>
      </Box>
      <Footer>
        <Button name={AccountActivationPromptFormNames.Close}>
          {translate('confirmation.closeButton')}
        </Button>
      </Footer>
    </Container>
  );
};
