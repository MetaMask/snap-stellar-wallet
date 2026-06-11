import type { UserInputEvent } from '@metamask/snaps-sdk';
import { UserInputEventType } from '@metamask/snaps-sdk';

import { MaliciousAcknowledgementFormNames } from './constants';
import { createEventHandlers } from './events';
import { resolveInterface, updateInterfaceIfExists } from '../../../../utils';
import { ConfirmationInterfaceKey } from '../../api';
import { renderConfirmationView } from '../render';

jest.mock('../render', () => ({
  renderConfirmationView: jest.fn(() => 'RENDERED'),
}));

jest.mock('../../../../utils', () => ({
  ...jest.requireActual('../../../../utils'),
  resolveInterface: jest.fn(),
  updateInterfaceIfExists: jest.fn(),
}));

const INTERFACE_ID = 'interface-id';

const baseContext = {
  interfaceKey: ConfirmationInterfaceKey.ConfirmSendTransaction,
  locale: 'en',
  acknowledgementScreen: false,
  acknowledged: false,
};

const buttonEvent = (name: string): UserInputEvent =>
  ({ type: UserInputEventType.ButtonClickEvent, name }) as UserInputEvent;

const checkboxEvent = (name: string, value: boolean): UserInputEvent =>
  ({
    type: UserInputEventType.InputChangeEvent,
    name,
    value,
  }) as unknown as UserInputEvent;

describe('malicious acknowledgement events', () => {
  const handlers = createEventHandlers();

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(renderConfirmationView)
      .mockReturnValue(
        'RENDERED' as unknown as ReturnType<typeof renderConfirmationView>,
      );
  });

  it('opens the acknowledgement screen on "Review alerts"', async () => {
    const name = MaliciousAcknowledgementFormNames.Review;
    await handlers[name]?.({
      id: INTERFACE_ID,
      event: buttonEvent(name),
      context: baseContext,
    });

    const expectedContext = {
      ...baseContext,
      acknowledgementScreen: true,
      acknowledged: false,
    };
    expect(renderConfirmationView).toHaveBeenCalledWith(
      ConfirmationInterfaceKey.ConfirmSendTransaction,
      expectedContext,
    );
    expect(updateInterfaceIfExists).toHaveBeenCalledWith(
      INTERFACE_ID,
      'RENDERED',
      expectedContext,
    );
    expect(resolveInterface).not.toHaveBeenCalled();
  });

  it('tracks the acknowledgement checkbox value', async () => {
    const name = MaliciousAcknowledgementFormNames.Acknowledge;
    await handlers[name]?.({
      id: INTERFACE_ID,
      event: checkboxEvent(name, true),
      context: { ...baseContext, acknowledgementScreen: true },
    });

    expect(updateInterfaceIfExists).toHaveBeenCalledWith(
      INTERFACE_ID,
      'RENDERED',
      expect.objectContaining({ acknowledged: true }),
    );
  });

  it('resolves the interface on "Confirm"', async () => {
    const name = MaliciousAcknowledgementFormNames.Proceed;
    await handlers[name]?.({
      id: INTERFACE_ID,
      event: buttonEvent(name),
      context: {
        ...baseContext,
        acknowledgementScreen: true,
        acknowledged: true,
      },
    });

    expect(resolveInterface).toHaveBeenCalledWith(INTERFACE_ID, true);
    expect(updateInterfaceIfExists).not.toHaveBeenCalled();
  });

  it('does not resolve on "Confirm" when the risk is not acknowledged', async () => {
    const name = MaliciousAcknowledgementFormNames.Proceed;
    await handlers[name]?.({
      id: INTERFACE_ID,
      event: buttonEvent(name),
      context: {
        ...baseContext,
        acknowledgementScreen: true,
        acknowledged: false,
      },
    });

    expect(resolveInterface).not.toHaveBeenCalled();
  });

  it('returns to the confirmation view on "Go back"', async () => {
    const name = MaliciousAcknowledgementFormNames.Back;
    await handlers[name]?.({
      id: INTERFACE_ID,
      event: buttonEvent(name),
      context: {
        ...baseContext,
        acknowledgementScreen: true,
        acknowledged: true,
      },
    });

    expect(updateInterfaceIfExists).toHaveBeenCalledWith(
      INTERFACE_ID,
      'RENDERED',
      expect.objectContaining({
        acknowledgementScreen: false,
        acknowledged: false,
      }),
    );
    expect(resolveInterface).not.toHaveBeenCalled();
  });

  it('does nothing when the interface context is missing', async () => {
    const name = MaliciousAcknowledgementFormNames.Review;
    await handlers[name]?.({
      id: INTERFACE_ID,
      event: buttonEvent(name),
      context: null,
    });

    expect(updateInterfaceIfExists).not.toHaveBeenCalled();
  });
});
