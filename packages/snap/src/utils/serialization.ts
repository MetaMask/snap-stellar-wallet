/* eslint-disable @typescript-eslint/naming-convention */
import type { Json } from '@metamask/snaps-sdk';
import { BigNumber } from 'bignumber.js';
import { cloneDeepWith } from 'lodash';

/**
 * A primitive value that can be serialized to JSON using the `serialize` function.
 */
export type Serializable =
  | Json
  | undefined
  | null
  | bigint
  | BigNumber
  | Uint8Array
  | Serializable[]
  | {
      [prop: string]: Serializable;
    };

/**
 * Serializes the passed value to a JSON object so it can be stored in JSON-serializable storage like the snap state and interface context.
 * It transforms non-JSON-serializable values into a specific JSON-serializable representation that can be deserialized later.
 *
 * @param value - The value to serialize.
 * @returns The serialized value.
 * @throws If an unsupported case is encountered. This indicates a missing implementation.
 */
export const serialize = (value: Serializable): Json =>
  cloneDeepWith(value, (val: unknown) => {
    if (val === undefined) {
      return {
        __type: 'undefined',
      };
    }

    if (val instanceof BigNumber) {
      return {
        __type: 'BigNumber',
        value: val.toString(),
      };
    }

    if (typeof val === 'bigint') {
      return {
        __type: 'bigint',
        value: val.toString(),
      };
    }

    if (val instanceof Uint8Array) {
      // Convert Uint8Array to base64 string without using Buffer
      let binaryString = '';
      for (const byte of val) {
        binaryString += String.fromCharCode(byte);
      }
      return {
        __type: 'Uint8Array',
        value: btoa(binaryString),
      };
    }

    // Return undefined to let lodash handle the cloning of other values
    return undefined;
  });

/**
 * Deserializes the passed value from a JSON object to an object with its the original values.
 * It transforms the JSON-serializable representation of non-JSON-serializable values back into their original values.
 *
 * @param serializedValue - The value to deserialize.
 * @returns The deserialized value.
 */
export const deserialize = (serializedValue: Json): Serializable =>
  JSON.parse(JSON.stringify(serializedValue), (_key, value) => {
    if (!value) {
      return value;
    }

    if (value.__type === 'undefined') {
      return undefined;
    }

    if (value.__type === 'BigNumber') {
      return new BigNumber(value.value);
    }

    if (value.__type === 'bigint') {
      return BigInt(value.value);
    }

    if (value.__type === 'Uint8Array') {
      const binaryString = atob(value.value);
      const bytes = new Uint8Array(binaryString.length);
      for (let index = 0; index < binaryString.length; index++) {
        bytes[index] = binaryString.charCodeAt(index);
      }
      return bytes;
    }

    return value;
  });
/* eslint-enable @typescript-eslint/naming-convention */
