import { array, assert } from '@metamask/superstruct';

import type { KnownCaip2ChainId } from '../api';
import { KnownCaip2ChainIdStruct } from '../api';
import { SUPPORTED_SCOPES } from '../constants';

/**
 * Scopes this snap supports, read from the `endowment:keyring` capabilities in
 * the snap manifest.
 *
 * @returns The supported scopes.
 * @throws When the manifest declares a scope that is not a known chain id.
 */
export function getSupportedScopes(): KnownCaip2ChainId[] {
  // Make sure the manifest only declares scopes this snap knows about.
  assert(SUPPORTED_SCOPES, array(KnownCaip2ChainIdStruct));
  return SUPPORTED_SCOPES;
}
