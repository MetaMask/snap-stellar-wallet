import type { JsonSLIP10Node } from '@metamask/key-tree';
import type { EntropySourceId } from '@metamask/keyring-api';
import type { EntropySource, Json, SnapsProvider } from '@metamask/snaps-sdk';

import { type Serializable, serialize, deserialize } from './serialization';

/**
 * Returns the Snap provider.
 *
 * @returns The Snap provider.
 */
export function getSnapProvider(): SnapsProvider {
  // snap is a global variable provided by the Snap SDK
  return snap;
}

/**
 * Retrieves a `SLIP10NodeInterface` object for the specified path and curve.
 *
 * @see https://docs.metamask.io/snaps/reference/snaps-api/#snap_getbip32entropy
 *
 * @param params - The parameters for the key derivation.
 * @param params.entropySource - The entropy source to use for key derivation.
 * @param params.path - The BIP32 derivation path for which to retrieve a `SLIP10NodeInterface`.
 * @param params.curve - The elliptic curve to use for key derivation.
 * @returns A Promise that resolves to a `SLIP10NodeInterface` object.
 */
export async function getBip32Entropy({
  entropySource,
  path,
  curve,
}: {
  entropySource?: EntropySourceId | undefined;
  path: string[];
  curve: 'secp256k1' | 'ed25519';
}): Promise<JsonSLIP10Node> {
  return getSnapProvider().request({
    method: 'snap_getBip32Entropy',
    params: {
      path,
      curve,
      ...(entropySource ? { source: entropySource } : {}),
    },
  });
}

/**
 * List all entropy sources.
 *
 * @returns An array of entropy sources.
 */
export async function listEntropySources(): Promise<EntropySource[]> {
  return getSnapProvider().request({
    method: 'snap_listEntropySources',
  });
}

/**
 * Retrieves the default entropy source.
 * The default entropy source is the entropy source that is used by default when no entropy source is provided.
 *
 * @returns A Promise that resolves to the default entropy source.
 * @throws An error if no default entropy source is found.
 */
export async function getDefaultEntropySource(): Promise<EntropySourceId> {
  const entropySources = await listEntropySources();
  const defaultEntropySource = entropySources.find(({ primary }) => primary);

  if (!defaultEntropySource) {
    // This can never happen because the Snap SDK always returns a default entropy source
    throw new Error('No default entropy source found');
  }

  return defaultEntropySource.id;
}

/**
 * Updates the state.
 *
 * @param params - The parameters for the state update.
 * @param params.newState - The new state to set.
 * @param params.encrypted - Whether the state is encrypted.
 * @returns A Promise that resolves when the state is updated.
 */
export async function updateState({
  newState,
  encrypted,
}: {
  newState: Record<string, Serializable>;
  encrypted: boolean;
}): Promise<void> {
  await getSnapProvider().request({
    method: 'snap_manageState',
    params: {
      operation: 'update',
      newState: serialize(newState) as Record<string, Json>,
      encrypted,
    },
  });
}

/**
 * Sets the state for the given key.
 *
 * @param params - The parameters for the state update.
 * @param params.key - The key (path) to set.
 * @param params.newState - The new state to set.
 * @param params.encrypted - Whether the state is encrypted.
 * @returns A Promise that resolves when the state is updated.
 */
export async function setState({
  key,
  newState,
  encrypted,
}: {
  key: string;
  newState: Serializable;
  encrypted: boolean;
}): Promise<void> {
  await getSnapProvider().request({
    method: 'snap_setState',
    params: {
      key,
      value: serialize(newState),
      encrypted,
    },
  });
}

/**
 * Retrieves the state for the given key.
 *
 * @param params - The parameters for the state retrieval.
 * @param params.key - (optional) The key to get the state for. If not provided, the whole state is returned.
 * @param params.encrypted - Whether the state is encrypted.
 * @returns The state for the given key.
 */
export async function getState({
  key,
  encrypted,
}: {
  key?: string;
  encrypted: boolean;
}): Promise<Serializable> {
  const state = await getSnapProvider().request({
    method: 'snap_getState',
    params: {
      ...(key ? { key } : {}),
      encrypted,
    },
  });

  if (state === null || state === undefined) {
    return undefined;
  }

  return deserialize(state);
}
