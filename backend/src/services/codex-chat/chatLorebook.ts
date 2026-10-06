import { createHash } from 'crypto'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { ChatProfileError } from './chatProfileError'

/**
 * How secondary keywords narrow a match on the primary ones (SillyTavern's selective logic): any of them also
 * present, not all of them, none of them, or all of them.
 */
export type LoreSecondaryLogic = 'andAny' | 'notAll' | 'notAny' | 'andAll'
const SECONDARY_LOGICS: readonly LoreSecondaryLogic[] = ['andAny', 'notAll', 'notAny', 'andAll']

export type ChatLoreEntry = {
  id: string
  /** What the book's index calls the entry; '' derives one (see loreEntryTitle). */
  title: string
  /** Plain words match as substrings; `/pattern/flags` is a regular expression. */
  keys: string[]
  /** Checked only once a primary keyword matched; none means no further condition. */
  secondaryKeys: string[]
  secondaryLogic: LoreSecondaryLogic
  content: string
  enabled: boolean
  constant: boolean
  order: number
  caseSensitive: boolean
  /**
   * A text file this entry points at, relative to the book's folder (`자료/x.md`); null: a plain entry. Account and
   * chat books only. `fileId` is the file store id that follows the file when it is moved or renamed; `file` is what
   * a person reads.
   */
  file: string | null
  fileId: string | null
}

/**
 * Where a book lives. `global`: shared by the admin, in the database only. `account`: one folder of an account's file
 * store (`로어북/<name>/`). `chat`: the same shape under `로어북/채팅/`, tied to one chat.
 */
export type ChatLorebookKind = 'global' | 'account' | 'chat'

/** A shared lorebook. Profiles link it by id, so editing or re-importing it reaches every linked profile. */
export type ChatLorebook = {
  id: number
  name: string
  kind: ChatLorebookKind
  entries: ChatLoreEntry[]
  /** Profiles that link this book. */
  profiles: Array<{ id: number; name: string }>
  createdDate: string
  updatedDate: string
}

export const LOREBOOK_MAX_ENTRIES = 500
export const PROFILE_MAX_LOREBOOKS = 20
export const LOREBOOK_NAME_MAX_LENGTH = 80
const LORE_TITLE_MAX_LENGTH = 80
const LORE_FILE_MAX_LENGTH = 300

/** The entry's title as the index shows it: its own, else the first keyword, else the start of its text. */
export function loreEntryTitle(entry: Pick<ChatLoreEntry, 'title' | 'keys' | 'content'>) {
  return entry.title || entry.keys[0] || entry.content.slice(0, 20)
}

/** A file path as stored: forward slashes, no leading `./`; null when empty. Safety is checked by the book (see isSafeLoreFilePath). */
function loreFilePath(value: unknown) {
  if (typeof value !== 'string') return null
  const path = value.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').slice(0, LORE_FILE_MAX_LENGTH)
  return path || null
}

/** Whether a stored path stays inside its book folder: relative, no `.`/`..` or empty segments, no drive letter. */
export function isSafeLoreFilePath(path: string) {
  if (!path || path.startsWith('/') || path.includes(':') || path.includes('\\')) return false
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/** Plain keywords up to 100 characters; a `/regex/` keyword up to its own limit, so it is not cut into a plain word. */
function keywordList(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((key): key is string => typeof key === 'string').map((key) => key.trim()).map((key) => key.slice(0, isRegexKeyword(key) ? REGEX_KEY_MAX_LENGTH + 2 : 100)).filter(Boolean))].slice(0, 20)
    : []
}

/** SillyTavern stores the logic as 0-3 (on the entry, or in a card's `extensions`); this app as its name. */
function secondaryLogicOf(row: Record<string, unknown>): LoreSecondaryLogic {
  const extensions = row.extensions && typeof row.extensions === 'object' ? row.extensions as Record<string, unknown> : {}
  const value = row.secondaryLogic ?? row.selectiveLogic ?? extensions.selectiveLogic
  if (typeof value === 'string' && SECONDARY_LOGICS.includes(value as LoreSecondaryLogic)) return value as LoreSecondaryLogic
  return typeof value === 'number' && SECONDARY_LOGICS[value] ? SECONDARY_LOGICS[value] : 'andAny'
}

