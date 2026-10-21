/**
 * Keep valid weight openers intact, but separate a digit from a closing `::`.
 * A single colon is not a tag boundary; a preceding double colon is.
 */
export function normalizeNaiWeightSyntax(prompt: string): string {
  return prompt.replace(
    /(?:(?<![\w.:-])|(?<=::))-?(?:\d+(?:\.\d+)?|\.\d+)::|(\d)::/g,
    (match, closingDigit: string | undefined) => closingDigit === undefined ? match : `${closingDigit} ::`,
  )
}
