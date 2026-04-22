import type { JsonRpcRequest } from '@metamask/snaps-sdk';
import { ensureError } from '@metamask/utils';

import type { BackgroundEventMethod, ICronjobRequestHandler } from './api';
import { BackgroundEventMethodStruct } from './api';
import { CronjobMethodNotFoundError } from './exceptions';
import { getClientStatus } from '../../utils/snap';

export class CronjobHandler {
  readonly #handlers: Record<BackgroundEventMethod, ICronjobRequestHandler>;

  constructor({
    handlers,
  }: {
    handlers: Record<BackgroundEventMethod, ICronjobRequestHandler>;
  }) {
    this.#handlers = handlers;
  }

  async handle(request: JsonRpcRequest): Promise<void> {
    const { active, locked } = await getClientStatus();

    // if the client is not active or locked, we dont execute the cronjob
    if (!active || locked) {
      return;
    }

    await this.#handleClientRequest(request);
  }

  async #handleClientRequest(request: JsonRpcRequest): Promise<void> {
    const { method } = request;

    const [validateError, validatedMethod] =
      BackgroundEventMethodStruct.validate(method);
    if (validateError !== undefined) {
      throw ensureError(new CronjobMethodNotFoundError(method));
    }

    const handler = this.#handlers[validatedMethod];

    await handler.handle(request);
  }
}
