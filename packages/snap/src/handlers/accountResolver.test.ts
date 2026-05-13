import { KnownCaip2ChainId } from '../api';
import {
  AccountResolver,
  DEFAULT_RESOLVE_ACCOUNT_OPTIONS,
  RESOLVE_ACCOUNT_FULL_FROM_KEYRING_STATE,
  RESOLVE_ACCOUNT_KEYRING_AND_WALLET,
  ResolveAccountSource,
} from './accountResolver';
import { AccountService } from '../services/account';
import { generateStellarKeyringAccount } from '../services/account/__mocks__/account.fixtures';
import { AccountNotActivatedException } from '../services/network';
import {
  OnChainAccount,
  OnChainAccountService,
} from '../services/on-chain-account';
import {
  createMockAccountWithBalances,
  DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
  horizonSource,
  mockOnChainAccountService,
} from '../services/on-chain-account/__mocks__/onChainAccount.fixtures';
import { WalletService } from '../services/wallet';
import { getTestWallet } from '../services/wallet/__mocks__/wallet.fixtures';

jest.mock('../utils/logger');

describe('AccountResolver', () => {
  const keyringAccountId = '22222222-2222-4222-8222-222222222222';
  const scope = KnownCaip2ChainId.Mainnet;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function setup() {
    const { accountService, onChainAccountService, walletService } =
      mockOnChainAccountService();
    const wallet = getTestWallet();
    const account = generateStellarKeyringAccount(
      keyringAccountId,
      wallet.address,
      'entropy-source-1',
      0,
    );
    const mockRawAccount = createMockAccountWithBalances(
      wallet.address,
      '1',
      DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
    );
    const onChainAccount = new OnChainAccount(
      mockRawAccount,
      scope,
      horizonSource(mockRawAccount, scope),
    );

    const resolveAccountSpy = jest
      .spyOn(AccountService.prototype, 'resolveAccount')
      .mockResolvedValue({ account });
    const resolveOnChainAccountSpy = jest
      .spyOn(OnChainAccountService.prototype, 'resolveOnChainAccount')
      .mockResolvedValue(onChainAccount);
    const resolveOnChainAccountByKeyringAccountIdSpy = jest.spyOn(
      OnChainAccountService.prototype,
      'resolveOnChainAccountByKeyringAccountId',
    );
    const resolveWalletSpy = jest
      .spyOn(WalletService.prototype, 'resolveWallet')
      .mockResolvedValue(wallet);

    const accountResolver = new AccountResolver({
      accountService,
      onChainAccountService,
      walletService,
    });

    return {
      accountResolver,
      account,
      wallet,
      onChainAccount,
      resolveAccountSpy,
      resolveOnChainAccountSpy,
      resolveOnChainAccountByKeyringAccountIdSpy,
      resolveWalletSpy,
    };
  }

  it('resolves account, on-chain data from the network, and wallet with default options', async () => {
    const {
      accountResolver,
      account,
      wallet,
      onChainAccount,
      resolveAccountSpy,
      resolveOnChainAccountSpy,
      resolveWalletSpy,
    } = setup();

    const result = await accountResolver.resolveAccount({
      accountId: keyringAccountId,
      scope,
      options: DEFAULT_RESOLVE_ACCOUNT_OPTIONS,
    });

    expect(result).toStrictEqual({
      account,
      onChainAccount,
      wallet,
    });
    expect(resolveAccountSpy).toHaveBeenCalledWith({
      accountId: keyringAccountId,
    });
    expect(resolveOnChainAccountSpy).toHaveBeenCalledWith(
      account.address,
      scope,
    );
    expect(resolveWalletSpy).toHaveBeenCalledWith(account);
  });

  it('loads only keyring account and wallet when on-chain load is disabled', async () => {
    const {
      accountResolver,
      account,
      wallet,
      resolveAccountSpy,
      resolveOnChainAccountSpy,
      resolveWalletSpy,
    } = setup();

    const result = await accountResolver.resolveAccount({
      accountId: keyringAccountId,
      scope,
      options: RESOLVE_ACCOUNT_KEYRING_AND_WALLET,
    });

    expect(result).toStrictEqual({
      account,
      wallet,
    });
    expect(resolveAccountSpy).toHaveBeenCalledWith({
      accountId: keyringAccountId,
    });
    expect(resolveOnChainAccountSpy).not.toHaveBeenCalled();
    expect(resolveWalletSpy).toHaveBeenCalledWith(account);
  });

  it('loads on-chain snapshot from state when source is State', async () => {
    const {
      accountResolver,
      account,
      wallet,
      onChainAccount,
      resolveOnChainAccountByKeyringAccountIdSpy,
      resolveOnChainAccountSpy,
    } = setup();
    resolveOnChainAccountByKeyringAccountIdSpy.mockResolvedValue(
      onChainAccount,
    );

    const result = await accountResolver.resolveAccount({
      accountId: keyringAccountId,
      scope,
      options: RESOLVE_ACCOUNT_FULL_FROM_KEYRING_STATE,
    });

    expect(result).toStrictEqual({
      account,
      onChainAccount,
      wallet,
    });
    expect(resolveOnChainAccountByKeyringAccountIdSpy).toHaveBeenCalledWith(
      account.id,
      scope,
    );
    expect(resolveOnChainAccountSpy).not.toHaveBeenCalled();
  });

  it('throws AccountNotActivatedException when state has no on-chain snapshot', async () => {
    const { accountResolver, resolveOnChainAccountByKeyringAccountIdSpy } =
      setup();
    resolveOnChainAccountByKeyringAccountIdSpy.mockResolvedValue(null);

    await expect(
      accountResolver.resolveAccount({
        accountId: keyringAccountId,
        scope,
        options: RESOLVE_ACCOUNT_FULL_FROM_KEYRING_STATE,
      }),
    ).rejects.toThrow(AccountNotActivatedException);
  });

  it('omits wallet when wallet load is disabled', async () => {
    const { accountResolver, account, onChainAccount, resolveWalletSpy } =
      setup();

    const result = await accountResolver.resolveAccount({
      accountId: keyringAccountId,
      scope,
      options: {
        onChainAccount: {
          load: true,
          source: ResolveAccountSource.OnChain,
        },
        wallet: false,
      },
    });

    expect(result).toStrictEqual({
      account,
      onChainAccount,
    });
    expect(resolveWalletSpy).not.toHaveBeenCalled();
  });
});
