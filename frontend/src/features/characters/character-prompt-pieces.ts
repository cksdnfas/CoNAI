type PromptPiece = { start: number; end: number; text: string }

/** Tokenization is for interpretation, not editing: retain the original bytes around each top-level comma. */
function promptPieces(value: string): PromptPiece[] {
  const pieces: PromptPiece[] = []
  const brackets: string[] = []
  const closing: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
  let start = 0
  let weighted = false
  const push = (end: number) => {
    const text = value.slice(start, end).trim()
    if (text) pieces.push({ start, end, text })
  }
  for (let at = 0; at < value.length; at += 1) {
    const char = value[at]
    if (char === '\\') { at += 1; continue }
    if (value.startsWith('::', at)) { weighted = !weighted; at += 1; continue }
    if (closing[char]) brackets.push(closing[char])
    else if (char === brackets[brackets.length - 1]) brackets.pop()
    else if (char === ',' && !brackets.length && !weighted) { push(at); start = at + 1 }
  }
  push(value.length)
  return pieces
}

export function promptPieceTexts(value: string): string[] {
  return promptPieces(value).map((piece) => piece.text)
}

export function appendPromptPiece(value: string, added: string) {
  if (!added.trim()) return value
  return value + (value.trim() ? value.trimEnd().endsWith(',') ? ' ' : ', ' : '') + added.trim()
}

export function removePromptPiece(value: string, index: number) {
  const piece = promptPieces(value)[index]
  if (!piece) return value
  return piece.end < value.length
    ? value.slice(0, piece.start) + value.slice(piece.end + 1)
    : value.slice(0, Math.max(0, piece.start - 1))
}

export function movePromptPiece(source: string, destination: string, index: number) {
  const piece = promptPieces(source)[index]
  return piece ? { source: removePromptPiece(source, index), destination: appendPromptPiece(destination, piece.text) } : { source, destination }
}
