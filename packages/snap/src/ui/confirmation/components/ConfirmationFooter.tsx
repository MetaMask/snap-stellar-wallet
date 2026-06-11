import type { ComponentOrElement } from '@metamask/snaps-sdk';
import { Button, Footer } from '@metamask/snaps-sdk/jsx';

import type { Locale } from '../../../utils';
import { i18n } from '../../../utils';
import { MaliciousAcknowledgementFormNames } from '../views/MaliciousAcknowledgement/constants';

type ConfirmationFooterProps = {
  locale: string;
  cancelButtonName: string;
  confirmButtonName: string;
  confirmDisabled?: boolean;
  // When true, the primary button becomes "Review alerts" and routes the user
  // through the malicious acknowledgement screen instead of confirming directly.
  requiresAcknowledgement?: boolean;
};

/**
 * Shared confirmation footer (cancel + primary button).
 *
 * Centralizes the malicious-acknowledgement behavior: a malicious scan result
 * swaps the primary button from "Confirm" to "Review alerts" rather than
 * disabling it, so the user keeps a "proceed anyway" path behind friction.
 *
 * A blocking state (`confirmDisabled`, e.g. failed background re-validation)
 * takes priority over the acknowledgement swap: we fall back to the disabled
 * "Confirm" button so the user can never enter the acknowledgement flow for a
 * transaction that is no longer valid.
 *
 * @param props - The footer props.
 * @param props.locale - The active locale.
 * @param props.cancelButtonName - Event name for the cancel button.
 * @param props.confirmButtonName - Event name for the confirm button.
 * @param props.confirmDisabled - Whether the confirm button is disabled.
 * @param props.requiresAcknowledgement - Whether to show "Review alerts" instead of "Confirm".
 * @returns The footer.
 */
export const ConfirmationFooter = ({
  locale,
  cancelButtonName,
  confirmButtonName,
  confirmDisabled = false,
  requiresAcknowledgement = false,
}: ConfirmationFooterProps): ComponentOrElement => {
  const t = i18n(locale as Locale);

  return (
    <Footer>
      <Button name={cancelButtonName}>{t('confirmation.cancelButton')}</Button>
      {requiresAcknowledgement && !confirmDisabled ? (
        <Button name={MaliciousAcknowledgementFormNames.Review}>
          {t('confirmation.reviewAlertsButton')}
        </Button>
      ) : (
        <Button name={confirmButtonName} disabled={confirmDisabled}>
          {t('confirmation.confirmButton')}
        </Button>
      )}
    </Footer>
  );
};
