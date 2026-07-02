# Stellar Keyring V2 — Design

- **Ticket:** WPN-1341 / WPN-71 — *Stellar - Implement keyring V2*
- **Reference:** `snap-solana-wallet` PR #606 *"feat: update to keyring v2"* (open)
- **Date:** 2026-06-30
- **Branch:** `feat/stellar-keyring-v2`

## Context

The snap is already on the V2-capable SDKs and has merged part of the V2 surface
(PR #48, `createAccounts`). This ticket closes the remaining V2 gap and adds the
private-key export feature, mirroring the behaviour of Solana #606 adapted to
Stellar.

Already in place (no change needed):

- `@metamask/keyring-api@^23.3.0` and `@metamask/keyring-snap-sdk@^9.0.2` — both
  already expose the `./v2` subpath (verified on npm; 23.3.0 is latest).
- `@metamask/snaps-sdk@^11.1.0`, `platformVersion 11.1.1`, `snaps-cli 8.4`,
  `snaps-jest 10.1` — already at the versions #606 bumped to.
- `createAccounts` (BIP-44 derive-index / derive-index-range), `discoverAccounts`,
  `resolveAccountAddress`, `listAccountTransactions`, `listAccountAssets`.
- Boundary error wrapping: `KeyringHandler.handle()` wraps the whole dispatch in
  `withCatchAndThrowSnapError` (`handlers/keyring/keyring.ts:115`), so every
  method already surfaces a `SnapError`.

**No dependency bumps and no `platformVersion` change are required.**

## Remaining delta (this ticket)

| Item | File |
| --- | --- |
| `exportAccount(id, options?)` (PK export) | `handlers/keyring/keyring.ts` |
| `Wallet.exportKey(encoding)` | `services/wallet/Wallet.ts` |
| `getAccounts()` → delegates to `listAccounts()` | `handlers/keyring/keyring.ts` |
| `getAccount()` throws on missing id (breaking) | `handlers/keyring/keyring.ts` |
| Switch dispatcher to `keyring-snap-sdk/v2` | `handlers/keyring/keyring.ts` |
| `implements Keyring` → `implements KeyringRpc` | `handlers/keyring/keyring.ts` |
| `ExportAccountRequestStruct` | `handlers/keyring/api.ts` |
| V2 RPC-method permission names + `ExportAccount` | `permissions.ts` |
| `endowment:keyring.capabilities` | `snap.manifest.json` |
| `moduleResolution: "bundler"` (+ `module: "preserve"`) | `packages/snap/tsconfig.json` |
| Tests | `*.test.ts` |

## Export-format decision (locked)

The keyring V2 `exportAccount` contract is rigid:

- `PrivateKeyEncoding` enum = `hexadecimal | base58` **only** (no `base64`).
- `ExportedAccount` = `{ type: 'private-key', encoding, privateKey }` over raw
  key **bytes**.

Stellar's canonical importable secret is the StrKey `S…` seed
(`Keypair.secret()`), which is `base32(0x90 ‖ seed ‖ crc16)` — **not** expressible
in this contract (and labelling a StrKey `base58` is unsafe: StrKeys contain
`O`/`I`, outside the base58 alphabet, so the check would sometimes pass and
sometimes silently corrupt). No mainstream Stellar wallet imports a raw hex/base58
32-byte seed anyway (Freighter takes only SEP-5 mnemonic; Lobstr/xBull take the
`S…` StrKey).

**Decision:**

- Export `Keypair.rawSecretKey()` (raw 32-byte ed25519 seed), as the ticket
  screenshot shows.
- Declare **both** `hexadecimal` and `base58` export formats (matches the chosen
  "full parity with #606" scope; base58 costs nothing).
- **Default encoding is `hexadecimal`** (not base58). base58 is a Solana/Bitcoin
  convention with no meaning in the Stellar ecosystem; hex is the neutral form a
  user can convert back to an `S…` seed via
  `Keypair.fromRawEd25519Seed(Buffer.from(hex, 'hex')).secret()`.

**Known limitation (escalate, do not bury):** raw hex/base58 export is not
one-click importable into any Stellar wallet. If the product intent of "export
private key" is wallet portability, that requires an `S…`-seed export path which
the V2 `exportAccount` contract cannot carry — a MetaMask account-export product/UX
decision, tracked as a follow-up, out of scope here.

## Architecture / data flow

`exportAccount(accountId, options?)`:

1. `validateRequest({ accountId, options }, ExportAccountRequestStruct)`.
2. `const { account } = await accountService.resolveAccount({ accountId })`
   (throws `AccountNotFoundException` on missing id).
3. `const wallet = await walletService.resolveWallet(account)`
   (`resolveWallet` derives the keypair and asserts the derived public key matches
   the stored address).
4. `const encoding = options?.encoding ?? 'hexadecimal'`.
5. `const privateKey = wallet.exportKey(encoding)`.
6. Return `{ type: 'private-key', encoding, privateKey }`.

`Wallet.exportKey(encoding: PrivateKeyEncoding): string`:

- `hexadecimal` → `0x${this.#signer.rawSecretKey().toString('hex')}`.
- `base58` → `bs58.encode(this.#signer.rawSecretKey())`.

The boundary `handle()` wrapper already converts any throw to `SnapError`; no
per-method try/catch is added (that part of #606 is redundant given Stellar's
structure).

## Security

- Validate the derived key string with a boolean `is(privateKey, union([...]))`
  check, **never** an asserting validator. A thrown `StructError` embeds the
  offending value — the private key — in its message and would leak it to logs and
  the caller. On failure, throw a value-free message.
- `exportAccount` is user-initiated only (gated by MetaMask's export confirmation
  UI). The snap never logs the key.

## Manifest capabilities

Extend `endowment:keyring` with:

```jsonc
"capabilities": {
  "scopes": ["stellar:pubnet", "stellar:testnet"],
  "privateKey": {
    "exportFormats": [
      { "encoding": "hexadecimal" },
      { "encoding": "base58" }
    ]
  },
  "bip44": { "deriveIndex": true, "deriveIndexRange": true, "discover": true }
}
```

(Leave `source.shasum` untouched — it is regenerated by the build.)

## Permissions

In `permissions.ts`, import `KeyringRpcMethod as KeyringRpcMethodV2` from
`@metamask/keyring-api/v2` and switch the V2-renamed methods
(`GetAccount`, `GetAccounts`, `CreateAccounts`, `DeleteAccount`, `SubmitRequest`)
to the V2 names; add `KeyringRpcMethodV2.ExportAccount` to the MetaMask set.
`ExportAccount` is **not** added to the dapp set (MetaMask-origin only).

## Testing

- `Wallet.exportKey` unit: hex (`0x…`, 64 hex chars) and base58 round-trip back to
  the same `Keypair` via `fromRawEd25519Seed`; default is hex.
- Keyring `exportAccount`: returns `{ type, encoding, privateKey }`; respects
  `options.encoding`; throws (as `SnapError`) for a missing id; never includes the
  key in a thrown error message on encoding-validation failure.
- Keyring `getAccount`: throws `AccountNotFound`-style error for a missing id
  (was `undefined`).
- Keyring `getAccounts`: equals `listAccounts`.
- Follow `feedback_mm_mobile_testing` / `feedback_testing_*` conventions (AAA, no
  "should", real assertions, no over-mocking).

## Explicitly out of scope

- Dependency / `platformVersion` bumps (already done).
- Per-method `SnapError` try/catch from #606 (redundant here).
- `S…` StrKey export path (not expressible in V2 `exportAccount`; product follow-up).
- Solana #606's `jest --runInBand` polyfill fix (Solana-specific).
