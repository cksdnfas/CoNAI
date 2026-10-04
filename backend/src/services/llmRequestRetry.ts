import { setTimeout as delay } from 'node:timers/promises'

/** Preserve the HTTP status so authentication/context errors never become connection retries. */
export class LlmRequestError extends Error {
  readonly cause?: unknown
  constructor(message: string, readonly status?: number, options?: { cause?: unknown }) {
    super(message)
    this.cause = options?.cause
  }
}

function isTransientConnectionError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === 'AbortError' || error.name === 'TimeoutError') return false
  if (error instanceof LlmRequestError && error.status !== undefined) {
    if (error.status >= 400 && error.status < 500) return false
    if ([502, 503, 504].includes(error.status)) return true
    return error.status === 500 && /InternalServerError[\s\S]*Connection error/i.test(error.message)
  }
  const code = (error as NodeJS.ErrnoException).code
  const cause = (error as Error & { cause?: unknown }).cause
  return /fetch failed|InternalServerError[\s\S]*Connection error/i.test(error.message)
    || ['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'].includes(code ?? '')
    || (cause !== error && isTransientConnectionError(cause))
}

/** Retry only the failed provider request, never a turn or its already executed tools. */
export async function retryLlmRequest<T>(request: () => Promise<T>, options: {
  signal?: AbortSignal
  canRetry?: () => boolean
} = {}): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    options.signal?.throwIfAborted()
    try {
      return await request()
    } catch (error) {
      if (attempt >= 2 || options.signal?.aborted || options.canRetry?.() === false || !isTransientConnectionError(error)) throw error
      await delay(1000 * (attempt + 1), undefined, { signal: options.signal })
    }
  }
}
