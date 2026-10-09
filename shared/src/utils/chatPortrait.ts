export type ChatEmoticonMap = {
  profileId: number
  byKeyword: Map<string, string>
  groupByKeyword?: Map<string, number>
}

// Models sometimes drop one star (`&*keyword&`, `&keyword*&`); those forms resolve only for registered keywords.
const TOKEN = /&\*([^*&\n]{1,40})\*?&|&([^*&\n]{1,40})\*&/g
const STICKER = /^\s*(?:&\*([^*&\n]{1,40})\*?&|&([^*&\n]{1,40})\*&)\s*$/
const isCanonical = (token: string) => token.startsWith('&*') && token.endsWith('*&')

/** The renderer and portrait agree on standalone stickers, leaving fenced code alone. */
function mapLines(text: string, transform: (line: string, code: boolean) => string[]) {
  let fence: { marker: string; length: number } | null = null
  return text.split('\n').flatMap((line) => {
    const match = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)
    if (match && !fence) { fence = { marker: match[1][0], length: match[1].length }; return transform(line, true) }
    if (fence) {
      if (match && match[1][0] === fence.marker && match[1].length >= fence.length && !match[2].trim()) fence = null
      return transform(line, true)
    }
    return transform(line, false)
  }).join('\n')
}

export function lastChatSticker(text: string): string | null {
  let keyword: string | null = null
  mapLines(text, (line, code) => {
    const match = code ? null : STICKER.exec(line)
    if (match) keyword = (match[1] ?? match[2]).trim()
    return [line]
  })
  return keyword
}

/** Hide only standalone stickers resolved to the specified groups; inline and ordinary emoticons remain. */
export function injectChatEmoticons(text: string, emoticons: ChatEmoticonMap | null, hiddenGroupIds?: ReadonlySet<number>) {
  if (!text.includes('&*') && !text.includes('*&')) return text
  let removed = false
  let skipBlank = false
  const rendered = mapLines(text, (line, code) => {
    if (code) { skipBlank = false; return [line] }
    if (skipBlank && !line.trim()) return []
    skipBlank = false
    const solo = STICKER.exec(line)
    const word = solo ? (solo[1] ?? solo[2]).trim() : undefined
    const key = word?.toLowerCase()
    const hash = key ? emoticons?.byKeyword.get(key) : undefined
    if (solo && hash) {
      const groupId = emoticons?.groupByKeyword?.get(key!)
      if (groupId !== undefined && hiddenGroupIds?.has(groupId)) { removed = true; skipBlank = true; return [] }
      return [`![${word}](emote-sticker:${hash})`]
    }
    return [line.replace(TOKEN, (token, starred: string | undefined, trailing: string | undefined) => {
      const keyword = (starred ?? trailing ?? '').trim()
      const hash = emoticons?.byKeyword.get(keyword.toLowerCase())
      if (hash) return `![${keyword}](emote:${hash})`
      return isCanonical(token) ? token.replace(/\*/g, '\\*') : token
    })]
  })
  return removed ? rendered.replace(/^\n+|\n+$/g, '') : rendered
}

export type ChatPortraitProfile = {
  id: number
  expressionGroupId?: number | null
  referenceHash?: string | null
  avatarHash?: string | null
  expressions: ReadonlyMap<string, string>
  emotion?: string | null
}
export type ChatPortraitMessage = {
  role: string
  content: string
  display_content?: string | null
  speaker_profile_id?: number | null
  active_alternative?: number
  alternatives?: Array<{ content: string; display_content?: string | null }>
}
export type ChatPortraitSignal = { profileId: number; source: 'expression' | 'reference' | 'avatar'; compositeHash: string | null; emotion: string | null }

/** Recompute from the active transcript; a room carries only the latest speaker's own prior expression. */
export function resolveChatPortrait(messages: readonly ChatPortraitMessage[], profiles: readonly ChatPortraitProfile[], defaultProfileId: number | null): ChatPortraitSignal | null {
  const latest = [...messages].reverse().find((message) => message.role === 'assistant')
  const profileId = latest?.speaker_profile_id ?? defaultProfileId
  const profile = profiles.find((entry) => entry.id === profileId)
  if (!profile?.expressionGroupId) return null
  const expression = (keyword: string | null): ChatPortraitSignal | null => {
    const hash = keyword ? profile.expressions.get(keyword.toLowerCase()) : null
    return hash ? { profileId: profile.id, source: 'expression', compositeHash: hash, emotion: keyword } : null
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant' || (message.speaker_profile_id ?? defaultProfileId) !== profile.id) continue
    const active = message.alternatives?.[message.active_alternative ?? 0] ?? message
    const signal = expression(lastChatSticker(active.display_content || active.content))
    if (signal) return signal
  }
  return expression(profile.emotion ?? null) ?? {
    profileId: profile.id, source: profile.referenceHash ? 'reference' : 'avatar',
    compositeHash: profile.referenceHash || profile.avatarHash || null, emotion: null,
  }
}
