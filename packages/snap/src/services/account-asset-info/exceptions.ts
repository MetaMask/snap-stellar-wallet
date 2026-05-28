export class GetAccountAssetInfoException extends Error {
  constructor(accountId: string) {
    super(`Failed to get account asset info for account ${accountId}`);
    this.name = 'GetAccountAssetInfoException';
  }
}
