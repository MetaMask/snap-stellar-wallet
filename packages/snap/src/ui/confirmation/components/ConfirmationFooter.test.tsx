import type { ComponentOrElement } from '@metamask/snaps-sdk';

import { ConfirmationFooter } from './ConfirmationFooter';
import { i18n } from '../../../utils';
import { MaliciousAcknowledgementFormNames } from '../views/MaliciousAcknowledgement/constants';

const translate = i18n('en');

type Element = {
  type?: string;
  props?: Record<string, unknown>;
};

/**
 * Finds the first button element in the tree with the given name.
 *
 * @param node - The element to search.
 * @param name - The button name to match.
 * @returns The matching button props, or undefined.
 */
function findButton(
  node: ComponentOrElement | null,
  name: string,
): Record<string, unknown> | undefined {
  if (typeof node !== 'object' || node === null) {
    return undefined;
  }
  const element = node as Element;
  if (element.type === 'Button' && element.props?.name === name) {
    return element.props;
  }
  const children = element.props?.children;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    const found = findButton(child as ComponentOrElement | null, name);
    if (found) {
      return found;
    }
  }
  return undefined;
}

describe('ConfirmationFooter', () => {
  const baseProps = {
    locale: 'en',
    cancelButtonName: 'cancel',
    confirmButtonName: 'confirm',
  };

  it('renders the confirm button when acknowledgement is not required', () => {
    const footer = ConfirmationFooter({ ...baseProps });

    const confirm = findButton(footer, 'confirm');
    expect(confirm).toBeDefined();
    expect(confirm?.children).toBe(translate('confirmation.confirmButton'));
    expect(
      findButton(footer, MaliciousAcknowledgementFormNames.Review),
    ).toBeUndefined();
  });

  it('disables the confirm button when confirmDisabled is true', () => {
    const footer = ConfirmationFooter({ ...baseProps, confirmDisabled: true });

    expect(findButton(footer, 'confirm')?.disabled).toBe(true);
  });

  it('renders the review-alerts button when acknowledgement is required', () => {
    const footer = ConfirmationFooter({
      ...baseProps,
      requiresAcknowledgement: true,
    });

    const review = findButton(footer, MaliciousAcknowledgementFormNames.Review);
    expect(review).toBeDefined();
    expect(review?.children).toBe(translate('confirmation.reviewAlertsButton'));
    expect(findButton(footer, 'confirm')).toBeUndefined();
  });

  it('falls back to the disabled confirm button when blocked, even if acknowledgement is required', () => {
    const footer = ConfirmationFooter({
      ...baseProps,
      requiresAcknowledgement: true,
      confirmDisabled: true,
    });

    expect(
      findButton(footer, MaliciousAcknowledgementFormNames.Review),
    ).toBeUndefined();
    expect(findButton(footer, 'confirm')?.disabled).toBe(true);
  });

  it('always renders the cancel button', () => {
    const footer = ConfirmationFooter({
      ...baseProps,
      requiresAcknowledgement: true,
    });

    expect(findButton(footer, 'cancel')?.children).toBe(
      translate('confirmation.cancelButton'),
    );
  });
});
