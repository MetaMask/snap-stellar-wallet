import type { InterfaceContext, UserInputEvent } from '@metamask/snaps-sdk';

export type UserInputUiEventHandlerContext = {
  id: string;
  event: UserInputEvent;
  context: InterfaceContext | null;
};

export type UserInputUiEventHandler = (
  options: UserInputUiEventHandlerContext,
) => Promise<void>;
