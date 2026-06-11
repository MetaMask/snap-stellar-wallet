import type { ComponentOrElement } from '@metamask/snaps-sdk';

import { MaliciousAcknowledgementFormNames } from './constants';
import { MaliciousAcknowledgementScreen } from './MaliciousAcknowledgementScreen';

type Element = {
  type?: string;
  props?: Record<string, unknown>;
};

/**
 * Recursively finds the first element matching a predicate.
 *
 * @param node - The element to search.
 * @param match - Predicate over an element.
 * @returns The matching element props, or undefined.
 */
function find(
  node: ComponentOrElement | null,
  match: (element: Element) => boolean,
): Record<string, unknown> | undefined {
  if (typeof node !== 'object' || node === null) {
    return undefined;
  }
  const element = node as Element;
  if (match(element)) {
    return element.props;
  }
  const children = element.props?.children;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    const found = find(child as ComponentOrElement | null, match);
    if (found) {
      return found;
    }
  }
  return undefined;
}

const byNamed = (type: string, name: string) => (element: Element) =>
  element.type === type && element.props?.name === name;

const findButton = (node: ComponentOrElement | null, name: string) =>
  find(node, byNamed('Button', name));

const isBanner = (element: Element) => element.type === 'Banner';

describe('MaliciousAcknowledgementScreen', () => {
  it('renders a danger banner with the malicious warning copy', () => {
    const screen = MaliciousAcknowledgementScreen({ locale: 'en' });

    const banner = find(screen, isBanner);
    expect(banner).toMatchObject({
      severity: 'danger',
      title: 'Malicious request',
    });
  });

  it('disables the proceed button until the risk is acknowledged', () => {
    const screen = MaliciousAcknowledgementScreen({
      locale: 'en',
      acknowledged: false,
    });

    expect(
      findButton(screen, MaliciousAcknowledgementFormNames.Proceed)?.disabled,
    ).toBe(true);
  });

  it('enables the proceed button once the risk is acknowledged', () => {
    const screen = MaliciousAcknowledgementScreen({
      locale: 'en',
      acknowledged: true,
    });

    expect(
      findButton(screen, MaliciousAcknowledgementFormNames.Proceed)?.disabled,
    ).toBe(false);
  });

  it('reflects the acknowledgement state on the checkbox', () => {
    const screen = MaliciousAcknowledgementScreen({
      locale: 'en',
      acknowledged: true,
    });

    const checkbox = find(
      screen,
      byNamed('Checkbox', MaliciousAcknowledgementFormNames.Acknowledge),
    );
    expect(checkbox?.checked).toBe(true);
  });

  it('renders a back button', () => {
    const screen = MaliciousAcknowledgementScreen({ locale: 'en' });

    expect(
      findButton(screen, MaliciousAcknowledgementFormNames.Back),
    ).toBeDefined();
  });
});
