const PROMPT_COMMENT_BLOCK_REGEX = /[ \t]*\/\/[^/\r\n][^\r\n]*?\/\/[ \t]*(?:\r?\n)?/g;
const TEXT_SEGMENT_SPREADSHEET_ROW_SEPARATOR = '\u001E';

/** Remove UI-only prompt preset comments before text reaches generation providers. */
export function stripPromptPresetComments(value: string): string {
  return value
    .split(TEXT_SEGMENT_SPREADSHEET_ROW_SEPARATOR).join('\n')
    .replace(PROMPT_COMMENT_BLOCK_REGEX, '')
    .trim();
}
