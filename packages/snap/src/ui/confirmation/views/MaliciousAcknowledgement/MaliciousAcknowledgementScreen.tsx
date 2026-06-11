import type { ComponentOrElement } from '@metamask/snaps-sdk';
import {
  Banner,
  Box,
  Button,
  Checkbox,
  Container,
  Footer,
  Heading,
  Text as SnapText,
} from '@metamask/snaps-sdk/jsx';

import { MaliciousAcknowledgementFormNames } from './constants';
import type { Locale } from '../../../../utils';
import { i18n } from '../../../../utils';
import type { ConfirmationBaseProps } from '../../api';

export type MaliciousAcknowledgementScreenProps = {
  locale: ConfirmationBaseProps['locale'];
  acknowledged?: boolean;
};

/**
 * Friction screen shown when the user chooses to review a malicious-scan alert.
 *
 * The user cannot be outright blocked, so this screen forces an explicit
 * acknowledgement: "Confirm" stays disabled until the risk checkbox is checked.
 *
 * @param props - The screen props.
 * @param props.locale - The active locale.
 * @param props.acknowledged - Whether the risk checkbox is currently checked.
 * @returns The acknowledgement screen.
 */
export const MaliciousAcknowledgementScreen = ({
  locale,
  acknowledged = false,
}: MaliciousAcknowledgementScreenProps): ComponentOrElement => {
  const t = i18n(locale as Locale);

  return (
    <Container>
      <Box>
        <Box alignment="center" center>
          <Heading size="lg">{t('confirmation.maliciousAck.title')}</Heading>
        </Box>
        <Banner title={t('confirmation.maliciousAck.title')} severity="danger">
          <SnapText>{t('confirmation.maliciousAck.description')}</SnapText>
        </Banner>
        <Checkbox
          name={MaliciousAcknowledgementFormNames.Acknowledge}
          label={t('confirmation.maliciousAck.checkbox')}
          checked={acknowledged}
        />
      </Box>
      <Footer>
        <Button name={MaliciousAcknowledgementFormNames.Back}>
          {t('confirmation.maliciousAck.back')}
        </Button>
        <Button
          name={MaliciousAcknowledgementFormNames.Proceed}
          disabled={!acknowledged}
        >
          {t('confirmation.maliciousAck.proceed')}
        </Button>
      </Footer>
    </Container>
  );
};
