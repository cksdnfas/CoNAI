/** Rough tokens: ~4 ASCII characters or ~1 other character (Korean, CJK) per token. Errs high. */
export function rawTokenEstimate(text: string) {
  let ascii = 0
  let other = 0
  for (const char of text) {
    if (char.charCodeAt(0) < 128) ascii += 1
    else other += 1
  }
  return Math.ceil(ascii / 4 + other)
}
