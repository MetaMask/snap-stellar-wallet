import { KnownCaip2ChainId } from '../../../api';
import { KEYRING_ACCOUNT_TYPE } from '../../../constants';
import { MultichainMethod } from '../../../handlers/keyring/api';
import { logger } from '../../../utils/logger';
import { State } from '../../state/State';
import { WalletService, getDerivationPath } from '../../wallet';
import { generateStellarAddress } from '../../wallet/__mocks__/wallet.fixtures';
import { AccountService } from '../AccountService';
import { AccountsRepository } from '../AccountsRepository';
import type { StellarKeyringAccount } from '../api';

export const generateStellarKeyringAccount = (
  id: string,
  address: string,
  entropySource: string,
  index: number,
): StellarKeyringAccount => ({
  id,
  address,
  type: KEYRING_ACCOUNT_TYPE,
  options: {
    entropy: {
      type: 'mnemonic',
      id: entropySource,
      derivationPath: getDerivationPath(index),
      groupIndex: index,
    },
    exportable: true,
  },
  methods: Object.values(MultichainMethod),
  scopes: [KnownCaip2ChainId.Mainnet],
  entropySource,
  derivationPath: getDerivationPath(index),
  index,
});

export const generateMockStellarKeyringAccounts = (
  count: number,
  entropySource: string,
): StellarKeyringAccount[] =>
  Array.from({ length: count }, (_, index) =>
    generateStellarKeyringAccount(
      globalThis.crypto.randomUUID(),
      generateStellarAddress(),
      entropySource,
      index,
    ),
  );

/**
 * Account-layer stack only.
 *
 * @returns Account service and wallet service wired to the same state.
 */
export const mockAccountService = () => {
  const walletService = new WalletService({ logger });
  const state = new State({
    encrypted: false,
    defaultState: {
      keyringAccounts: {},
      accountMetadata: {},
    },
  });
  const accountService = new AccountService({
    logger,
    accountsRepository: new AccountsRepository(state),
    walletService,
  });

  return {
    accountService,
    walletService,
  };
};
