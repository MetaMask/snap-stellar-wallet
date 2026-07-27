# Use case: keyring (`KeyringHandler`)

Account management and SEP-43 signing entry points via `onKeyringRequest` → `KeyringHandler`.

|            |                                                                           |
| ---------- | ------------------------------------------------------------------------- |
| **Entry**  | `onKeyringRequest` → `KeyringHandler`                                     |
| **Source** | [`handlers/keyring/keyring.ts`](../../../src/handlers/keyring/keyring.ts) |

## Participants

| Component               | Path                        | Role                                                                    |
| ----------------------- | --------------------------- | ----------------------------------------------------------------------- |
| `KeyringHandler`        | `handlers/keyring`          | Keyring API surface + routing                                           |
| `AccountService`        | `services/account`          | Persist / derive / select accounts (snap state)                         |
| `OnChainAccountService` | `services/on-chain-account` | Snap-state snapshots for balances/assets; live activation for discovery |
| `TransactionService`    | `services/transaction`      | Local pending keyring txs for `listAccountTransactions`                 |
| `SyncAccountsHandler`   | `handlers/cronjob`          | Scheduled after selection changes to refresh on-chain snapshots         |

## Request / response

Account-management methods follow the MetaMask **Keyring API** (request method names `keyring_*`, params, and return types):

- [Account Management API](https://docs.metamask.io/snaps/reference/keyring-api/account-management/)
- [`@metamask/keyring-api` docs](https://metamask.github.io/keyring-api/latest/)

This Snap implements the `Keyring` interface; calls arrive via `wallet_invokeKeyring` / `onKeyringRequest` and are dispatched with `handleKeyringRequest`.

`submitRequest` uses **SEP-43** request/response shapes — see [SEP-43](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md).

## Methods

Requests are origin-checked, then dispatched to the methods below.

| Method                    | What it does                                                                                                             | Data source                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `listAccounts`            | List all Stellar keyring accounts                                                                                        | **Snap state** (`AccountService`)                                                              |
| `getAccount`              | Get one account by id                                                                                                    | **Snap state**                                                                                 |
| `createAccount`           | Derive / create one account; emit `AccountCreated` for new accounts (rollback delete if emit fails)                      | **Snap state** (HD derive + persist)                                                           |
| `createAccounts`          | Batch BIP-44 create (single index or range); Snap keyring v2 path — no `AccountCreated` events                           | **Snap state** (HD derive + persist)                                                           |
| `deleteAccount`           | Emit `AccountDeleted`, then remove the account                                                                           | **Snap state**                                                                                 |
| `setSelectedAccounts`     | Validate ids exist, then schedule `synchronizeAccounts` for those accounts                                               |                                                                                                |
| `listAccountAssets`       | Visible CAIP asset ids; if no snapshot yet, returns native slip44 only                                                   | **Snap state** on-chain snapshot (background-synced; not a live Horizon read)                  |
| `getAccountBalances`      | Balances for requested assets; missing / inactive snapshot → native `0` if asked                                         | **Snap state** on-chain snapshot (same as above; can be slightly stale within the sync window) |
| `listAccountTransactions` | Paginated keyring transactions for the account                                                                           | **Snap state** (pending / local txs via `TransactionService` — **not** Horizon history)        |
| `discoverAccounts`        | Derive BIP-44 address for index; return it only if activated on any requested scope                                      | Derive locally; activation check is **live on-chain** (`NetworkService.getAccount`)            |
| `resolveAccountAddress`   | Given an address, return CAIP-10 if this snap owns it; else `null` (MetaMask may fall back)                              | **Snap state** (keyring account lookup by address)                                             |
| `filterAccountChains`     | Not implemented                                                                                                          | Throws `MethodNotSupportedError`                                                               |
| `updateAccount`           | Not implemented                                                                                                          | Throws `MethodNotSupportedError`                                                               |
| `submitRequest`           | [signTransaction.md](./signTransaction.md) · [signMessage.md](./signMessage.md) · [signAuthEntry.md](./signAuthEntry.md) |                                                                                                |
