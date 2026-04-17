export class TokenApiException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenApiException';
  }
}
