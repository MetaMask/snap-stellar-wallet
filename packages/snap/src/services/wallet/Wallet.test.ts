import { PrivateKeyEncoding } from '@metamask/keyring-api/v2';
import { hexToBytes } from '@metamask/utils';
import { base58 } from '@scure/base';
import { hash, Keypair } from '@stellar/stellar-sdk';

import { getTestWallet } from './__mocks__/wallet.fixtures';
import { Wallet } from './Wallet';
import { bufferToUint8Array } from '../../utils/buffer';
import { buildMockClassicTransaction } from '../transaction/__mocks__/transaction.fixtures';

jest.mock('../../utils/logger');

describe('Wallet', () => {
  const seed = hexToBytes(
    '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  );
  const otherSeed = hexToBytes(
    'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  );

  describe('address', () => {
    it('returns the signer public key for a derived wallet', () => {
      const wallet = getTestWallet({ seed });
      const expected = Keypair.fromRawEd25519Seed(
        bufferToUint8Array(seed),
      ).publicKey();
      expect(wallet.address).toStrictEqual(expected);
    });
  });

  describe('signMessage', () => {
    it('returns a base64-encoded signature for a string message', () => {
      const wallet = getTestWallet({ seed });
      const signature = wallet.signMessage('hello stellar');
      expect(signature).toMatch(/^[A-Za-z0-9+/]+=*$/u);
      expect(signature.length).toBeGreaterThan(0);
    });

    it('matches string and UTF-8 bytes for the same logical message', () => {
      const wallet = getTestWallet({ seed });
      const text = 'hello stellar';
      const asString = wallet.signMessage(text);
      const asBytes = wallet.signMessage(new TextEncoder().encode(text));
      expect(asString).toStrictEqual(asBytes);
    });

    // https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md
    describe('SEP-0053 reference vectors', () => {
      const sep0053Secret =
        'SAKICEVQLYWGSOJS4WW7HZJWAHZVEEBS527LHK5V4MLJALYKICQCJXMW';

      const sep0053Wallet = new Wallet(Keypair.fromSecret(sep0053Secret));

      it.each([
        {
          message: bufferToUint8Array('Hello, World!', 'utf8'),
          signature:
            'fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==',
        },
        {
          message: bufferToUint8Array('こんにちは、世界！', 'utf8'),
          signature:
            'CDU265Xs8y3OWbB/56H9jPgUss5G9A0qFuTqH2zs2YDgTm+++dIfmAEceFqB7bhfN3am59lCtDXrCtwH2k1GBA==',
        },
        {
          message: bufferToUint8Array(
            '2zZDP1sa1BVBfLP7TeeMk3sUbaxAkUhBhDiNdrksaFo=',
            'base64',
          ),
          signature:
            'VA1+7hefNwv2NKScH6n+Sljj15kLAge+M2wE7fzFOf+L0MMbssA1mwfJZRyyrhBORQRle10X1Dxpx+UOI4EbDQ==',
        },
        {
          message: 'Hello, World!',
          signature:
            'fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==',
        },
        {
          message: 'こんにちは、世界！',
          signature:
            'CDU265Xs8y3OWbB/56H9jPgUss5G9A0qFuTqH2zs2YDgTm+++dIfmAEceFqB7bhfN3am59lCtDXrCtwH2k1GBA==',
        },
        {
          message: '2zZDP1sa1BVBfLP7TeeMk3sUbaxAkUhBhDiNdrksaFo=',
          signature:
            'VA1+7hefNwv2NKScH6n+Sljj15kLAge+M2wE7fzFOf+L0MMbssA1mwfJZRyyrhBORQRle10X1Dxpx+UOI4EbDQ==',
        },
      ])(
        'verifies each reference case with verifyMessage',
        ({
          message,
          signature,
        }: {
          message: string | Uint8Array;
          signature: string;
        }) => {
          // verify hex signature
          const hexSignature = bufferToUint8Array(signature, 'base64').toString(
            'hex',
          );
          expect(sep0053Wallet.signMessage(message, 'hex')).toBe(hexSignature);
          expect(
            sep0053Wallet.verifyMessage(message, hexSignature, 'hex'),
          ).toBe(true);
          // verify base64 signature
          expect(sep0053Wallet.signMessage(message)).toStrictEqual(signature);
          expect(sep0053Wallet.verifyMessage(message, signature)).toBe(true);
        },
      );
    });
  });

  describe('verifyMessage', () => {
    it('returns true when signature matches signMessage for the same message', () => {
      const wallet = getTestWallet({ seed });
      const message = 'hello stellar';

      const signature = wallet.signMessage(message);
      expect(wallet.verifyMessage(message, signature)).toBe(true);
    });

    it('returns false for a different message with the same signature', () => {
      const wallet = getTestWallet({ seed });
      const signature = wallet.signMessage('original');

      expect(wallet.verifyMessage('tampered', signature)).toBe(false);
    });

    it('returns false when the signature was produced by a different key', () => {
      const signer = getTestWallet({ seed });
      const other = getTestWallet({ seed: otherSeed });

      const signature = signer.signMessage('same text');

      expect(other.verifyMessage('same text', signature)).toBe(false);
    });

    it('returns false when the signature is truncated', () => {
      const wallet = getTestWallet({ seed });
      const full = wallet.signMessage('hello');
      const truncated = full.slice(0, Math.max(1, full.length - 4));
      expect(wallet.verifyMessage('hello', truncated)).toBe(false);
    });
  });

  describe('signAuthEntry', () => {
    // Arbitrary 56-byte buffer mimicking a HashIdPreimage XDR payload — we
    // only care that signAuthEntry hashes the bytes and signs the digest.
    const preimageBytes = bufferToUint8Array(
      'AAAACQAAAAAAAAAAAAAAAQAAAAEAAAAAAAAAAQAAAAAAAAAAAAAAZAAAAAA=',
      'base64',
    );
    const preimageBase64 = preimageBytes.toString('base64');

    it('returns a base64-encoded signature', () => {
      const wallet = getTestWallet({ seed });
      const signature = wallet.signAuthEntry(preimageBase64);
      expect(signature).toMatch(/^[A-Za-z0-9+/]+=*$/u);
      expect(signature.length).toBeGreaterThan(0);
    });

    it('signs hash(preimage bytes) — verifiable with the signer public key', () => {
      const wallet = getTestWallet({ seed });
      const signature = wallet.signAuthEntry(preimageBase64);

      const digest = bufferToUint8Array(hash(preimageBytes));
      const keypair = Keypair.fromRawEd25519Seed(bufferToUint8Array(seed));
      expect(
        keypair.verify(digest, bufferToUint8Array(signature, 'base64')),
      ).toBe(true);
    });

    it('supports hex encoding for the returned signature', () => {
      const wallet = getTestWallet({ seed });
      const hexSignature = wallet.signAuthEntry(preimageBase64, 'hex');
      expect(hexSignature).toMatch(/^[0-9a-f]+$/u);
      expect(hexSignature).toHaveLength(128);
    });
  });

  describe('signTransaction', () => {
    it('signs a transaction built for the same source account', () => {
      const wallet = getTestWallet({ seed });

      const tx = buildMockClassicTransaction([
        {
          type: 'changeTrust',
          params: {
            asset: {
              code: 'USDC',
              issuer:
                'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
            },
            limit: '10000',
          },
        },
      ]);

      expect(() => wallet.signTransaction(tx)).not.toThrow();
    });
  });

  describe('exportKey', () => {
    const keypair = Keypair.fromRawEd25519Seed(bufferToUint8Array(seed));
    const wallet = new Wallet(keypair);
    const rawSeed = bufferToUint8Array(keypair.rawSecretKey());

    it('exports the raw 32-byte seed as 0x-prefixed hex', () => {
      const exported = wallet.exportKey(PrivateKeyEncoding.Hexadecimal);
      expect(exported).toBe(`0x${rawSeed.toString('hex')}`);
      // Round-trips back to the same keypair.
      expect(
        Keypair.fromRawEd25519Seed(
          bufferToUint8Array(exported.slice(2), 'hex'),
        ).publicKey(),
      ).toBe(keypair.publicKey());
    });

    it('exports the raw seed as base58', () => {
      const exported = wallet.exportKey(PrivateKeyEncoding.Base58);
      expect(exported).toBe(base58.encode(rawSeed));
      expect(
        Keypair.fromRawEd25519Seed(
          bufferToUint8Array(base58.decode(exported)),
        ).publicKey(),
      ).toBe(keypair.publicKey());
    });
  });
});