/**
 * Accepts this app's entries, character card books (keys / secondary_keys / selective / insertion_order /
 * case_sensitive), SillyTavern world info (key / keysecondary / selective / selectiveLogic / disable / order /
 * caseSensitive) and NovelAI lorebooks (text / forceActivation). Secondary keywords count only on a selective entry,
 * as in SillyTavern; this app's own entries are always selective.
 */
export function normalizeLorebook(value: unknown): ChatLoreEntry[] {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return [] }
  }
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  return value.slice(0, LOREBOOK_MAX_ENTRIES).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const row = entry as Record<string, unknown>
    let id = typeof row.id === 'string' ? row.id.trim().slice(0, 80) : ''
    if (!id || ids.has(id)) id = `lore-${index}-${ids.size}`
    while (ids.has(id)) id += '-'
    ids.add(id)
    const keys = Array.isArray(row.keys) ? row.keys : Array.isArray(row.key) ? row.key : []
    const selective = row.selective === undefined || row.selective === true
    const secondary = selective ? row.secondaryKeys ?? row.secondary_keys ?? row.keysecondary : undefined
    const content = typeof row.content === 'string' ? row.content : typeof row.text === 'string' ? row.text : ''
    const order = typeof row.order === 'number' ? row.order : row.insertion_order
    // SillyTavern keeps an entry's title in `comment`.
    const title = typeof row.title === 'string' ? row.title : typeof row.comment === 'string' ? row.comment : ''
    const file = loreFilePath(row.file)
    return [{
      id,
      title: title.trim().replace(/\s+/g, ' ').slice(0, LORE_TITLE_MAX_LENGTH),
      keys: keywordList(keys),
      secondaryKeys: keywordList(secondary),
      secondaryLogic: secondaryLogicOf(row),
      content: content.trim().slice(0, 20_000),
      enabled: row.enabled !== false && row.disable !== true,
      constant: row.constant === true || row.forceActivation === true,
      order: typeof order === 'number' && Number.isFinite(order) ? Math.max(-10_000, Math.min(10_000, Math.round(order))) : index,
      caseSensitive: row.caseSensitive === true || row.case_sensitive === true,
      file,
      fileId: file && typeof row.fileId === 'string' && /^[a-f0-9]{32}$/.test(row.fileId) ? row.fileId : null,
    }]
  })
}

/** A global book links no files. */
function withoutFiles(entries: ChatLoreEntry[]) {
  return entries.map((entry) => ({ ...entry, file: null, fileId: null }))
}

export function normalizeLorebookIds(value: unknown): number[] {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return [] }
  }
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, PROFILE_MAX_LOREBOOKS)
}

export type LorebookRow = {
  id: number
  name: string
  entries: string
  kind: ChatLorebookKind
  /** File store owner key (`account:<id>` / `bootstrap`); null for a global book. */
  owner_key: string | null
  /** The book's folder in the owner's file store; null for a global book. */
  folder_id: string | null
  /** Chat books: the chat they belong to. */
  thread_id: number | null
  /** Account and chat books: which lorebook.json the cached entries came from (id, updated_at, size). */
  source_stamp: string | null
  created_date: string
  updated_date: string
}

function lorebookName(value: unknown) {
  return (typeof value === 'string' ? value.trim().slice(0, LOREBOOK_NAME_MAX_LENGTH) : '') || '로어북'
}

export function linkedProfiles() {
  const rows = getUserSettingsDb().prepare("SELECT id, name, lorebook_ids FROM llm_chat_profiles WHERE lorebook_ids IS NOT NULL AND lorebook_ids != '[]' ORDER BY sort_order ASC, id ASC").all() as Array<{ id: number; name: string; lorebook_ids: string }>
  return rows.map((row) => ({ id: row.id, name: row.name, lorebookIds: normalizeLorebookIds(row.lorebook_ids) }))
}

export function toLorebook(row: LorebookRow, profiles: ReturnType<typeof linkedProfiles>): ChatLorebook {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind ?? 'global',
    entries: normalizeLorebook(row.entries),
    profiles: profiles.filter((profile) => profile.lorebookIds.includes(row.id)).map(({ id, name }) => ({ id, name })),
    createdDate: row.created_date,
    updatedDate: row.updated_date,
  }
}

