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
import {
  xlmIcon,
  accountActiveMethod1Icon,
  accountActiveMethod2Icon,
} from '../../../images';
import { AssetIcon } from '../../components/AssetIcon';

export type AccountActivationPromptProps = {
  accountAddress: string;
  locale: Locale;
};

export const AccountActivationPrompt = ({
  accountAddress,
  locale,
}: AccountActivationPromptProps): ComponentOrElement => {
  const translate = i18n(locale);

  return (
    <Container>
      <Box>
        <Box alignment="center" center>
          <Box>{null}</Box>
          <Heading size="lg">
            {translate('confirmation.accountActivation.title')}
          </Heading>
          <Box>{null}</Box>
          <Box>
            <AssetIcon iconUrl={xlmIcon} size="xl" />
          </Box>
          <Box>
            <SnapText>
              {translate('confirmation.accountActivation.description')}
            </SnapText>
          </Box>
          <Box>{null}</Box>
          <Box>{null}</Box>
        </Box>
        <Section>
          <Box alignment="space-between" direction="vertical">
            <SnapText fontWeight="medium" color="alternative">
              {translate('confirmation.accountActivation.address')}
            </SnapText>
            <Copyable value={accountAddress} />
          </Box>
        </Section>
        <Section>
          <Box alignment="start" direction="horizontal">
            <Image src={accountActiveMethod1Icon} height={29} width={25} />
            <Box alignment="space-around" direction="vertical">
              <SnapText fontWeight="regular" color="alternative">
                {translate('confirmation.accountActivation.method1.title')}
              </SnapText>
              <SnapText size="sm" fontWeight="regular" color="alternative">
                {translate(
                  'confirmation.accountActivation.method1.description',
                )}
              </SnapText>
            </Box>
          </Box>
        </Section>
        <Section>
          <Box alignment="start" direction="horizontal">
            <Image src={accountActiveMethod2Icon} height={22} width={25} />
            <Box alignment="space-around" direction="vertical">
              <SnapText fontWeight="regular" color="alternative">
                {translate('confirmation.accountActivation.method2.title')}
              </SnapText>
              <SnapText size="sm" fontWeight="regular" color="alternative">
                {translate(
                  'confirmation.accountActivation.method2.description',
                )}
              </SnapText>
            </Box>
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
