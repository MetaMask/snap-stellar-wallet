export class TransactionScanException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionScanException';
  }
}
