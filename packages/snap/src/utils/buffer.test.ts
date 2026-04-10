/* eslint-disable no-restricted-globals -- Buffer is asserted in Node test runtime only */
import { bufferToUint8Array } from './buffer';

describe('bufferToUint8Array', () => {
  it('copies Uint8Array into a Buffer', () => {
    const input = new Uint8Array([1, 2, 3, 255]);
    const result = bufferToUint8Array(input);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(Array.from(result)).toStrictEqual([1, 2, 3, 255]);
  });

  it('decodes a utf8 string when encode is omitted', () => {
    const result = bufferToUint8Array('hello');
    expect(result.toString('utf8')).toBe('hello');
  });

  it('decodes a utf8 string when encode is utf8', () => {
    const result = bufferToUint8Array('hello', 'utf8');
    expect(result.toString('utf8')).toBe('hello');
  });

  it('decodes a hex string', () => {
    const result = bufferToUint8Array('deadbeef', 'hex');
    expect(Array.from(result)).toStrictEqual([222, 173, 190, 239]);
  });

  it('decodes a base64 string', () => {
    const result = bufferToUint8Array('YWI=', 'base64');
    expect(result.toString('utf8')).toBe('ab');
  });

  it('throws Invalid buffer when Buffer.from rejects the encoding', () => {
    expect(() =>
      // @ts-expect-error — invalid encoding exercises the catch path
      bufferToUint8Array('aa', 'bogus'),
    ).toThrow('Invalid buffer');
  });
});
/* eslint-enable no-restricted-globals */
