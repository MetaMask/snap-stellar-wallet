export class PriceApiException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PriceApiException';
  }
}
