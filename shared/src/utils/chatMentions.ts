const EVERYONE_WORDS = ['모두', 'all', 'everyone']

type Member = { id: number; name: string }

/** Fenced and inline code, and quoted lines, are not addressed to anyone. */
function addressableText(text: string) {
  return text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
}

/**
 * Names a member answers to: its full name, and for a name of several words its first word when no other member
 * shares it (`@Ochako` for "Ochako Uraraka"). Lower case.
 */
export function memberAliases(members: Member[]) {
  const aliases: Array<{ alias: string; id: number }> = members.filter((member) => member.name.trim()).map((member) => ({ alias: member.name.trim().toLowerCase(), id: member.id }))
  const firstWords = new Map<string, number[]>()
  for (const member of members) {
    const words = member.name.trim().toLowerCase().split(/\s+/)
    if (words.length > 1 && words[0].length >= 2) firstWords.set(words[0], [...(firstWords.get(words[0]) ?? []), member.id])
  }
  for (const [word, ids] of firstWords) {
    if (ids.length === 1 && !aliases.some((entry) => entry.alias === word)) aliases.push({ alias: word, id: ids[0] })
  }
  return aliases.sort((a, b) => b.alias.length - a.alias.length)
}

/** The member a name (with or without `@`) means, by the same aliases as mentions. */
export function resolveMemberName(name: string, members: Member[]) {
  const wanted = name.trim().replace(/^@/, '').toLowerCase()
  return memberAliases(members).find((entry) => entry.alias === wanted)?.id ?? null
}

/**
 * Members addressed with `@name`, in the order they appear; `@모두` (`@all`) adds every member in room order. The
 * longest matching name wins, and a name must not run into more ASCII word characters (`@카이야` still names 카이,
 * Korean particles follow names directly). `exclude` (the writer) is never returned.
 */
export function parseMentions(text: string, members: Member[], exclude?: number) {
  const source = addressableText(text)
  const aliases = memberAliases(members)
  const result: number[] = []
  const add = (id: number) => { if (id !== exclude && !result.includes(id)) result.push(id) }
  for (let index = source.indexOf('@'); index >= 0; index = source.indexOf('@', index + 1)) {
    if (index > 0 && /[A-Za-z0-9_.]/.test(source[index - 1])) continue // e-mail addresses
    const rest = source.slice(index + 1)
    const lower = rest.toLowerCase()
    const everyone = EVERYONE_WORDS.find((word) => lower.startsWith(word) && !/^[A-Za-z0-9_]/.test(rest.slice(word.length)))
    const member = aliases.find((entry) => lower.startsWith(entry.alias) && !/^[A-Za-z0-9_]/.test(rest.slice(entry.alias.length)))
    if (member) add(member.id)
    else if (everyone) members.forEach((entry) => add(entry.id))
  }
  return result
}
