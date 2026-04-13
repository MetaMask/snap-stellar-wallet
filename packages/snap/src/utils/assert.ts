/**
 * Asserts two strings are the same ignoring case.
 *
 * @param string1 - The first string to compare.
 * @param string2 - The second string to compare.
 * @returns True if the strings are the same ignoring case, false otherwise.
 */
export function isSameStr(string1: string, string2: string): boolean {
  return string1.toLowerCase() === string2.toLowerCase();
}
