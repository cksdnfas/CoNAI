/** A user-facing sprite processing error (bad options, unusable input). Routes answer 422 with its message. */
export class SpriteError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode = 422) {
    super(message)
    this.name = 'SpriteError'
    this.statusCode = statusCode
  }
}

export function isSpriteError(error: unknown): error is SpriteError {
  return error instanceof Error && error.name === 'SpriteError'
}
