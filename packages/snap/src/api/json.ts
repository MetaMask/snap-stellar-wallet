import {
  literal,
  object,
  string,
  union,
  number,
  optional,
} from '@metamask/superstruct';

/**
 * Validation struct for the JSON-RPC request.
 */
export const JsonRpcRequestStruct = object({
  jsonrpc: literal('2.0'),
  id: union([string(), number(), literal(null)] as const),
  method: string(),
  params: optional(object()),
});
