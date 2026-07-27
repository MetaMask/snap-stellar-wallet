# Use cases

High-level flows for the Stellar Wallet Snap. Each doc focuses on **handlers**, **services**, and **UI** involved in a use case — utility modules are omitted.

## Client request (`onClientRequest`)

| Use case                                        | Entry method             | Doc                                                                     |
| ----------------------------------------------- | ------------------------ | ----------------------------------------------------------------------- |
| Validate send destination                       | `onAddressInput`         | [onAddressInput.md](./client-request/onAddressInput.md)                 |
| Preflight send amount                           | `onAmountInput`          | [onAmountInput.md](./client-request/onAmountInput.md)                   |
| Confirm & submit send                           | `confirmSend`            | [confirmSend.md](./client-request/confirmSend.md)                       |
| Quote swap / bridge fee                         | `computeFee`             | [computeFee.md](./client-request/computeFee.md)                         |
| Sign & submit swap / bridge                     | `signAndSendTransaction` | [signAndSendTransaction.md](./client-request/signAndSendTransaction.md) |
| Change trustline (opt-in / opt-out)             | `changeTrustOpt`         | [changeTrustOpt.md](./client-request/changeTrustOpt.md)                 |
| Account asset extras (trustline / base reserve) | `getAccountAssetInfo`    | [getAccountAssetInfo.md](./client-request/getAccountAssetInfo.md)       |

## Cronjob (`onCronjob`)

All methods are no-ops when MetaMask is inactive or the wallet is **locked** — see [cronjob.md](./cron-job/cronjob.md).

| Use case                                | Entry method                 | Doc                                                                                                                  |
| --------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Cron gate (locked / inactive)           | `CronjobHandler`             | [cronjob.md](./cron-job/cronjob.md)                                                                                  |
| Sync overview (accounts + txs + assets) | `SynchronizeService`         | [synchronization.md](../misc/synchronization/synchronization.md)                                                     |
| Track submitted transaction             | `trackTransaction`           | [trackTransaction.md](./cron-job/trackTransaction.md) · [transaction sync](./../misc/synchronization/transaction.md) |
| Sync selected / listed accounts         | `synchronizeAccounts`        | [syncAccounts.md](./cron-job/syncAccounts.md) · [accounts sync](./../misc/synchronization/accounts.md)               |
| Sync asset metadata catalog             | `synchronizeAssets`          | [syncAssets.md](./cron-job/syncAssets.md) · [assets sync](./../misc/synchronization/assets.md)                       |
| Refresh open confirmation               | `refreshConfirmationContext` | [refreshConfirmationContext.md](./cron-job/refreshConfirmationContext.md)                                            |

## Keyring (`onKeyringRequest`)

Account management is summarized in one place; SEP-43 signing methods have their own docs.

| Use case                                 | Entry method      | Doc                                                |
| ---------------------------------------- | ----------------- | -------------------------------------------------- |
| Keyring overview (accounts, balances, …) | `KeyringHandler`  | [keyring.md](./keyring/keyring.md)                 |
| Sign transaction (no broadcast)          | `signTransaction` | [signTransaction.md](./keyring/signTransaction.md) |
| Sign message                             | `signMessage`     | [signMessage.md](./keyring/signMessage.md)         |
| Sign Soroban auth entry                  | `signAuthEntry`   | [signAuthEntry.md](./keyring/signAuthEntry.md)     |

## Assets (`endowment:assets`)

| Use case                            | Entry method    | Doc                             |
| ----------------------------------- | --------------- | ------------------------------- |
| Assets overview (lookup, prices, …) | `AssetsHandler` | [assets.md](./assets/assets.md) |

## User input (`onUserInput`)

| Use case                     | Entry method       | Doc                                       |
| ---------------------------- | ------------------ | ----------------------------------------- |
| Interactive UI event routing | `UserInputHandler` | [userInput.md](./user-input/userInput.md) |

## Synchronization

Background sync flow and components: [synchronization.md](../misc/synchronization/synchronization.md).

| Component                        | Doc                                                      |
| -------------------------------- | -------------------------------------------------------- |
| Accounts (balances / trustlines) | [accounts.md](../misc/synchronization/accounts.md)       |
| Transactions (history / pending) | [transaction.md](../misc/synchronization/transaction.md) |
| Asset catalog                    | [assets.md](../misc/synchronization/assets.md)           |
