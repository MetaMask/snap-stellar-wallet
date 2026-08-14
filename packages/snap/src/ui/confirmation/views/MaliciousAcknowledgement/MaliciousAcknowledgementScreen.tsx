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
  const translate = i18n(locale);

  return (
    <Container>
      <Box>
        <Box alignment="center" center>
          <Heading size="lg">{translate('confirmation.maliciousAck.title')}</Heading>
        </Box>
        <Banner title={translate('confirmation.maliciousAck.title')} severity="danger">
          <SnapText>{translate('confirmation.maliciousAck.description')}</SnapText>
        </Banner>
        <Checkbox
          name={MaliciousAcknowledgementFormNames.Acknowledge}
          label={translate('confirmation.maliciousAck.checkbox')}
          checked={acknowledged}
        />
      </Box>
      <Footer>
        <Button name={MaliciousAcknowledgementFormNames.Back}>
          {translate('confirmation.maliciousAck.back')}
        </Button>
        <Button
          name={MaliciousAcknowledgementFormNames.Proceed}
          disabled={!acknowledged}
        >
          {translate('confirmation.maliciousAck.proceed')}
        </Button>
      </Footer>
    </Container>
  );
};
