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

/** Convert spreadsheet row separators back to ordinary text before generation/API use. */
export function normalizeTextSegmentSpreadsheetText(value: string) {
  return value.replaceAll(TEXT_SEGMENT_SPREADSHEET_ROW_SEPARATOR, '\n')
}
