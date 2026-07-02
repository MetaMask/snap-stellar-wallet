# Stellar Keyring V2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the remaining MetaMask Keyring V2 surface for the Stellar snap and add private-key export (`exportAccount`), matching `snap-solana-wallet` PR #606 adapted to Stellar.

**Architecture:** The snap already has the V2-capable SDKs and `createAccounts`/`discoverAccounts`. This adds `exportAccount` (raw 32-byte ed25519 seed, hex/base58), `getAccounts`, makes `getAccount` throw on missing id, switches the dispatcher to `@metamask/keyring-snap-sdk/v2`, declares `endowment:keyring.capabilities`, and enables `moduleResolution: "bundler"` so the `/v2` subpath types resolve. Export goes through the existing `AccountResolver` with the keyring+wallet preset; no per-method error wrapping (the dispatch is already wrapped in `withCatchAndThrowSnapError`).

**Tech Stack:** TypeScript, `@metamask/keyring-api@^23.3.0` (`/v2`), `@metamask/keyring-snap-sdk@^9.0.2` (`/v2`), `@metamask/superstruct`, `@scure/base` (base58, already in lockfile), `@stellar/stellar-sdk`, Jest (`snaps-jest`).

**Design doc:** `docs/plans/2026-06-30-stellar-keyring-v2-design.md`

**Commands (run from `packages/snap/`, or prefix `yarn workspace @metamask/stellar-wallet-snap run`):**
- Single test: `yarn test <path>` (e.g. `yarn test src/services/wallet/Wallet.test.ts`)
- Types: `yarn lint:types`
- Lint: `yarn lint` / autofix `yarn lint:fix`
- Build (regenerates manifest shasum): `yarn build:snap` (from repo root)

**Export-format decision (locked):** raw `Keypair.rawSecretKey()` (32 bytes); encodings `hexadecimal` + `base58`; **default `hexadecimal`**. Validate output with boolean `is(...)`, never an asserting validator (key-leak guard). See design doc for the StrKey limitation (out of scope, product follow-up).

---

### Task 1: Enable `/v2` subpath type resolution (tsconfig)

**Files:**
- Modify: `packages/snap/tsconfig.json`

**Step 1: Add module resolution settings**

