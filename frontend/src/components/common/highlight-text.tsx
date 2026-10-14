/** `text` with every case-insensitive occurrence of the search term(s) marked. */
export function HighlightText({ text, terms }: { text: string; terms: string | readonly string[] }) {
  const needles = (typeof terms === 'string' ? [terms] : terms).map((term) => term.trim()).filter(Boolean)
  if (needles.length === 0) return <>{text}</>
  const pattern = new RegExp(`(${needles.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return <>{text.split(pattern).map((part, index) => (index % 2 === 1 ? <mark key={index} className="rounded-sm bg-primary/20 px-0.5 text-foreground">{part}</mark> : part))}</>
}
