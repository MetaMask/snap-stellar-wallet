# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Private-key export (`keyring_exportAccount`) for Stellar accounts (hex/base58).
- `keyring_getAccounts` support.

### Changed

- Migrated keyring requests to the Keyring API v2 dispatcher.
- `keyring_getAccount` now throws for unknown account ids instead of returning `undefined`.

[Unreleased]: https://github.com/MetaMask/snap-stellar-wallet/
