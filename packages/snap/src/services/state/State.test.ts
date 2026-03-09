/* eslint-disable jest/prefer-strict-equal */
/* eslint-disable @typescript-eslint/naming-convention */
import { BigNumber } from 'bignumber.js';

import { State } from './State';
import { getSnapProvider } from '../../utils/snap';

jest.mock('../../utils/snap');

type User = {
  name: string;
  age: BigNumber | bigint | number | undefined | null;
};

type MockStateValue = {
  users: User[];
};

const DEFAULT_STATE: MockStateValue = {
  users: [
    {
      name: 'John',
      age: 30,
    },
    {
      name: 'Jane',
      age: 25,
    },
  ],
};

describe('State', () => {
  let state: State<MockStateValue>;

  const snapProvider = getSnapProvider() as { request: jest.Mock };

  beforeEach(() => {
    state = new State<MockStateValue>({
      encrypted: false,
      defaultState: DEFAULT_STATE,
    });

    jest.clearAllMocks();
  });

  afterEach(() => {
    snapProvider.request.mockReset();
  });

  describe('get', () => {
    it('gets the state', async () => {
      const mockUnderlyingState = DEFAULT_STATE;
      snapProvider.request.mockResolvedValue(mockUnderlyingState);

      const stateValue = await state.get();

      expect(snapProvider.request).toHaveBeenCalledWith({
        method: 'snap_getState',
        params: { encrypted: false },
      });
      expect(stateValue).toStrictEqual(mockUnderlyingState);
    });

    it('gets the default state if the snap state is empty', async () => {
      const mockUnderlyingState = {};
      snapProvider.request.mockResolvedValue(mockUnderlyingState);

      const stateValue = await state.get();

      expect(stateValue).toStrictEqual(DEFAULT_STATE);
    });

    describe('when getting serialized non-JSON values', () => {
      it('deserializes undefined values', async () => {
        const mockUnderlyingState = {
          users: [
            {
              name: 'JohnStanley',
              age: {
                __type: 'undefined',
              },
            },
          ],
        };
        snapProvider.request.mockResolvedValue(mockUnderlyingState);

        const stateValue = await state.get();

        expect(stateValue).toEqual({
          users: [
            {
              name: 'JohnStanley',
              age: undefined,
            },
          ],
        });
      });

      it('deserializes BigNumber values', async () => {
        const mockUnderlyingState = {
          users: [
            {
              name: 'John',
              age: {
                __type: 'BigNumber',
                value: '30',
              },
            },
          ],
        };
        snapProvider.request.mockResolvedValue(mockUnderlyingState);

        const stateValue = await state.get();

        expect(stateValue).toStrictEqual({
          users: [
            {
              name: 'John',
              age: new BigNumber(30),
            },
          ],
        });
      });

      it('deserializes bigint values', async () => {
        const mockUnderlyingState = {
          users: [
            {
              name: 'John',
              age: {
                __type: 'bigint',
                value: '30',
              },
            },
          ],
        };
        snapProvider.request.mockResolvedValue(mockUnderlyingState);

        const stateValue = await state.get();

        expect(stateValue).toStrictEqual({
          users: [
            {
              name: 'John',
              age: BigInt(30),
            },
          ],
        });
      });
    });
  });

  describe('getKey', () => {
    it('calls the snap_getState method with the correct parameters', async () => {
      const mockUnderlyingState = DEFAULT_STATE;
      snapProvider.request.mockResolvedValue(mockUnderlyingState);

      await state.getKey('users.1.name');

      expect(snapProvider.request).toHaveBeenCalledWith({
        method: 'snap_getState',
        params: { key: 'users.1.name', encrypted: false },
      });
    });

    it('returns undefined if the key does not exist', async () => {
      snapProvider.request.mockResolvedValue(undefined);

      const value = await state.getKey('users.1.name');

      expect(value).toBeUndefined();
    });
  });

  describe('setKey', () => {
    it('sets the value of a key', async () => {
      await state.setKey('users.1.name', 'Bob');

      expect(snapProvider.request).toHaveBeenCalledWith({
        method: 'snap_setState',
        params: {
          key: 'users.1.name',
          value: 'Bob',
          encrypted: false,
        },
      });
    });
  });

  describe('update', () => {
    it('updates the state', async () => {
      await state.update((currentState) => ({
        users: [
          ...currentState.users,
          {
            name: 'Bob',
            age: 50,
          },
        ],
      }));

      expect(snapProvider.request).toHaveBeenCalledWith({
        method: 'snap_getState',
        params: { encrypted: false },
      });

      expect(snapProvider.request).toHaveBeenCalledWith({
        method: 'snap_manageState',
        params: {
          operation: 'update',
          encrypted: false,
          newState: {
            users: [
              ...DEFAULT_STATE.users,
              {
                name: 'Bob',
                age: 50,
              },
            ],
          },
        },
      });
    });

    describe('when updating serialized non-JSON values', () => {
      it('serializes undefined values', async () => {
        await state.update((currentState) => ({
          users: [
            ...currentState.users,
            {
              name: 'Bob',
              age: undefined,
            },
          ],
        }));

        expect(snapProvider.request).toHaveBeenNthCalledWith(2, {
          method: 'snap_manageState',
          params: {
            operation: 'update',
            encrypted: false,
            newState: {
              users: [
                ...DEFAULT_STATE.users,
                {
                  name: 'Bob',
                  age: {
                    __type: 'undefined',
                  },
                },
              ],
            },
          },
        });
      });

      it('serializes BigNumber values', async () => {
        await state.update((currentState) => ({
          users: [
            ...currentState.users,
            {
              name: 'Bob',
              age: new BigNumber(50),
            },
          ],
        }));

        expect(snapProvider.request).toHaveBeenNthCalledWith(2, {
          method: 'snap_manageState',
          params: {
            operation: 'update',
            encrypted: false,
            newState: {
              users: [
                ...DEFAULT_STATE.users,
                {
                  name: 'Bob',
                  age: {
                    __type: 'BigNumber',
                    value: '50',
                  },
                },
              ],
            },
          },
        });
      });

      it('serializes bigint values', async () => {
        await state.update((currentState) => ({
          users: [
            ...currentState.users,
            {
              name: 'Bob',
              age: BigInt(50),
            },
          ],
        }));

        expect(snapProvider.request).toHaveBeenNthCalledWith(2, {
          method: 'snap_manageState',
          params: {
            operation: 'update',
            encrypted: false,
            newState: {
              users: [
                ...DEFAULT_STATE.users,
                {
                  name: 'Bob',
                  age: {
                    __type: 'bigint',
                    value: '50',
                  },
                },
              ],
            },
          },
        });
      });

      it('serializes null values', async () => {
        await state.update((currentState) => ({
          users: [...currentState.users, { name: 'Bob', age: null }],
        }));

        expect(snapProvider.request).toHaveBeenNthCalledWith(2, {
          method: 'snap_manageState',
          params: {
            operation: 'update',
            encrypted: false,
            newState: {
              users: [...DEFAULT_STATE.users, { name: 'Bob', age: null }],
            },
          },
        });
      });
    });
  });

  describe('deleteKey', () => {
    it('deletes a key', async () => {
      await state.deleteKey('users');

      expect(snapProvider.request).toHaveBeenCalledWith({
        method: 'snap_manageState',
        params: {
          operation: 'update',
          newState: {},
          encrypted: false,
        },
      });
    });

    it('deletes a nested key', async () => {
      await state.deleteKey('users[0].age');

      expect(snapProvider.request).toHaveBeenCalledWith({
        method: 'snap_manageState',
        params: {
          operation: 'update',
          newState: {
            users: [
              {
                name: 'John',
              },
              {
                name: 'Jane',
                age: 25,
              },
            ],
          },
          encrypted: false,
        },
      });
    });
  });

  describe('deleteKeys', () => {
    it('deletes multiple keys', async () => {
      await state.deleteKeys(['users.1.name', 'users.2.name']);
      // TODO: check the state after the deletion
      expect(snapProvider.request).toHaveBeenCalledTimes(2);
    });
  });
});
