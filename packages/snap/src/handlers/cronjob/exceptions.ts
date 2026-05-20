export class CronjobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CronjobError';
  }
}

export class CronjobMethodNotFoundError extends CronjobError {
  constructor(method: string) {
    super(`Unknown cronjob method: ${method}`);
    this.name = 'CronjobMethodNotFoundError';
  }
}
