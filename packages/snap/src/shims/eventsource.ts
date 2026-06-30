/* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/no-shadow -- shim mirrors `eventsource` package exports */

const STREAMING_ERROR =
  'Horizon streaming is not supported in the Snap SES environment.';

type ErrorListener = (event: ErrorEvent) => void;

type ErrorEventInit = {
  code?: number;
  message?: string;
};

/**
 * Minimal EventSource error event for the Snap build.
 */
export class ErrorEvent {
  readonly #timeStamp = Date.now();

  readonly type: string;

  readonly code?: number;

  readonly message?: string;

  /**
   * Creates an EventSource error event.
   *
   * @param type - Event type.
   * @param init - Optional event properties.
   */
  constructor(type: string, init: ErrorEventInit = {}) {
    this.type = type;
    this.code = init.code;
    this.message = init.message;
  }

  /**
   * @returns The time the event was created.
   */
  get timeStamp(): number {
    return this.#timeStamp;
  }

  /**
   * @returns Whether the default action was prevented.
   */
  get defaultPrevented(): boolean {
    return false;
  }

  /**
   * @returns Whether the event can be canceled.
   */
  get cancelable(): boolean {
    return false;
  }
}

/**
 * Snap-safe replacement for the `eventsource` package.
 */
export class EventSource {
  static readonly CONNECTING = 0;

  static readonly OPEN = 1;

  static readonly CLOSED = 2;

  readonly CONNECTING = EventSource.CONNECTING;

  readonly OPEN = EventSource.OPEN;

  readonly CLOSED = EventSource.CLOSED;

  readonly #listeners = new Set<ErrorListener>();

  #closed = false;

  onerror: ErrorListener | null = null;

  onmessage: ((event: unknown) => void) | null = null;

  onopen: ((event: unknown) => void) | null = null;

  /**
   * Creates an inert EventSource and reports streaming as unsupported.
   */
  constructor() {
    setTimeout(() => this.#emitUnsupportedError(), 0);
  }

  /**
   * @returns The connection state.
   */
  get readyState(): number {
    return EventSource.CLOSED;
  }

  /**
   * @returns The stream URL.
   */
  get url(): string {
    return '';
  }

  /**
   * @returns Whether credentials are included.
   */
  get withCredentials(): boolean {
    return false;
  }

  /**
   * Registers an error listener.
   *
   * @param type - Event type.
   * @param listener - Listener callback.
   */
  addEventListener(type: string, listener: ErrorListener | null): void {
    if (type === 'error' && listener) {
      this.#listeners.add(listener);
    }
  }

  /**
   * Removes an error listener.
   *
   * @param type - Event type.
   * @param listener - Listener callback.
   */
  removeEventListener(type: string, listener: ErrorListener | null): void {
    if (type === 'error' && listener) {
      this.#listeners.delete(listener);
    }
  }

  /**
   * Closes the inert stream.
   */
  close(): void {
    this.#closed = true;
    this.#listeners.clear();
  }

  #emitUnsupportedError(): void {
    if (this.#closed) {
      return;
    }

    const event = new ErrorEvent('error', { message: STREAMING_ERROR });
    this.onerror?.(event);
    for (const listener of this.#listeners) {
      listener(event);
    }
  }
}

export default EventSource;
