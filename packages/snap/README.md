# Stellar Wallet Snap

MetaMask Snap that implements Stellar account management, signing, sends, trustlines, and related multichain client APIs.

## Configuration

Rename `.env.example` to `.env`. Runtime settings are loaded from `.env`.

## Folder structure

High-level layout of `packages/snap` (nested implementation folders like `services/transaction/simulation` are omitted):

| Folder                           | Purpose                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `locales/`                       | Localized UI strings (built from `messages.json`)                              |
| `images/`                        | Snap icons / static assets                                                     |
| `scripts/`                       | Build helpers (manifest, locale, preinstalled snap)                            |
| `docs/`                          | Package documentation (folder map, use cases, transaction pipeline)            |
| `docs/use-cases/`                | Use-case docs grouped by domain (`keyring`, `client-request`, `cron-job`, ...) |
| `docs/misc/transaction/`         | Transaction build / validate / submit reference                                |
| `docs/misc/synchronization/`     | Background sync flow and component details                                     |
| `src/api/`                       | Shared types and Superstruct validators (CAIP, XDR, amounts, …)                |
| `src/handlers/`                  | Snap RPC / lifecycle entry handlers; orchestrates use cases                    |
| `src/handlers/asset/`            | `onAssets*` lookups, conversion, market data, historical price                 |
| `src/handlers/clientRequest/`    | SIP-31 client methods (send, trustline, fees, …)                               |
| `src/handlers/cronjob/`          | Background sync, transaction tracking, confirmation refresh                    |
| `src/handlers/keyring/`          | Keyring API (accounts, sign tx / message / auth entry)                         |
| `src/handlers/user-input/`       | Confirmation dialog button / form events                                       |
| `src/services/`                  | Domain logic (no Snap entry-point routing)                                     |
| `src/services/account/`          | Keyring account persistence and lookups                                        |
| `src/services/asset-metadata/`   | Asset metadata resolution (symbol, icon, …)                                    |
| `src/services/cache/`            | In-memory and state-backed caches                                              |
| `src/services/network/`          | Horizon / network calls, fees, activation checks                               |
| `src/services/on-chain-account/` | On-chain balances, trustlines, and sync                                        |
| `src/services/price/`            | Spot / conversion prices                                                       |
| `src/services/state/`            | Snap state manager                                                             |
| `src/services/sync/`             | Assets / Balances / Transactions synchronization orchestration                 |
| `src/services/transaction/`      | Build, validate, map, send, and pending keyring transactions                   |
| `src/services/transaction-scan/` | Security / Blockaid scanning                                                   |
| `src/services/wallet/`           | HD wallet and signing                                                          |
| `src/ui/`                        | Snap UI (JSX screens shown inside MetaMask)                                    |
| `src/ui/confirmation/`           | Confirmation dialogs and UX controller                                         |
| `src/ui/images/`                 | Inline UI assets                                                               |
| `src/utils/`                     | Cross-cutting helpers (logging, i18n, CAIP, snap APIs, …)                      |

## Use cases

End-to-end flows (handler → services → UI) live under [`docs/use-cases/`](./docs/use-cases/).
Background synchronization overview: [`docs/misc/synchronization/overview.md`](./docs/misc/synchronization/overview.md).
Shared transaction build / validate / send: [`docs/misc/transaction/`](./docs/misc/transaction/README.md).

## API examples

### `keyring_createAccount`

```typescript
provider.request({
  method: 'wallet_invokeKeyring',
  params: {
    snapId,
    request: {
      method: 'keyring_createAccount',
      params: {
        scope: 'stellar:pubnet', // CAIP-2 chain ID
      },
    },
  },
});
```
