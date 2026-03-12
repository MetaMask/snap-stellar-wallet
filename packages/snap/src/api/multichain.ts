import { enums } from '@metamask/superstruct';

export enum MultichainMethod {
  SignMessage = 'signMessage',
  SignTransaction = 'signTransaction',
}

export const MultichainMethodStruct = enums(Object.values(MultichainMethod));
