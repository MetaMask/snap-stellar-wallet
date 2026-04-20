import type { JsonSLIP10Node } from '@metamask/key-tree';
import type { EntropySourceId } from '@metamask/keyring-api';
import type {
  ComponentOrElement,
  DialogResult,
  EntropySource,
  GetClientStatusResult,
  GetPreferencesResult,
  Json,
  ResolveInterfaceResult,
  SnapsProvider,
  UpdateInterfaceResult,
} from '@metamask/snaps-sdk';

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

/**
 * Retrieves the client status (locked/unlocked) in this case from MM.
 *
 * @returns An object containing the status.
 */
export async function getClientStatus(): Promise<GetClientStatusResult> {
  return getSnapProvider().request({
    method: 'snap_getClientStatus',
  });
}

/**
 * Schedules a background event.
 *
 * @param options - The options for the background event.
 * @param options.method - The method to call.
 * @param options.params - The params to pass to the method.
 * @param options.duration - The duration to wait before the event is scheduled.
 * @returns A promise that resolves to a string.
 */
export async function scheduleBackgroundEvent({
  method,
  params = {},
  duration,
}: {
  method: string;
  params?: Record<string, Json>;
  duration: string;
}): Promise<string> {
  return getSnapProvider().request({
    method: 'snap_scheduleBackgroundEvent',
    params: {
      duration,
      request: {
        method,
        params,
      },
    },
  });
}

/**
 * Checks if an error is an "interface not found" error.
 * Detects JSON-RPC errors thrown when an interface has been dismissed by the user.
 *
 * @param error - The error to check.
 * @returns True if the error indicates the interface was not found.
 */
function isInterfaceNotFoundError(error: unknown): boolean {
  let message = '';
  if (error instanceof Error) {
    message = error.message.toLowerCase();
  } else if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error
  ) {
    message = (error.message as string).toLowerCase();
  } else {
    message = String(error).toLowerCase();
  }
  return message.includes('interface') && message.includes('not found');
}

/**
 * Create a UI interface with the provided UI component and context.
 *
 * @param ui - The UI component to render.
 * @param context - The initial context object to associate with the interface.
 * @returns The created interface id.
 */
export async function createInterface<TContext>(
  ui: ComponentOrElement,
  context: TContext & Record<string, Json>,
): Promise<string> {
  return getSnapProvider().request({
    method: 'snap_createInterface',
    params: {
      ui,
      context,
    },
  });
}

/**
 * Update an existing UI interface with a new UI component and context.
 * Returns null if the interface has been dismissed by the user.
 *
 * @param id - The interface id returned from createInterface.
 * @param ui - The new UI component to render.
 * @param context - The updated context object to associate with the interface.
 * @returns True if the interface was updated, or null if it was not found.
 */
export async function updateInterfaceIfExists<TContext>(
  id: string,
  ui: ComponentOrElement,
  context: TContext & Record<string, Json>,
): Promise<true | null> {
  try {
    await getSnapProvider().request({
      method: 'snap_updateInterface',
      params: {
        id,
        ui,
        context,
      },
    });
    return true;
  } catch (error) {
    if (isInterfaceNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Gets the context of an interface by its ID.
 * Returns null if the interface has been dismissed by the user.
 *
 * @param id - The ID for the interface.
 * @returns The context object associated with the interface, or null if not found.
 */
export async function getInterfaceContextIfExists<TContext extends Json>(
  id: string,
): Promise<TContext | null> {
  try {
    const rawContext = await getSnapProvider().request({
      method: 'snap_getInterfaceContext',
      params: {
        id,
      },
    });

    if (!rawContext) {
      return null;
    }

    return rawContext as TContext;
  } catch (error) {
    if (isInterfaceNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Updates the context of an interface by its ID without changing the UI.
 * Note: This is a helper that re-uses the existing UI.
 *
 * @param id - The ID for the interface.
 * @param ui - The UI component.
 * @param context - The updated context object.
 * @returns The update interface result.
 */
export async function updateInterfaceWithContext<
  TContext extends Record<string, Json>,
>(
  id: string,
  ui: ComponentOrElement,
  context: TContext,
): Promise<UpdateInterfaceResult> {
  return getSnapProvider().request({
    method: 'snap_updateInterface',
    params: {
      id,
      ui,
      context,
    },
  });
}

/**
 * Shows a dialog using the provided ID.
 *
 * @param id - The ID for the dialog.
 * @returns A promise that resolves to a string.
 */
export async function showDialog(id: string): Promise<DialogResult> {
  return getSnapProvider().request({
    method: 'snap_dialog',
    params: {
      id,
    },
  });
}

/**
 * Resolve a dialog using the provided ID.
 *
 * @param id - The ID for the interface to update.
 * @param value - The result to resolve the interface with.
 * @returns An object containing the state of the interface.
 */
export async function resolveInterface(
  id: string,
  value: Json,
): Promise<ResolveInterfaceResult> {
  return getSnapProvider().request({
    method: 'snap_resolveInterface',
    params: {
      id,
      value,
    },
  });
}

/**
 * Get preferences from snap.
 *
 * @returns A promise that resolves to snap preferences.
 */
export async function getPreferences(): Promise<GetPreferencesResult> {
  return getSnapProvider().request({
    method: 'snap_getPreferences',
  });
}
