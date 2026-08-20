import { Horizon, Keypair } from '@stellar/stellar-sdk';

const HORIZON_URL = 'http://localhost:8000';
const FRIENDBOT_URL = `${HORIZON_URL}/friendbot`;

describe('Stellar Quickstart friendbot', () => {
  it('connects to Horizon and funds a new account', async () => {
    const keypair = Keypair.random();
    const friendbotResponse = await fetch(
      `${FRIENDBOT_URL}?addr=${encodeURIComponent(keypair.publicKey())}`,
    );

    expect(friendbotResponse.ok).toBe(true);

    const server = new Horizon.Server(HORIZON_URL, { allowHttp: true });
    const account = await server.loadAccount(keypair.publicKey());
    const nativeBalance = account.balances.find(
      (balance) => balance.asset_type === 'native',
    );

    expect(nativeBalance).toBeDefined();
    expect(Number(nativeBalance?.balance)).toBeGreaterThan(0);
  }, 60_000);
});
