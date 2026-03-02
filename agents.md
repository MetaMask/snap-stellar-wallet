# Agent Instructions

## Project Structure

This project is a **monorepo** consisting of two packages:

- **`packages/snap`** — The Stellar Wallet Snap. Handles all Stellar-specific blockchain logic: account derivation, transaction signing, fee calculation, staking, etc.
- **`packages/site`** — A test dapp for development and testing. Provides a UI to interact with the Snap's functionality.

## Snaps Technology

### What is a Snap?

A **Snap** is a plugin for MetaMask created by Consensys. This Stellar Wallet Snap is prebuilt into MetaMask. Snaps compartmentalize logic and communicate with the extension through specific SDKs:

- **Keyring API** (`@metamask/keyring-api`) — For account management operations
- **Snaps SDK** (`@metamask/snaps-sdk`) — For general Snap functionality and UI components

### Execution Environment

Snaps are untrusted JavaScript programs that execute in a sandboxed environment running [Secure ECMAScript (SES)](https://github.com/endojs/endo/tree/master/packages/ses). This environment is **heavily restricted** compared to normal JavaScript.

**What's NOT Available:**
- **No DOM** — No `document`, `window`, or browser APIs
- **No Node.js built-ins** — No `fs`, `path`, `crypto` (unless polyfilled), `process`, etc.
- **No unrestricted network access** — `fetch` requires the `endowment:network-access` permission
- **No platform-specific APIs** — Environment is designed to be fully virtualizable

**Available Globals:**
- **`snap`** — The Snaps API global for making requests to MetaMask
- **`ethereum`** — EIP-1193 provider (requires `endowment:ethereum-provider` permission)
- **Standard JS globals** — `Promise`, `Error`, `Math`, `Set`, `Reflect`, `Map`, `Array`, etc.
- **`console`** — For logging
- **`fetch`** — Only with `endowment:network-access` permission
- **`setTimeout` / `clearTimeout` / `setInterval` / `clearInterval`**
- **`SubtleCrypto`** — Web Crypto API
- **`TextEncoder` / `TextDecoder`**
- **`atob` / `btoa`** — Base64 encoding/decoding
- **`URL`**
- **`WebAssembly`** — Only with `endowment:webassembly` permission

**SES Restrictions:**

SES (Secure ECMAScript) is a hardened JavaScript subset that:
- Prevents Snaps from polluting the global environment
- Prevents access to sensitive APIs without explicit permission
- Isolates Snap code from other parts of the application
- Is more restrictive than JavaScript strict mode

To use Node.js built-in modules like `crypto` and `path`, set `polyfills: true` in the Snap config.

### Snaps APIs

#### `snap` Global (Snaps API)

The `snap` global provides the `snap.request()` method to call [Snaps API methods](https://docs.metamask.io/snaps/reference/snaps-api/). Each method requires permission in `snap.manifest.json`:

```json
"initialPermissions": {
  "snap_notify": {}
}
```

```typescript
await snap.request({
  method: "snap_notify",
  params: { type: "inApp", message: "Hello, world!" },
});
```

#### `ethereum` Global (Wallet API)

Snaps can call Wallet JSON-RPC methods using the `ethereum` global (requires `endowment:ethereum-provider` permission). **Important:** The `ethereum` global in Snaps is read-only—it cannot write to the blockchain or initiate transactions.

**Blocked methods** (cannot be called from Snaps):
- `wallet_requestPermissions`, `wallet_revokePermissions`
- `wallet_addEthereumChain`, `wallet_switchEthereumChain`
- `wallet_watchAsset`, `wallet_registerOnboarding`, `wallet_scanQRCode`
- `eth_sendTransaction`, `eth_decrypt`, `eth_getEncryptionPublicKey`

#### Custom JSON-RPC API

Snaps expose custom methods to dapps via the `onRpcRequest` entry point. This requires the `endowment:rpc` permission:

```json
"initialPermissions": {
  "endowment:rpc": { "dapps": true }
}
```

```typescript
export const onRpcRequest: OnRpcRequestHandler = async ({ origin, request }) => {
  switch (request.method) {
    case "hello":
      return "world!";
    default:
      throw new Error("Method not found.");
  }
};
```

Dapps call these methods using `wallet_invokeSnap` or `wallet_snap`.

## Git Hooks

- **pre-commit**: When snap files are staged, automatically runs `build:prod` and stages the production manifest. Always runs `lint:fix`.
- **pre-push**: Runs tests only.

The manifest (`snap.manifest.json`) should always be in production state in commits. Local development uses `yarn start` which applies local settings.

## Linting + Formatting

**After each code generation**, run the linter to fix formatting and style issues:
```bash
yarn lint:fix
```

## Running Tests

To run all tests:
```bash
yarn test
```

To run tests for a specific file:
```bash
yarn test -- "<file path>"
```

Example:
```bash
yarn test -- "packages/snap/src/services/send/FeeCalculatorService.test.ts"
```

## Test Naming Conventions

Test names should skip "should" and start directly with the verb.

**Good:**
- `it('returns empty array when no transactions exist', ...)`
- `it('throws error for invalid address', ...)`
- `it('calculates fee using feeLimit fallback when simulation fails', ...)`

**Bad:**
- `it('should return empty array when no transactions exist', ...)`
- `it('should throw error for invalid address', ...)`

