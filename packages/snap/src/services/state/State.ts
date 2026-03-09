import type { MutexInterface } from 'async-mutex';
import { Mutex } from 'async-mutex';
import { unset } from 'lodash';

import type { IStateManager } from './IStateManager';
import {
  type Serializable,
  safeMerge,
  getState,
  setState,
  updateState,
} from '../../utils';

export type StateConfig<TValue extends Record<string, Serializable>> = {
  encrypted: boolean;
  defaultState: TValue;
};

/**
 * Because we use both snap_manageState and snap_setState, we must protect against them being used at the same time.
 * We must also protect against multiple parallel requests to snap_manageState.
 * snap_setState, snap_getState, etc.
 */
class StateLock {
  readonly #blobModificationMutex = new Mutex();

  readonly #regularStateUpdateMutex = new Mutex();

  #pendingRegularStateUpdates = 0;

  #releaseRegularStateUpdateMutex: MutexInterface.Releaser | null = null;

  async #acquireRegularStateUpdateMutex(): Promise<void> {
    if (!this.#regularStateUpdateMutex.isLocked()) {
      this.#releaseRegularStateUpdateMutex =
        await this.#regularStateUpdateMutex.acquire();
    }
  }

  /**
   * Wraps a regular state operation in a mutex to protect against concurrent access.
   * This is used for operations that read or modify parts of the state (e.g. snap_getState, snap_setState).
   *
   * @param callback - The callback to wrap.
   * @returns The result of the callback.
   */
  async wrapRegularStateOperation<ReturnType>(
    callback: MutexInterface.Worker<ReturnType>,
  ): Promise<ReturnType> {
    // If we are currently doing a full blob update, wait it out.
    // Signal that regular state operations are ongoing by acquiring the mutex.
    // Other regular state operations can skip this, as they are safe to do in parallel.
    await Promise.all([
      this.#blobModificationMutex.waitForUnlock(),
      this.#acquireRegularStateUpdateMutex(),
    ]);

    try {
      this.#pendingRegularStateUpdates += 1;
      return await callback();
    } finally {
      this.#pendingRegularStateUpdates -= 1;

      if (
        this.#pendingRegularStateUpdates === 0 &&
        this.#releaseRegularStateUpdateMutex
      ) {
        this.#releaseRegularStateUpdateMutex();
      }
    }
  }

  /**
   * Wraps a manage-state (full blob) operation in a mutex to protect against concurrent access.
   * This is used for operations that modify the entire state blob, such as snap_manageState.
   *
   * @param callback - The callback to wrap.
   * @returns The result of the callback.
   */
  async wrapManageStateOperation<ReturnType>(
    callback: MutexInterface.Worker<ReturnType>,
  ): Promise<ReturnType> {
    return await this.#blobModificationMutex.runExclusive(async () => {
      await this.#regularStateUpdateMutex.waitForUnlock();
      return await callback();
    });
  }
}

/**
 * This class is a layer on top of the `snap_manageState` API that facilitates its usage:
 *
 * Basic usage:
 * - Get and update the state of the snap
 *
 * Serialization:
 * - It serializes the data before storing it in the Snap state because only JSON-assignable data can be stored.
 * - It deserializes the data after retrieving it from the Snap state.
 * - So you don't need to worry about the data format when storing or retrieving data.
 *
 * Default values:
 * - It merges the default state with the underlying Snap state to ensure that we always have default values,
 * letting us avoid a ton of null checks everywhere.
 */
export class State<
  TStateValue extends Record<string, Serializable>,
> implements IStateManager<TStateValue> {
  readonly #lock = new StateLock();

  readonly #config: StateConfig<TStateValue>;

  constructor(config: StateConfig<TStateValue>) {
    this.#config = config;
  }

  async #unsafeGet(): Promise<TStateValue> {
    const state = await getState({
      encrypted: this.#config.encrypted,
    });

    const stateDeserialized = (state as TStateValue) ?? {};

    // Merge the default state with the underlying Snap state
    // to ensure that we always have default values. It lets us avoid a ton of null checks everywhere.
    const stateWithDefaults = safeMerge(
      this.#config.defaultState,
      stateDeserialized,
    );

    return stateWithDefaults;
  }

  async get(): Promise<TStateValue> {
    return this.#lock.wrapRegularStateOperation(async () => this.#unsafeGet());
  }

  async getKey<TResponse extends Serializable>(
    key: string,
  ): Promise<TResponse | undefined> {
    return this.#lock.wrapRegularStateOperation(async () => {
      const state = await getState({
        key,
        encrypted: this.#config.encrypted,
      });

      return state as TResponse;
    });
  }

  async setKey(key: string, value: Serializable): Promise<void> {
    await this.#lock.wrapRegularStateOperation(async () => {
      await setState({
        key,
        newState: value,
        encrypted: this.#config.encrypted,
      });
    });
  }

  async update(
    updaterFunction: (state: TStateValue) => TStateValue,
  ): Promise<TStateValue> {
    // Because this function modifies the entire state blob,
    // we must protect against parallel requests.
    return await this.#lock.wrapManageStateOperation(async () => {
      const currentState = await this.#unsafeGet();

      const newState = updaterFunction(currentState);

      // Generally we should try to use snap_getState and snap_setState instead of this,
      // as snap_manageState is slower and error-prone due to requiring manual mutex management.
      await updateState({
        newState,
        encrypted: this.#config.encrypted,
      });

      return newState;
    });
  }

  async deleteKey(key: string): Promise<void> {
    await this.update((state) => {
      // Using lodash's unset to leverage the JSON path capabilities
      unset(state, key);
      return state;
    });
  }

  async deleteKeys(keys: string[]): Promise<void> {
    await this.update((state) => {
      keys.forEach((key) => {
        unset(state, key);
      });
      return state;
    });
  }
}
