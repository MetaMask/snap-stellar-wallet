export class HttpException extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpException';
    this.status = status;
  }
}
