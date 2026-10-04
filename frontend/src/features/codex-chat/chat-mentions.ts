/** `@모두` addresses every member (same words as the server). */
export const EVERYONE_MENTION = '모두'
const EVERYONE_WORDS = [EVERYONE_MENTION, 'all', 'everyone']
export const MENTION_CLASS = 'font-semibold text-secondary-text'

/**
 * Where `@name` mentions sit in a text, by the server's rules: the longest member name wins, a name must not run into
 * more ASCII word characters (Korean particles may follow), and an `@` inside a word (e-mail) is not a mention.
 */
export function findMentions(text: string, names: readonly string[]) {
  const byLength = [...names].filter(Boolean).sort((a, b) => b.length - a.length)
  const found: Array<{ start: number; end: number }> = []
  for (let index = text.indexOf('@'); index >= 0; index = text.indexOf('@', index + 1)) {
    if (index > 0 && /[A-Za-z0-9_.]/.test(text[index - 1])) continue
    const rest = text.slice(index + 1)
    const lower = rest.toLowerCase()
    const word = [...byLength, ...EVERYONE_WORDS].find((name) => lower.startsWith(name.toLowerCase()) && !/^[A-Za-z0-9_]/.test(rest.slice(name.length)))
    if (word) found.push({ start: index, end: index + 1 + word.length })
  }
  return found
}

/** The text cut into plain and mention parts, for rendering. */
export function splitMentions(text: string, names: readonly string[]) {
  const parts: Array<{ text: string; mention: boolean }> = []
  let last = 0
  for (const { start, end } of findMentions(text, names)) {
    if (start > last) parts.push({ text: text.slice(last, start), mention: false })
    parts.push({ text: text.slice(start, end), mention: true })
    last = end
  }
  if (last < text.length) parts.push({ text: text.slice(last), mention: false })
  return parts
}

type HastNode = { type: string; tagName?: string; value?: string; children?: HastNode[]; properties?: Record<string, unknown> }

/** Rehype plugin: highlight `@name` in rendered replies (not inside code). */
export function rehypeMentions(names: readonly string[]) {
  const walk = (node: HastNode) => {
    if (node.type === 'element' && (node.tagName === 'code' || node.tagName === 'pre')) return
    if (!node.children) return
    node.children = node.children.flatMap((child): HastNode[] => {
      if (child.type !== 'text' || !child.value?.includes('@')) {
        walk(child)
        return [child]
      }
      return splitMentions(child.value, names).map((part) => part.mention
        ? { type: 'element', tagName: 'span', properties: { className: MENTION_CLASS.split(' ') }, children: [{ type: 'text', value: part.text }] }
        : { type: 'text', value: part.text })
    })
  }
  return () => (tree: HastNode) => walk(tree)
}

/** The `@query` being typed right before the caret, if any. */
export function mentionQueryAt(text: string, caret: number) {
  const match = /(^|[^A-Za-z0-9_.])@([^\s@]{0,40})$/.exec(text.slice(0, caret))
  return match ? { start: caret - match[2].length - 1, query: match[2] } : null
}