/**
 * Global books (the admin's shared ones). Account and chat books live in the owner's file store; see
 * chatLorebookFiles.ts for those.
 */
export const ChatLorebookStore = {
  list() {
    const rows = getUserSettingsDb().prepare("SELECT * FROM chat_lorebooks WHERE kind = 'global' ORDER BY name COLLATE NOCASE ASC, id ASC").all() as LorebookRow[]
    const profiles = linkedProfiles()
    return rows.map((row) => toLorebook(row, profiles))
  },

  find(lorebookId: number) {
    const row = getUserSettingsDb().prepare('SELECT * FROM chat_lorebooks WHERE id = ?').get(lorebookId) as LorebookRow | undefined
    return row ? toLorebook(row, linkedProfiles()) : null
  },

  /** Ids of these that still exist and a profile can link (global and account books, not chat books), in the given order. */
  existing(ids: number[]) {
    if (ids.length === 0) return []
    const found = new Set((getUserSettingsDb().prepare(`SELECT id FROM chat_lorebooks WHERE kind IN ('global', 'account') AND id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as Array<{ id: number }>).map((row) => row.id))
    return ids.filter((id) => found.has(id))
  },

  /**
   * A profile is shared, but an account book is private: whoever saves a profile may add their own account books
   * only. Links already on the profile (another account's) stay as they are.
   */
  assertProfileLinks(ids: number[], owner: string, previousIds: readonly number[] = []) {
    const added = ids.filter((id) => !previousIds.includes(id))
    if (added.length === 0) return
    const foreign = getUserSettingsDb().prepare(`SELECT id FROM chat_lorebooks WHERE kind = 'account' AND owner_key IS NOT ? AND id IN (${added.map(() => '?').join(', ')})`).all(owner, ...added)
    if (foreign.length > 0) throw new ChatProfileError('다른 계정의 로어북은 연결할 수 없어.')
  },

  /**
   * The entries of these books in book order (missing books are skipped), keyed `book:entry:content hash`. Global
   * books only for now: account books are private, and a shared profile's links can name several accounts' books.
   */
  keyedEntriesOf(ids: number[]) {
    if (ids.length === 0) return []
    const rows = getUserSettingsDb().prepare(`SELECT id, entries FROM chat_lorebooks WHERE kind = 'global' AND id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as Array<{ id: number; entries: string }>
    const byId = new Map(rows.map((row) => [row.id, normalizeLorebook(row.entries)]))
    return ids.flatMap((bookId) => (byId.get(bookId) ?? []).map((entry) => ({
      key: `${bookId}:${entry.id}:${createHash('sha1').update(entry.content).digest('hex').slice(0, 10)}`,
      entry,
    })))
  },

  create(input: { name?: unknown; entries?: unknown }) {
    const result = getUserSettingsDb().prepare("INSERT INTO chat_lorebooks (name, entries, kind) VALUES (?, ?, 'global')").run(lorebookName(input.name), JSON.stringify(withoutFiles(normalizeLorebook(input.entries ?? []))))
    return ChatLorebookStore.find(Number(result.lastInsertRowid)) as ChatLorebook
  },

  /** Global books only (null for any other): account and chat books are written through their files. */
  update(lorebookId: number, patch: { name?: unknown; entries?: unknown }) {
    const current = ChatLorebookStore.find(lorebookId)
    if (!current || current.kind !== 'global') return null
    getUserSettingsDb().prepare('UPDATE chat_lorebooks SET name = ?, entries = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?').run(
      patch.name === undefined ? current.name : lorebookName(patch.name),
      JSON.stringify(patch.entries === undefined ? current.entries : withoutFiles(normalizeLorebook(patch.entries))),
      lorebookId,
    )
    return ChatLorebookStore.find(lorebookId)
  },

  /** Global books only. Also unlinks the book from every profile. */
  delete(lorebookId: number) {
    const db = getUserSettingsDb()
    return db.transaction(() => {
      if (ChatLorebookStore.find(lorebookId)?.kind !== 'global') return false
      const unlink = db.prepare('UPDATE llm_chat_profiles SET lorebook_ids = ? WHERE id = ?')
      for (const profile of linkedProfiles()) {
        if (profile.lorebookIds.includes(lorebookId)) unlink.run(JSON.stringify(profile.lorebookIds.filter((id) => id !== lorebookId)), profile.id)
      }
      return db.prepare('DELETE FROM chat_lorebooks WHERE id = ?').run(lorebookId).changes > 0
    })()
  },
}

type LoreProfile = { lorebookIds: number[]; loreScanDepth: number; loreTokenBudget: number }

export type SelectedLore = {
  /** Every chosen entry in order (what Codex gets in one block). */
  text: string
  /** "Always on" entries: fixed for the profile, so they belong with the stable system prompt. */
  constant: string
  /** Entries matched by keyword: change with the conversation, so they go near its end. */
  keyed: string
  keys: string[]
  /** Each chosen entry as a person names it (its first keyword), in the same order as `keys`. */
  labels: string[]
}

/** Longest regular expression accepted as a keyword. */
const REGEX_KEY_MAX_LENGTH = 200
/** The end of the conversation keywords are looked for in; regular expressions get a shorter end. */
const SCAN_TEXT_MAX_LENGTH = 20_000
const REGEX_SCAN_MAX_LENGTH = 4000
const regexCache = new Map<string, RegExp | null>()

/**
 * Whether a pattern's matching time stays small whatever the text: at most one unbounded repetition (`*`, `+`,
 * `{n,}`), no repeated group that holds a repetition or an alternation (`(a+)+`, `(a|b)*`), no backreferences.
 * With one repetition the cost is at worst quadratic in the (bounded) text; nested or stacked repetitions are the
 * shapes that backtrack exponentially, and no pattern check short of that is reliable.
 */
export function isBoundedRegexSource(source: string) {
  const open: boolean[] = []
  let closedRisky = false
  let unbounded = 0
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    let justClosed = false
    if (char === '\\') {
      if (/[1-9k]/.test(source[index + 1] ?? '')) return false
      index += 1
    } else if (char === '[') {
      // A character class: its contents are literal.
      index += 1
      while (index < source.length && source[index] !== ']') index += source[index] === '\\' ? 2 : 1
      if (index >= source.length) return false
    } else if (char === '(') {
      const modifier = /^\(\?(?:[:=!]|<[=!]|<[A-Za-z_]\w*>)/.exec(source.slice(index))
      if (/^\(\?/.test(source.slice(index)) && !modifier) return false
      if (modifier) index += modifier[0].length - 1
      open.push(false)
    } else if (char === ')') {
      if (open.length === 0) return false
      const risky = open.pop() as boolean
      if (risky && open.length) open[open.length - 1] = true
      closedRisky = risky
      justClosed = true
    } else if (char === '|') {
      if (open.length) open[open.length - 1] = true
    } else if (char === '*' || char === '+' || char === '?' || char === '{') {
      let repeats = char !== '?'
      let isUnbounded = char === '*' || char === '+'
      if (char === '{') {
        const range = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(index))
        if (!range) continue
        isUnbounded = range[2] !== undefined && range[3] === ''
        repeats = isUnbounded || Number(range[3] ?? range[1]) > 1
        index += range[0].length - 1
      }
      if (closedRisky && repeats) return false
      if (isUnbounded && ++unbounded > 1) return false
      for (let level = 0; level < open.length; level += 1) open[level] = true
      if (source[index + 1] === '?') index += 1
    }
    if (!justClosed) closedRisky = false
  }
  return open.length === 0
}

/**
 * A `/pattern/flags` keyword as a regular expression; null for a plain word, or for one that is too long, does not
 * compile, or could take long to match (see isBoundedRegexSource) — skipped rather than risk a stalled server.
 */
function keywordRegex(word: string, caseSensitive: boolean) {
  const match = /^\/(.+)\/([a-z]*)$/s.exec(word)
  if (!match) return null
  const cacheKey = `${caseSensitive ? 1 : 0}${word}`
  if (regexCache.has(cacheKey)) return regexCache.get(cacheKey) ?? null
  let regex: RegExp | null = null
  if (match[1].length <= REGEX_KEY_MAX_LENGTH && isBoundedRegexSource(match[1])) {
    const flags = [...new Set(match[2].replace(/[^imsu]/g, '') + (caseSensitive ? '' : 'i'))].join('')
    try { regex = new RegExp(match[1], flags) } catch { regex = null }
  }
  if (regexCache.size > 1000) regexCache.clear()
  regexCache.set(cacheKey, regex)
  return regex
}

export function isRegexKeyword(word: string) {
  return /^\/.+\/[a-z]*$/s.test(word)
}

function keywordMatches(word: string, entry: Pick<ChatLoreEntry, 'caseSensitive'>, recent: string, folded: string) {
  if (!word) return false
  if (isRegexKeyword(word)) return keywordRegex(word, entry.caseSensitive)?.test(recent.slice(-REGEX_SCAN_MAX_LENGTH)) ?? false
  return entry.caseSensitive ? recent.includes(word) : folded.includes(word.toLowerCase())
}

/** Whether a keyword entry fires on this text: a primary keyword, then its secondary condition. */
export function loreEntryMatches(entry: Pick<ChatLoreEntry, 'keys' | 'secondaryKeys' | 'secondaryLogic' | 'caseSensitive'>, recent: string, folded = recent.toLowerCase()) {
  if (!entry.keys.some((word) => keywordMatches(word, entry, recent, folded))) return false
  const secondary = entry.secondaryKeys ?? []
  if (secondary.length === 0) return true
  const hits = secondary.filter((word) => keywordMatches(word, entry, recent, folded)).length
  switch (entry.secondaryLogic) {
    case 'notAll': return hits < secondary.length
    case 'notAny': return hits === 0
    case 'andAll': return hits === secondary.length
    default: return hits > 0
  }
}

/**
 * The entries a reply gets, each with a stable key (`book:entry:content hash`) so a caller that keeps context
 * (Codex) can skip what it already sent. Books are read at send time so edits apply at once. No messages means a
 * prompt preview: constant entries only. The last `loreScanDepth` messages are scanned as the model and the reader
 * see them (a chat with a translation model keeps both). Keywords never run code; `/regex/` keywords are bounded
 * (see keywordRegex). One token budget covers constant and keyed entries together (see the selection below).
 */
export function selectLoreEntries(profile: LoreProfile, messages: ReadonlyArray<{ content: string; display_content?: string | null }> | undefined, estimate: (text: string) => number, render: (text: string) => string, options: { skip?: (key: string) => boolean } = {}): SelectedLore {
  const lorebook = ChatLorebookStore.keyedEntriesOf(profile.lorebookIds)
  if (lorebook.length === 0) return { text: '', constant: '', keyed: '', keys: [], labels: [] }
  const recent = (messages?.slice(-profile.loreScanDepth).map((message) => [message.content, message.display_content].filter(Boolean).join('\n')).join('\n') ?? '').slice(-SCAN_TEXT_MAX_LENGTH)
  const folded = recent.toLowerCase()
  const active = lorebook.filter(({ key, entry }) => !options.skip?.(key) && entry.enabled && entry.content.trim() && (entry.constant || (messages !== undefined && loreEntryMatches(entry, recent, folded))))
  // The budget keeps entries as SillyTavern does: "always on" ones first, then the higher order first.
  const byPriority = [...active].sort((a, b) => Number(b.entry.constant) - Number(a.entry.constant) || b.entry.order - a.entry.order)
  const chosen: Array<{ key: string; entry: ChatLoreEntry; rendered: string }> = []
  let used = 0
  for (const { key, entry } of byPriority) {
    const rendered = render(entry.content)
    const cost = estimate(rendered)
    if (used + cost > profile.loreTokenBudget) continue
    chosen.push({ key, entry, rendered })
    used += cost
  }
  // Placed in order: a higher order lands later, closer to the end, where it weighs more.
  chosen.sort((a, b) => a.entry.order - b.entry.order)
  const pick = (constant: boolean) => chosen.filter(({ entry }) => entry.constant === constant).map(({ rendered }) => rendered).join('\n\n')
  return {
    text: chosen.map(({ rendered }) => rendered).join('\n\n'),
    constant: pick(true),
    keyed: pick(false),
    keys: chosen.map(({ key }) => key),
    labels: chosen.map(({ entry }) => entry.keys[0] ?? entry.content.slice(0, 20)),
  }
}

export function buildLorebookText(profile: LoreProfile, messages: ReadonlyArray<{ content: string }> | undefined, estimate: (text: string) => number, render: (text: string) => string) {
  return selectLoreEntries(profile, messages, estimate, render).text
}
