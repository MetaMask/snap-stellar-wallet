import type { ComponentOrElement } from '@metamask/snaps-sdk';
import type { Json } from '@metamask/utils';

import type { ConfirmationBaseProps } from '../api';
import { ConfirmationInterfaceKey } from '../api';
import type { ConfirmSendTransactionProps } from './ConfirmSendTransaction/ConfirmSendTransaction';
import { ConfirmSendTransaction } from './ConfirmSendTransaction/ConfirmSendTransaction';
import type { ConfirmSignAuthEntryProps } from './ConfirmSignAuthEntry/ConfirmSignAuthEntry';
import { ConfirmSignAuthEntry } from './ConfirmSignAuthEntry/ConfirmSignAuthEntry';
import type { ConfirmSignChangeTrustOptInProps } from './ConfirmSignChangeTrustOptIn/ConfirmSignChangeTrustOptIn';
import { ConfirmSignChangeTrustOptIn } from './ConfirmSignChangeTrustOptIn/ConfirmSignChangeTrustOptIn';
import type { ConfirmSignChangeTrustOptOutProps } from './ConfirmSignChangeTrustOptOut/ConfirmSignChangeTrustOptOut';
import { ConfirmSignChangeTrustOptOut } from './ConfirmSignChangeTrustOptOut/ConfirmSignChangeTrustOptOut';
import type { ConfirmSignMessageProps } from './ConfirmSignMessage/ConfirmSignMessage';
import { ConfirmSignMessage } from './ConfirmSignMessage/ConfirmSignMessage';
import type { ConfirmSignTransactionProps } from './ConfirmSignTransaction/ConfirmSignTransaction';
import { ConfirmSignTransaction } from './ConfirmSignTransaction/ConfirmSignTransaction';
import { MaliciousAcknowledgementScreen } from './MaliciousAcknowledgement/MaliciousAcknowledgementScreen';

/** Serializable props bag stored on the interface and merged into each view. */
export type ConfirmationViewProps = Record<string, Json>;

/**
 * Renders the confirmation view for an interface key and context.
 *
 * Shared by {@link ConfirmationUXController} and the malicious acknowledgement
 * event handlers so both render through the same logic. When the context marks
 * the acknowledgement screen as active, it takes over regardless of the key.
 *
 * @param interfaceKey - The confirmation flow to render.
 * @param context - The serialized interface context (view props + flags).
 * @returns The component to render.
 */
export function renderConfirmationView(
  interfaceKey: ConfirmationInterfaceKey,
  context: ConfirmationViewProps,
): ComponentOrElement {
  const baseContext = context as ConfirmationBaseProps;
  if (baseContext.acknowledgementScreen) {
    return (
      <MaliciousAcknowledgementScreen
        locale={baseContext.locale}
        acknowledged={baseContext.acknowledged}
      />
    );
  }

  switch (interfaceKey) {
    case ConfirmationInterfaceKey.ChangeTrustlineOptIn:
      return (
        <ConfirmSignChangeTrustOptIn
          {...(context as unknown as ConfirmSignChangeTrustOptInProps)}
        />
      );
    case ConfirmationInterfaceKey.ChangeTrustlineOptOut:
      return (
        <ConfirmSignChangeTrustOptOut
          {...(context as unknown as ConfirmSignChangeTrustOptOutProps)}
        />
      );
    case ConfirmationInterfaceKey.SignTransaction:
      return (
        <ConfirmSignTransaction
          {...(context as unknown as ConfirmSignTransactionProps)}
        />
      );
    case ConfirmationInterfaceKey.SignMessage:
      return <ConfirmSignMessage {...(context as ConfirmSignMessageProps)} />;
    case ConfirmationInterfaceKey.SignAuthEntry:
      return (
        <ConfirmSignAuthEntry
          {...(context as unknown as ConfirmSignAuthEntryProps)}
        />
      );
    case ConfirmationInterfaceKey.ConfirmSendTransaction:
      return (
        <ConfirmSendTransaction
          {...(context as unknown as ConfirmSendTransactionProps)}
        />
      );
    default: {
      const exhaustive: never = interfaceKey;
      throw new Error(`Unsupported interface key: ${String(exhaustive)}`);
    }
  }
}
