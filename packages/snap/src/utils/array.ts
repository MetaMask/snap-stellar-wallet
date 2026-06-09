/**
 * Returns the entries of an object as an array of [key, value] pairs.
 *
 * @param obj - The object to get the entries of.
 * @returns The entries of the object as an array of [key, value] pairs.
 */
export function entries<Key extends string, Value>(
  obj: Partial<Record<Key, Value>>,
): [Key, Value][] {
  return Object.entries(obj) as [Key, Value][];
}

/**
 * Returns the keys of an object as an array of keys.
 *
 * @param obj - The object to get the keys of.
 * @returns The keys of the object as an array of keys.
 */
export function keys<Key extends string>(obj: Record<Key, unknown>): Key[] {
  return Object.keys(obj) as Key[];
}

/**
 * Returns the values of an object as an array of values.
 *
 * @param obj - The object to get the values of.
 * @returns The values of the object as an array of values.
 */
export function values<Value>(obj: Record<string, Value>): Value[] {
  return Object.values(obj);
}

/**
 * Pushes a value to an array in a record.
 * If the key does not exist, it will be created.
 *
 * @param record - The record to push the value to.
 * @param key - The key of the record to push the value to.
 * @param value - The value to push to the array.
 */
export function pushToRecordArray<Key extends PropertyKey, Value>(
  record: Partial<Record<Key, Value[]>>,
  key: Key,
  value: Value,
): void {
  (record[key] ??= []).push(value);
}
