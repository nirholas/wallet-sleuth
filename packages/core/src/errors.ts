/** Error classes that carry an HTTP status, so the API layer never has to guess. */

export class SleuthError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 500, details?: unknown) {
    super(message);
    this.name = 'SleuthError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class InvalidInputError extends SleuthError {
  constructor(message: string, details?: unknown) {
    super('invalid_input', message, 400, details);
    this.name = 'InvalidInputError';
  }
}

export class ProviderError extends SleuthError {
  readonly provider: string;
  readonly retryable: boolean;

  constructor(provider: string, message: string, opts: { retryable?: boolean; status?: number } = {}) {
    super('provider_error', message, opts.status ?? 502);
    this.name = 'ProviderError';
    this.provider = provider;
    this.retryable = opts.retryable ?? true;
  }
}

export class BudgetExceededError extends SleuthError {
  constructor(message = 'analysis budget exhausted') {
    super('budget_exceeded', message, 504);
    this.name = 'BudgetExceededError';
  }
}
