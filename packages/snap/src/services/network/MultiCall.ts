import {
  Account,
  Address,
  Contract,
  type Operation,
  rpc,
  scValToNative,
  type Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

import { caip2ChainIdToNetwork } from './utils';
import { KnownCaip2ChainId } from '../../api/network';
import { BASE_FEE } from '../../constants';

/**
 * A simulation account to craft a transaction to simulate the balances read
 * It is a funded account to prevent the transaction from failing due to insufficient funds.
 *
 * @see https://developers.stellar.org/docs/tools/sdks/contract-sdks
 */
export const SIMULATION_ACCOUNT: string =
  'GALAXYVOIDAOPZTDLHILAJQKCVVFMD4IKLXLSZV5YHO7VY74IWZILUTO';

/**
 * Smart contract addresses for the Stellar MultiCall contract.
 *
 * @see https://stellar.org/developers/reference/stellar-multi-call/contracts
 * it is recommended by Stellar official site.
 * @see https://developers.stellar.org/docs/tools/sdks/contract-sdks#stellar-multicall--router-sdk
 */
export enum StellarRouterContract {
  V0 = 'CBZV3HBP672BV7FF3ZILVT4CNPW3N5V2WTJ2LAGOAYW5R7L2D5SLUDFZ',
  V1 = 'CCM23MFAJHDWUMF3IM3UPUI4ZUFFKX6OWJNJRUKO2W6MUTQNQWWFH7DC',
}

export type StellarRouterParams = {
  rpcClient: rpc.Server;
  simulationAccount: string;
};

export class InvocationV0 {
  contract: Address | string;

  method: string;

  args: xdr.ScVal[];

  version = 'v0' as const;

  constructor(params: Omit<InvocationV0, 'version'>) {
    this.contract = params.contract;
    this.method = params.method;
    this.args = params.args;
  }
}

export class InvocationV1 {
  contract: Address | string;

  method: string;

  args: xdr.ScVal[];

  canFail?: boolean;

  version = 'v1' as const;

  constructor(params: Omit<InvocationV1, 'version'>) {
    this.contract = params.contract;
    this.method = params.method;
    this.args = params.args;
    this.canFail = params.canFail;
  }
}

export class MultiCall {
  readonly #rpcClient: rpc.Server;

  readonly #simulationAccount: string;

  readonly #routerContract: StellarRouterContract;

  constructor({
    rpcClient,
    simulationAccount = SIMULATION_ACCOUNT,
    routerContract = StellarRouterContract.V0,
  }: {
    rpcClient: rpc.Server;
    simulationAccount?: string;
    routerContract?: StellarRouterContract;
  }) {
    this.#rpcClient = rpcClient;
    this.#simulationAccount = simulationAccount;
    this.#routerContract = routerContract;
  }

  /**
   * This method generates the InvokeHostFunction Operation that you will be able to use within your transactions
   *
   * @param caller - The address that is calling the contract, this account must authorize the transaction even if none of the invocations require authorization.
   * @param invocations - All the invocations the proxy will execute
   * @returns An operation suitable for adding to a Stellar {@link Transaction}.
   */
  exec(
    caller: Contract | Address | string,
    invocations: (InvocationV1 | InvocationV0)[],
  ): xdr.Operation<Operation.InvokeHostFunction> {
    const args: xdr.ScVal[] = invocations.map((invocation) => {
      switch (invocation.version) {
        case 'v0':
          return xdr.ScVal.scvVec([
            new Address(invocation.contract.toString()).toScVal(),
            xdr.ScVal.scvSymbol(invocation.method),
            xdr.ScVal.scvVec(invocation.args),
          ]);

        case 'v1':
          return xdr.ScVal.scvVec([
            new Address(invocation.contract.toString()).toScVal(),
            xdr.ScVal.scvSymbol(invocation.method),
            xdr.ScVal.scvVec(invocation.args),
            xdr.ScVal.scvBool(invocation.canFail === true),
          ]);

        default:
          throw new Error(`Invocation version is not supported.`);
      }
    });

    return new Contract(this.#routerContract).call(
      'exec',
      new Address(caller.toString()).toScVal(),
      xdr.ScVal.scvVec(args),
    );
  }

  /**
   * Simulates a multicall and returns the decoded result value.
   *
   * @param invocations - Invocations to batch.
   * @param opts - Optional caller, source account and scope overrides.
   * @param opts.caller - Account that authorizes the host function call; defaults to the simulation account.
   * @param opts.source - Transaction `source` account; defaults to the simulation account.
   * @param opts.scope - CAIP-2 network ID; defaults to Mainnet.
   * @returns The simulation result as a native value.
   */
  async simResult<Result>(
    invocations: (InvocationV1 | InvocationV0)[],
    opts?: { caller?: string; source?: string; scope?: KnownCaip2ChainId },
  ): Promise<Result> {
    const sourceAccount = opts?.source ?? this.#simulationAccount;
    const callerAccount = opts?.caller ?? this.#simulationAccount;
    const scope = opts?.scope ?? KnownCaip2ChainId.Mainnet;
    const tx: Transaction = new TransactionBuilder(
      // The account sequence number is not used for the simulation,
      // so we can safely set it to 0.
      new Account(sourceAccount, '0'),
      {
        networkPassphrase: caip2ChainIdToNetwork(scope),
        fee: BASE_FEE.toString(),
      },
    )
      .setTimeout(0)
      .addOperation(this.exec(callerAccount, invocations))
      .build();

    const sim = await this.#rpcClient.simulateTransaction(tx);

    if (rpc.Api.isSimulationError(sim)) {
      throw new Error(String(sim.error));
    }

    const retval = sim.result?.retval;
    if (retval === undefined) {
      throw new Error('Simulation returned no result');
    }

    return scValToNative(retval) as Result;
  }
}
