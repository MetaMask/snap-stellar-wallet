import { object, min, optional, string, integer } from '@metamask/superstruct';
import type { Infer } from '@metamask/superstruct';

/**
 * The struct for validating createAccount options.
 * - entropySource: Optional string for the entropy source
 * - index: Optional non-negative integer for account derivation index
 */
export const CreateAccountOptionsStruct = optional(
  object({
    entropySource: optional(string()),
    index: optional(min(integer(), 0)),
    addressType: optional(string()),
    scope: optional(string()),
    metamask: optional(
      object({
        correlationId: optional(string()),
      }),
    ),
  }),
);

/**
 * The options for the createAccount method.
 */
export type CreateAccountOptions = Infer<typeof CreateAccountOptionsStruct>;
