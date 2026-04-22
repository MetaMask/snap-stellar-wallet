import type {
  UserInputUiEventHandler,
  UserInputUiEventHandlerContext,
} from '../../../../handlers/user-input/api';
import { resolveInterface } from '../../../../utils';

/**
 * Handles the click event for the close button.
 *
 * @param options - The user input handler context from `onUserInput`.
 * @returns A promise that resolves when the interface has been updated.
 */
async function onCloseButtonClick(
  options: UserInputUiEventHandlerContext,
): Promise<void> {
  const { id } = options;
  await resolveInterface(id, true);
}

export enum AccountActivationPromptFormNames {
  Close = 'account-activation-prompt-close',
}

/**
 * Create event handlers bound to a SnapClient instance.
 *
 * @returns Object containing event handlers.
 */
export function createEventHandlers(): Record<string, UserInputUiEventHandler> {
  return {
    [AccountActivationPromptFormNames.Close]: async (options) =>
      onCloseButtonClick(options),
  };
}