Add to `compilerOptions` (mirrors #606):

```jsonc
"module": "preserve",
"moduleResolution": "bundler",
```

**Step 2: Verify types still resolve repo-wide**

Run: `yarn lint:types`
Expected: PASS (no new errors). This is a prerequisite for the `/v2` imports in later tasks; if it surfaces unrelated regressions from the resolution change, fix them here before continuing.

**Step 3: Commit**

```bash
git add packages/snap/tsconfig.json
git commit -m "build: set moduleResolution bundler for keyring-api v2 subpath types"
```

---

### Task 2: `Wallet.exportKey(encoding)`

**Files:**
- Modify: `packages/snap/src/services/wallet/Wallet.ts`
- Test: `packages/snap/src/services/wallet/Wallet.test.ts` (colocated; create if absent)

**Step 1: Write the failing tests**

```ts
import { base58 } from '@scure/base';
import { Keypair } from '@stellar/stellar-sdk';
import { PrivateKeyEncoding } from '@metamask/keyring-api/v2';

import { Wallet } from './Wallet';

describe('Wallet.exportKey', () => {
  // Fixed seed so the test is deterministic.
  const keypair = Keypair.fromRawEd25519Seed(
    Buffer.from('00'.repeat(32), 'hex'),
  );
  const wallet = new Wallet(keypair);
  const rawSeed = new Uint8Array(keypair.rawSecretKey());

  it('exports the raw 32-byte seed as 0x-prefixed hex', () => {
    const exported = wallet.exportKey(PrivateKeyEncoding.Hexadecimal);
    expect(exported).toBe(`0x${Buffer.from(rawSeed).toString('hex')}`);
    // Round-trips back to the same keypair.
    expect(
      Keypair.fromRawEd25519Seed(
        Buffer.from(exported.slice(2), 'hex'),
      ).publicKey(),
    ).toBe(keypair.publicKey());
  });

  it('exports the raw seed as base58', () => {
    const exported = wallet.exportKey(PrivateKeyEncoding.Base58);
    expect(exported).toBe(base58.encode(rawSeed));
    expect(
      Keypair.fromRawEd25519Seed(
        Buffer.from(base58.decode(exported)),
      ).publicKey(),
    ).toBe(keypair.publicKey());
  });
});
```

**Step 2: Run to verify failure**

Run: `yarn test src/services/wallet/Wallet.test.ts`
Expected: FAIL — `exportKey` is not a function.

**Step 3: Implement `exportKey`**

In `Wallet.ts`, add imports:

```ts
import { base58 } from '@scure/base';
import { bytesToHex } from '@metamask/utils';
import type { PrivateKeyEncoding } from '@metamask/keyring-api/v2';
```

Add the method to the `Wallet` class (e.g. after `signMessage`):

```ts
/**
 * Exports the raw ed25519 secret seed for this wallet's signer.
 *
 * Returns raw key bytes, not the Stellar StrKey `S…` seed — the keyring V2
 * export contract only supports hex/base58 over raw bytes. `hexadecimal`
 * yields a `0x`-prefixed string; `base58` yields a base58 string.
 *
 * @param encoding - The private-key encoding (hexadecimal or base58).
 * @returns The encoded raw secret seed.
 */
exportKey(encoding: PrivateKeyEncoding): string {
  const rawSeed = bufferToUint8Array(this.#signer.rawSecretKey());
  return encoding === 'base58' ? base58.encode(rawSeed) : bytesToHex(rawSeed);
}
```

(`bufferToUint8Array` is already imported in this file.)

**Step 4: Run to verify pass**

Run: `yarn test src/services/wallet/Wallet.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/snap/src/services/wallet/Wallet.ts packages/snap/src/services/wallet/Wallet.test.ts
git commit -m "feat: add Wallet.exportKey for raw secret seed (hex/base58)"
```

---

### Task 3: Export validation structs

**Files:**
- Modify: `packages/snap/src/handlers/keyring/api.ts`

**Step 1: Add structs**

Add `define` to the `@metamask/superstruct` import, and add:

```ts
import { ExportAccountOptionsStruct } from '@metamask/keyring-api/v2';

/**
 * Base58 string (Bitcoin alphabet). Used as a boolean `is` guard on the
 * exported private key — NEVER as an asserting validator (a StructError would
 * embed the key value in its message).
 */
export const Base58Struct = define<string>(
  'Base58',
  (value) =>
    typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]+$/u.test(value),
);

/** Request shape for `exportAccount`. */
export const ExportAccountRequestStruct = object({
  accountId: UuidStruct,
  options: optional(ExportAccountOptionsStruct),
});
```

(`UuidStruct`, `object`, `optional` are already used in this file — reuse them.)

**Step 2: Verify types**

Run: `yarn lint:types`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/snap/src/handlers/keyring/api.ts
git commit -m "feat: add ExportAccount request + Base58 validation structs"
```

---

### Task 4: Implement `exportAccount`, `getAccounts`, throwing `getAccount`, v2 dispatcher

**Files:**
- Modify: `packages/snap/src/handlers/keyring/keyring.ts`
- Modify: `packages/snap/src/context.ts` (inject `accountResolver`)
- Test: `packages/snap/src/handlers/keyring/keyring.test.ts`

**Step 1: Write the failing tests**

Add to the keyring handler test suite (use existing fixtures `MOCK_*`/mocked services; mirror current tests in the file):

```ts
describe('exportAccount', () => {
  it('returns the hex-encoded raw seed by default', async () => {
    const result = await keyring.exportAccount(account.id);
    expect(result).toStrictEqual({
      type: 'private-key',
      encoding: 'hexadecimal',
      privateKey: expect.stringMatching(/^0x[0-9a-f]{64}$/u),
    });
  });

  it('respects the requested base58 encoding', async () => {
    const result = await keyring.exportAccount(account.id, {
      encoding: 'base58',
    });
    expect(result.encoding).toBe('base58');
  });

  it('throws for an unknown account id', async () => {
    await expect(keyring.exportAccount(NON_EXISTENT_ID)).rejects.toThrow();
  });
});

describe('getAccount (v2 semantics)', () => {
  it('throws for an unknown account id instead of returning undefined', async () => {
    await expect(keyring.getAccount(NON_EXISTENT_ID)).rejects.toThrow();
  });
});

describe('getAccounts', () => {
  it('returns the same result as listAccounts', async () => {
    expect(await keyring.getAccounts()).toStrictEqual(
      await keyring.listAccounts(),
    );
  });
});
```

**Step 2: Run to verify failure**

Run: `yarn test src/handlers/keyring/keyring.test.ts`
Expected: FAIL — `exportAccount`/`getAccounts` not functions; `getAccount` returns undefined.

**Step 3: Edit `keyring.ts`**

a. Split the keyring-api imports — drop `type Keyring` from `@metamask/keyring-api`, and add a `/v2` import:

```ts
import type {
  ExportAccountOptions,
  ExportedAccount,
  KeyringRpc,
} from '@metamask/keyring-api/v2';
import { PrivateKeyEncoding } from '@metamask/keyring-api/v2';
```

b. Switch the dispatcher (keep `emitSnapKeyringEvent` + `MethodNotSupportedError` on the base path):

```ts
import { handleKeyringRequest } from '@metamask/keyring-snap-sdk/v2';
import {
  emitSnapKeyringEvent,
  MethodNotSupportedError,
} from '@metamask/keyring-snap-sdk';
```

c. Add superstruct + struct imports:

```ts
import { is, union } from '@metamask/superstruct';
import { HexStruct } from '@metamask/utils';
// from './api':
import { Base58Struct, ExportAccountRequestStruct } from './api';
```

d. Add `AccountResolver` + the keyring-and-wallet preset import:

```ts
import type { AccountResolver } from '../accountResolver';
import { RESOLVE_ACCOUNT_KEYRING_AND_WALLET } from '../accountResolver';
```

e. Change the class declaration:

```ts
export class KeyringHandler implements KeyringRpc {
```

f. Add an injected `#accountResolver` field + constructor param (alongside the existing ones):

```ts
readonly #accountResolver: AccountResolver;
// in the constructor destructure and assignment:
//   accountResolver,
//   this.#accountResolver = accountResolver;
```

g. Make `getAccount` throw on missing id (use `resolveAccount`, which throws `AccountNotFoundException`):

```ts
async getAccount(accountId: GetAccountRequest): Promise<KeyringAccount> {
  validateRequest(accountId, GetAccountRequestStruct);
  const { account } = await this.#accountService.resolveAccount({ accountId });
  return this.#toKeyringAccount(account);
}
```

h. Add `getAccounts`:

```ts
async getAccounts(): Promise<KeyringAccount[]> {
  return this.listAccounts();
}
```

i. Add `exportAccount` (resolve account + wallet via the preset; boolean `is` guard):

```ts
async exportAccount(
  accountId: string,
  options?: ExportAccountOptions,
): Promise<ExportedAccount> {
  validateRequest({ accountId, options }, ExportAccountRequestStruct);

  const { account, wallet } = await this.#accountResolver.resolveAccount({
    accountId,
    options: RESOLVE_ACCOUNT_KEYRING_AND_WALLET,
  });

  const encoding = options?.encoding ?? PrivateKeyEncoding.Hexadecimal;
  const privateKey = wallet.exportKey(encoding);

  // SECURITY: boolean `is` check only. An asserting validator's StructError
  // embeds the offending value — the private key — in its message, leaking it
  // to logs and the caller. On failure throw a value-free message.
  if (!is(privateKey, union([Base58Struct, HexStruct]))) {
    throw new Error('Derived private key failed encoding validation');
  }

  return { type: 'private-key', encoding, privateKey };
}
```

**Step 4: Wire `accountResolver` in `context.ts`**

At the `new KeyringHandler({ ... })` call (context.ts:174), add `accountResolver,` to the argument object (it is already constructed at context.ts:142).

**Step 5: Run to verify pass**

Run: `yarn test src/handlers/keyring/keyring.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/snap/src/handlers/keyring/keyring.ts packages/snap/src/context.ts packages/snap/src/handlers/keyring/keyring.test.ts
git commit -m "feat: implement keyring v2 exportAccount, getAccounts, throwing getAccount"
```

---

### Task 5: V2 permission method names

**Files:**
- Modify: `packages/snap/src/permissions.ts`

**Step 1: Edit permissions**

Add the v2 alias import:

```ts
import { KeyringRpcMethod as KeyringRpcMethodV2 } from '@metamask/keyring-api/v2';
```

In **both** the `dappPermissions` set and the `metamaskPermissions` set, replace these entries with their `KeyringRpcMethodV2` equivalents: `GetAccount`, `CreateAccounts`, `DeleteAccount`, `SubmitRequest`, and add `KeyringRpcMethodV2.GetAccounts`. In the **metamask** set only, also add `KeyringRpcMethodV2.ExportAccount`. Leave `ListAccounts`, `CreateAccount`, `DiscoverAccounts`, `GetAccountBalances`, `ListAccountTransactions`, `ListAccountAssets`, `ResolveAccountAddress`, `SetSelectedAccounts` on the base `KeyringRpcMethod`. Do **not** add `ExportAccount` to the dapp set (MetaMask-origin only).

**Step 2: Verify types**

Run: `yarn lint:types`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/snap/src/permissions.ts
git commit -m "feat: grant keyring v2 GetAccounts/ExportAccount permissions"
```

---

### Task 6: Declare keyring capabilities in the manifest

**Files:**
- Modify: `packages/snap/snap.manifest.json`

**Step 1: Extend `endowment:keyring`**

Replace the `endowment:keyring` block with:

```jsonc
"endowment:keyring": {
  "allowedOrigins": ["https://portfolio.metamask.io"],
  "capabilities": {
    "scopes": ["stellar:pubnet", "stellar:testnet"],
    "privateKey": {
      "exportFormats": [
        { "encoding": "hexadecimal" },
        { "encoding": "base58" }
      ]
    },
    "bip44": {
      "deriveIndex": true,
      "deriveIndexRange": true,
      "discover": true
    }
  }
}
```

**Step 2: Regenerate the manifest shasum + validate**

Run: `yarn build:snap` (from repo root)
Expected: build succeeds and updates `source.shasum` in the manifest. Do **not** hand-edit the shasum.

**Step 3: Commit**

```bash
git add packages/snap/snap.manifest.json
git commit -m "feat: declare keyring v2 capabilities (export formats, scopes, bip44)"
```

---

### Task 7: Changelog

**Files:**
- Modify: `packages/snap/CHANGELOG.md`

**Step 1: Add entries under `## [Unreleased]`**

```markdown
### Added

- Private-key export (`keyring_exportAccount`) for Stellar accounts (hex/base58).
- `keyring_getAccounts` support.

### Changed

- Migrated keyring requests to the Keyring API v2 dispatcher.
- `keyring_getAccount` now throws for unknown account ids instead of returning `undefined`.
```

**Step 2: Validate**

Run (repo root): `yarn changelog:validate`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/snap/CHANGELOG.md
git commit -m "docs: changelog for keyring v2 + private-key export"
```

---

### Task 8: Full QA gate

**Step 1: Types**

Run: `yarn lint:types` — Expected: PASS

**Step 2: Lint**

Run: `yarn lint` — Expected: PASS (run `yarn lint:fix` for autofixable issues)

**Step 3: Tests**

Run (repo root): `yarn test` — Expected: PASS, including the new Wallet/keyring tests

**Step 4: Build**

Run (repo root): `yarn build:snap` — Expected: builds; manifest shasum stable (no further diff)

**Step 5: Final verification commit (if anything changed)**

```bash
git add -A
git commit -m "chore: keyring v2 QA fixes" # only if QA produced changes
```

Then stop — per workflow, do not open the PR; the description is written manually.

---

## Notes / gotchas

- **Decoupling:** `Wallet.exportKey` takes the encoding as a `PrivateKeyEncoding`-typed string but compares against the literal `'base58'`, so the signing layer stays free of a runtime `keyring-api` dependency (type-only import).
- **No per-method `SnapError`:** unlike Solana #606, do not add per-method try/catch — `KeyringHandler.handle()` already wraps the whole dispatch in `withCatchAndThrowSnapError` (`keyring.ts:115`).
- **base58 source:** use `@scure/base` (already resolved in `yarn.lock`); add it to `packages/snap/package.json` `dependencies` if `yarn lint:deps` flags it as undeclared.
- **StrKey limitation:** raw hex/base58 export is not one-click importable into Stellar wallets (Freighter = mnemonic only; Lobstr/xBull = `S…` seed). An `S…`-seed export cannot go through V2 `exportAccount`; raise as a product follow-up, out of scope here.
