const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/

/**
 * A streaming reply cut into its top-level blocks, so the finished ones keep their parsed Markdown while only the last
 * one is parsed again as text arrives. A block ends at a blank line outside a code fence that is followed by an
 * unindented line (an indented line still continues a list item). Text only grows at the end, so earlier cuts stay put.
 */
export function splitSettledMarkdown(text: string): string[] {
  const lines = text.split('\n')
  const blocks: string[] = []
  let start = 0
  let fence: string | null = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (fence) {
      const close = FENCE_CLOSE.exec(line)?.[1]
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = null
      continue
    }
    const open = FENCE_OPEN.exec(line)?.[1]
    if (open) { fence = open; continue }
    const next = lines[index + 1]
    if (!line.trim() && next && !/^\s/.test(next)) {
      const block = lines.slice(start, index).join('\n')
      if (block.trim()) blocks.push(block)
      start = index + 1
    }
  }
  const tail = lines.slice(start).join('\n')
  if (tail.trim()) blocks.push(tail)
  return blocks
}
