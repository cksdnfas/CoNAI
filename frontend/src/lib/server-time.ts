/** A server timestamp as a Date. SQLite `CURRENT_TIMESTAMP` ("YYYY-MM-DD HH:MM:SS") is UTC without a zone marker. */
export function parseServerDate(value: string) {
  return new Date(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value) ? `${value.replace(' ', 'T')}Z` : value)
}
