# Stellar

<img src="./packages/snap/images/icon.svg" width="200" style="display: block; margin: 0 auto;" alt="Stellar Logo" />

## Getting Started

The Stellar Snap allows MetaMask and dapps to support all Stellar-related networks and address types.

- [@metamask/stellar-wallet-snap](packages/snap/README.md)
- [@metamask/stellar-wallet-test-dapp](packages/site/README.md)

### Prerequisites

- [MetaMask Flask](https://metamask.io/flask/)
- Nodejs `22`. We **strongly** recommend you install via [NVM](https://github.com/nvm-sh/nvm) to avoid incompatibility issues between different node projects.
- Once installed, you should also install [Yarn](http://yarnpkg.com/) with `npm i -g yarn` to make working with this repository easiest.

## Installing

```bash
nvm use
yarn install
```

## Configuration

Please see `./src/packages/.env.example` for reference

## Running

### Quick Start

```bash
yarn start
```

- Snap server and debug page: http://localhost:8080/
- Example UI dapp: http://localhost:3000/

### Snap

⚠️ When snap updates you will need to still reconnect from the dapp to see changes

```bash
# Running Snap via watch mode
yarn workspace @metamask/stellar-wallet-snap start
```

## Git Hooks & Manifest Handling

The `snap.manifest.json` contains a `shasum` that differs between local and production builds. Git hooks ensure the repository always contains production-ready builds:

### On Commit (with snap changes)

1. Detects if any `packages/snap/` files are staged
2. Runs `build:prod` → updates manifest with production settings and shasum
3. Stages the updated `snap.manifest.json`
4. Runs `lint:fix` on all files

### On Push

1. Runs the test suite
2. Push proceeds if tests pass

### Local Development

`yarn start` builds with local settings (adds `localhost` origins and dev permissions). These are automatically converted to production settings when you commit.
