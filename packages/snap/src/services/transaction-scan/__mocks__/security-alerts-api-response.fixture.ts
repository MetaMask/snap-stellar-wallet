export const insufficientBalanceResponse = {
  simulation: {
    status: 'Error',
    error:
      'Reverted: Operation: Payment (operation index: 4) reverted: Account GA7UCNSASSOPQYTRGJ2NC7TDBSXHMWK6JHS7AO6X2ZQAIQSTB5ELNFSO has insufficient balance for asset $USDC after operation. Current unliable balance: 2.4694894, diff: 20',
    error_details: null,
  },
  validation: {
    status: 'Error',
    error: 'Simulation failed',
  },
};

export const invalidContractAddressResponse = {
  simulation: {
    status: 'Error',
    error:
      'Reverted: HostError: Error(Contract, #100)\n\nEvent log (newest first):\n   0: [Diagnostic Event] contract:CBIJBDNZNF4X35BJ4FFZWCDBSCKOP5NB4PLG4SNENRMLAPYG4P5FM6VN, topics:[error, Error(Contract, #100)], data:"escalating error to VM trap from failed host function call: fail_with_error"\n   1: [Diagnostic Event] contract:CBIJBDNZNF4X35BJ4FFZWCDBSCKOP5NB4PLG4SNENRMLAPYG4P5FM6VN, topics:[error, Error(Contract, #100)], data:["failing with contract error", 100]\n   2: [Diagnostic Event] topics:[fn_call, CBIJBDNZNF4X35BJ4FFZWCDBSCKOP5NB4PLG4SNENRMLAPYG4P5FM6VN, transfer], data:[GA7UCNSASSOPQYTRGJ2NC7TDBSXHMWK6JHS7AO6X2ZQAIQSTB5ELNFSO, GB327AMKGJDXEMQREZRRVW7Y6KEKWPOWTJKCCYUQK7KKXVMCTNZEOYXU, 111111111]\n',
    error_details: null,
  },
  validation: {
    status: 'Error',
    error: 'Simulation failed',
  },
};

export const noTrustlineResponse = {
  simulation: {
    status: 'Error',
    error:
      'Reverted: Operation: PathPaymentStrictSend (operation index: 1) reverted: Account GA7UCNSASSOPQYTRGJ2NC7TDBSXHMWK6JHS7AO6X2ZQAIQSTB5ELNFSO has no trustline for AAAd:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    error_details: null,
  },
  validation: {
    status: 'Error',
    error: 'Simulation failed',
  },
};

export const successSwapXLMToUSDCResponse = {
  simulation: {
    status: 'Success',
    assets_diffs: {
      GA7UCNSASSOPQYTRGJ2NC7TDBSXHMWK6JHS7AO6X2ZQAIQSTB5ELNFSO: [
        {
          asset: {
            type: 'NATIVE',
            code: 'XLM',
          },
          in: null,
          out: {
            usd_price: 0.36,
            summary: 'Sent 2 XLM',
            value: 2,
            raw_value: 20000000,
          },
          asset_type: 'NATIVE',
        },
        {
          asset: {
            type: 'ASSET',
            code: 'USDC',
            issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
            org_name: '',
            org_url: '',
          },
          in: {
            usd_price: 1,
            summary: 'Received 1 USDC',
            value: 1,
            raw_value: 10000000,
          },
          out: null,
          asset_type: 'ASSET',
        },
      ],
      GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN: [
        {
          asset: {
            type: 'NATIVE',
            code: 'XLM',
          },
          in: {
            usd_price: 0.18,
            summary: 'Received 1 XLM',
            value: 1,
            raw_value: 10000000,
          },
          out: null,
          asset_type: 'NATIVE',
        },
      ],
    },
    exposures: {},
    assets_ownership_diff: {},
    address_details: [],
    account_summary: {
      account_assets_diffs: [],
      account_exposures: [],
      account_ownerships_diff: [],
      total_usd_diff: {
        in: 0,
        out: 0,
        total: 0,
      },
      total_usd_exposure: {},
    },
    transaction_actions: null,
  },
  validation: {
    status: 'Success',
    result_type: 'Benign',
    description: '',
    reason: '',
    classification: '',
    features: [],
  },
};

