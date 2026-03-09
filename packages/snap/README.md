# Stellar Snap

## Configuration

Rename `.env.example` to `.env`
Configurations are set up through `.env`.

## API

### `keyring_createAccount`

Example:

```typescript
provider.request({
  method: 'wallet_invokeKeyring',
  params: {
    snapId,
    request: {
      method: 'keyring_createAccount',
      params: {
        scope: 'stellar:pubnet', // the CAIP-2 chain ID of the network
      },
    },
  },
});
```
