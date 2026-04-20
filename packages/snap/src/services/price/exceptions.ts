export class PriceServiceException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PriceServiceException';
  }
}
