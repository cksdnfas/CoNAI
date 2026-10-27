export type TextSegmentSpreadsheetValue = string | string[]

export const TEXT_SEGMENT_SPREADSHEET_ROW_SEPARATOR = '\u001E'

/** Normalize one prompt-like value into stable spreadsheet rows. */
export function getTextSegmentSpreadsheetRows(value: TextSegmentSpreadsheetValue) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value : ['']
  }

  if (typeof value === 'string') {
    const lines = value.includes(TEXT_SEGMENT_SPREADSHEET_ROW_SEPARATOR)
      ? value.split(TEXT_SEGMENT_SPREADSHEET_ROW_SEPARATOR)
      : value.split('\n')
    return lines.length > 0 ? lines : ['']
  }

  return ['']
}

/** Join rows without confusing row boundaries with textarea-internal line breaks. */
export function joinTextSegmentSpreadsheetRows(rows: string[]) {
  return rows.join(TEXT_SEGMENT_SPREADSHEET_ROW_SEPARATOR)
}

/** Add text to one prompt row the way the row's preset insertion does: on its own line after any existing text. */
export function appendPromptRowText(row: string, text: string) {
  const separator = row.trim().length > 0 && !row.endsWith('\n') ? '\n' : ''
  return `${row}${separator}${text}`
}

/** Add text to the last row of a whole prompt value, keeping its shape (joined text or a row list). */
export function appendPromptText<T extends TextSegmentSpreadsheetValue>(value: T, text: string): T {
  if (typeof value === 'string' && !value.includes(TEXT_SEGMENT_SPREADSHEET_ROW_SEPARATOR)) return appendPromptRowText(value, text) as T
  const rows = getTextSegmentSpreadsheetRows(value)
  const nextRows = [...rows.slice(0, -1), appendPromptRowText(rows[rows.length - 1], text)]
  return (Array.isArray(value) ? nextRows : joinTextSegmentSpreadsheetRows(nextRows)) as T
}

/** Convert spreadsheet row separators back to ordinary text before generation/API use. */
export function normalizeTextSegmentSpreadsheetText(value: string) {
  return value.replaceAll(TEXT_SEGMENT_SPREADSHEET_ROW_SEPARATOR, '\n')
}