export const successPaymentXLMResponse = {
  simulation: {
    status: 'Success',
    assets_diffs: {
      GA7UCNSASSOPQYTRGJ2NC7TDBSXHMWK6JHS7AO6X2ZQAIQSTB5ELNFSO: [
        {
          asset: {
            type: 'NATIVE',
            code: 'XLM',
          },
          in: null,
          out: {
            usd_price: 0.18,
            summary: 'Sent 1 XLM',
            value: 1,
            raw_value: 10000000,
          },
          asset_type: 'NATIVE',
        },
      ],
      GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN: [
        {
          asset: {
            type: 'NATIVE',
            code: 'XLM',
          },
          in: {
            usd_price: 0.18,
            summary: 'Received 1 XLM',
            value: 1,
            raw_value: 10000000,
          },
          out: null,
          asset_type: 'NATIVE',
        },
      ],
    },
    exposures: {},
    assets_ownership_diff: {},
    address_details: [],
    account_summary: {
      account_assets_diffs: [],
      account_exposures: [],
      account_ownerships_diff: [],
      total_usd_diff: {
        in: 0,
        out: 0,
        total: 0,
      },
      total_usd_exposure: {},
    },
    transaction_actions: null,
  },
  validation: {
    status: 'Success',
    result_type: 'Benign',
    description: '',
    reason: '',
    classification: '',
    features: [],
  },
};

export const successPaymentUSDCResponse = {
  simulation: {
    status: 'Success',
    assets_diffs: {
      GA7UCNSASSOPQYTRGJ2NC7TDBSXHMWK6JHS7AO6X2ZQAIQSTB5ELNFSO: [
        {
          asset: {
            type: 'ASSET',
            code: 'USDC',
            issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
            org_name: '',
            org_url: '',
          },
          in: null,
          out: {
            usd_price: 0,
            summary: 'Sent 0.000001 USDC',
            value: 0,
            raw_value: 10,
          },
          asset_type: 'ASSET',
        },
      ],
      GB327AMKGJDXEMQREZRRVW7Y6KEKWPOWTJKCCYUQK7KKXVMCTNZEOYXU: [
        {
          asset: {
            type: 'ASSET',
            code: 'USDC',
            issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
            org_name: '',
            org_url: '',
          },
          in: {
            usd_price: 0,
            summary: 'Received 0.000001 USDC',
            value: 0,
            raw_value: 10,
          },
          out: null,
          asset_type: 'ASSET',
        },
      ],
    },
    exposures: {},
    assets_ownership_diff: {},
    address_details: [],
    account_summary: {
      account_assets_diffs: [],
      account_exposures: [],
      account_ownerships_diff: [],
      total_usd_diff: {
        in: 0,
        out: 0,
        total: 0,
      },
      total_usd_exposure: {},
    },
    transaction_actions: null,
  },
  validation: {
    status: 'Success',
    result_type: 'Benign',
    description: '',
    reason: '',
    classification: '',
    features: [],
  },
};

export const successPaymentSEP41Response = {
  simulation: {
    status: 'Success',
    assets_diffs: {
      GA7UCNSASSOPQYTRGJ2NC7TDBSXHMWK6JHS7AO6X2ZQAIQSTB5ELNFSO: [
        {
          asset: {
            type: 'SEP41',
            address: 'CBIJBDNZNF4X35BJ4FFZWCDBSCKOP5NB4PLG4SNENRMLAPYG4P5FM6VN',
            name: 'Solv BTC',
            symbol: 'SolvBTC',
            decimals: 8,
          },
          in: null,
          out: {
            usd_price: 0,
            summary: 'Sent 1E-8 SolvBTC',
            value: 0,
            raw_value: 1,
          },
          asset_type: 'SEP41',
        },
      ],
      GB327AMKGJDXEMQREZRRVW7Y6KEKWPOWTJKCCYUQK7KKXVMCTNZEOYXU: [
        {
          asset: {
            type: 'SEP41',
            address: 'CBIJBDNZNF4X35BJ4FFZWCDBSCKOP5NB4PLG4SNENRMLAPYG4P5FM6VN',
            name: 'Solv BTC',
            symbol: 'SolvBTC',
            decimals: 8,
          },
          in: {
            usd_price: 0,
            summary: 'Received 1E-8 SolvBTC',
            value: 0,
            raw_value: 1,
          },
          out: null,
          asset_type: 'SEP41',
        },
      ],
    },
    exposures: {},
    assets_ownership_diff: {},
    address_details: [],
    account_summary: {
      account_assets_diffs: [],
      account_exposures: [],
      account_ownerships_diff: [],
      total_usd_diff: {
        in: 0,
        out: 0,
        total: 0,
      },
      total_usd_exposure: {},
    },
    transaction_actions: null,
  },
  validation: {
    status: 'Success',
    result_type: 'Benign',
    description: '',
    reason: '',
    classification: '',
    features: [],
  },
};

export const invalidRequestResponse = {
  statusCode: 400,
  message: 'account_address must be a valid Stellar public key.',
};
