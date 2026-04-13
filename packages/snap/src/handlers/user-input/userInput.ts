import type { InterfaceContext, UserInputEvent } from '@metamask/snaps-sdk';

import type { UserInputUiEventHandler } from './api';
import { createEventHandlers as createSignMessageEvents } from '../../ui/confirmation/views/ConfirmSignMessage/events';
import { createEventHandlers as createSignTransactionEvents } from '../../ui/confirmation/views/ConfirmSignTransaction/events';
import {
  withCatchAndThrowSnapError,
  createPrefixedLogger,
  type ILogger,
} from '../../utils';

export class UserInputHandler {
  readonly #logger: ILogger;

  constructor({ logger }: { logger: ILogger }) {
    this.#logger = createPrefixedLogger(logger, '[👵 LifecycleHandler]');
  }

  /**
   * Handle user events requests.
   *
   * @param args - The request handler args as object.
   * @param args.id - The interface id associated with the event.
   * @param args.event - The event object.
   * @param args.context - The context object.
   * @returns A promise that resolves to a JSON object.
   * @throws If the request method is not valid for this snap.
   */
  async handle({
    id,
    event,
    context,
  }: {
    id: string;
    event: UserInputEvent;
    context: InterfaceContext | null;
  }): Promise<void> {
    this.#logger.log('[👇 onUserInput]', id, event);

    if (!event.name) {
      return;
    }
    const uiEventHandlers: Record<string, UserInputUiEventHandler> = {
      ...createSignMessageEvents(),
      ...createSignTransactionEvents(),
    };

    /**
     * Using the name of the event, route it to the correct handler
     */
    const handler = uiEventHandlers[event.name];

    if (!handler) {
      return;
    }

    await withCatchAndThrowSnapError(async () =>
      handler({ id, event, context }),
    );
  }
}
