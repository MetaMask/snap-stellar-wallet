import { KnownCaip2ChainId, MultichainMethod } from '../../../api';
import { logger } from '../../../utils/logger';
import { State } from '../../state/State';
import { generateStellarAddress } from '../../wallet/__mocks__/fixtures';
import { NetworkService } from '../../wallet/NetworkService';
import { TransactionBuilder } from '../../wallet/TransactionBuilder';
import { WalletService } from '../../wallet/WalletService';
import { AccountService } from '../AccountService';
import { AccountsRepository } from '../AccountsRepository';
import type { StellarKeyringAccount } from '../api';
import { createAccountDeriver, getDerivationPath } from '../derivation';

export const generateStellarKeyringAccount = (
  id: string,
  address: string,
  entropySource: string,
  index: number,
): StellarKeyringAccount => ({
  id,
  address,
  type: 'any:account',
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

export const mockAccountService = () => {
  const networkService = new NetworkService({ logger });
  const transactionBuilder = new TransactionBuilder({ logger });

  const accountService = new AccountService({
    logger,
    accountsRepository: new AccountsRepository(
      new State({
        encrypted: false,
        defaultState: {
          keyringAccounts: {},
        },
      }),
    ),
    walletService: new WalletService({
      logger,
      deriver: createAccountDeriver(logger),
      networkService,
      transactionBuilder,
    }),
  });

  return {
    accountService,
  };
};
