# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial release of the Stellar wallet Snap.
- Stellar account management (create, derive, sync) through the MetaMask Keyring API.
- Transaction building, signing, and submission, including send flows and swap/bridge history support.
- Transaction history synchronization with pending-transaction tracking and reconciliation.
- Security scanning of transactions via Blockaid, with estimated balance changes shown in the confirmation dialog.
- Asset metadata and fiat price lookups backed by MetaMask Token and Price APIs.
- Localized confirmation and signing UI.

[Unreleased]: https://github.com/MetaMask/snap-stellar-wallet/
