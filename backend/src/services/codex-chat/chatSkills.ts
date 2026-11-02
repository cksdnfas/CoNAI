import {
  CHAT_PROFILE_DEFAULTS, CHAT_SKILL_LIMITS, CHAT_SKILL_VERSIONS_KEPT, normalizeSkillSectionPath, rawTokenEstimate, skillSectionGroup, skillSectionPathKey,
  type ChatSkillSectionChange, type ChatSkillSectionFields,
} from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { chatProfileOrderSql } from './chatProfileOrder'
import { ChatProfileError, ChatRevisionConflict } from './chatProfileError'
import { notifySemanticChange } from '../embeddings/semanticSignal'

/**
 * Shared skills: instructions for one kind of task, kept on their own so profiles link them by id the way they link
 * display blocks. A skill loads in steps, so a long one costs only what a request needs: the system prompt lists each
 * linked skill's name and when to use it; use_skill returns the overview with a table of the sections; the model then
 * loads only the sections it needs (one group level: `name` or `group/name`). Only administrators write them (the
 * editor, an import, or a propose_skill card), never the shared file store, so whoever may edit files cannot change a
 * profile's instructions. A plugin's skills come from its package and change only with it.
 */
export type ChatSkillSection = ChatSkillSectionFields & { loadCount: number; lastLoadedAt: string | null; updatedDate: string }
export type ChatSkillSource = 'user' | 'import' | 'plugin'

type ChatSkillBase = {
  id: number
  name: string
  /** When the skill applies: the chat model chooses by this alone. */
  description: string
  /** Groups skills in the library; the model never sees it. */
  category: string
  source: ChatSkillSource
  /** The plugin a `plugin` skill comes from, else null. */
  pluginId: string | null
  /** False while that plugin is off: profiles keep the link, use_skill does not offer it. */
  enabled: boolean
  /** Counts saves; an editor sends the one it loaded so a newer save is never overwritten. */
  revision: number
  /** Overview loads (sections count their own). */
  loadCount: number
  lastLoadedAt: string | null
  /** Profiles that link this skill. */
  profiles: Array<{ id: number; name: string }>
  createdDate: string
  updatedDate: string
}

export type ChatSkill = ChatSkillBase & {
  /** The overview: what use_skill returns first, above the table of sections. */
  instructions: string
  sections: ChatSkillSection[]
}

/** A library row: the texts' lengths instead of the texts. */
export type ChatSkillSummary = ChatSkillBase & {
  instructionsLength: number
  sections: Array<Pick<ChatSkillSection, 'path' | 'title' | 'summary' | 'loadCount' | 'lastLoadedAt'> & { length: number }>
}

/** What a save writes and a version keeps. */
export type ChatSkillSnapshot = { name: string; description: string; category: string; instructions: string; sections: ChatSkillSectionFields[] }
export type ChatSkillInput = { name?: unknown; description?: unknown; category?: unknown; instructions?: unknown; sections?: unknown }
export type ChatSkillPatch = ChatSkillInput & { sectionChanges?: unknown }

export const USE_SKILL_TOOL = 'use_skill'

type SkillRow = {
  id: number; name: string; description: string; category: string; instructions: string; source: string; source_ref: string | null
  enabled: number; revision: number; load_count: number; last_loaded_at: string | null; created_date: string; updated_date: string
}
type SectionRow = { skill_id: number; path: string; title: string; summary: string; content: string; load_count: number; last_loaded_at: string | null; updated_date: string }

export function normalizeSkillIds(value: unknown): number[] {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return [] }
  }
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, CHAT_SKILL_LIMITS.perProfile)
}

/** Names compare as a model may write them back: case, width and spacing aside. */
export function skillNameKey(name: string) {
  return name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

// ------------------------------------------------------------------ validation

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function fail(english: boolean, ko: string, en: string): never {
  throw new ChatProfileError(english ? en : ko)
}

function readText(value: unknown, max: number, label: { ko: string; en: string }, english: boolean, required = true) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (required && !text) fail(english, `${label.ko} 적어줘.`, `${label.en} is required.`)
  if (text.length > max) fail(english, `${label.ko} ${max}자까지 적을 수 있어.`, `${label.en} holds at most ${max} characters.`)
  return text
}

function readSectionPath(value: unknown, english: boolean) {
  const raw = typeof value === 'string' ? value : ''
  const path = normalizeSkillSectionPath(raw)
  if (path) return path
  return fail(english,
    `섹션 경로 "${raw}"를 쓸 수 없어. 이름 하나나 "그룹/이름"으로, 글자·숫자로 시작해 글자·숫자·.·_·-만 써줘(${CHAT_SKILL_LIMITS.sectionPath}자까지).`,
    `Section path "${raw}" is invalid: one name, or "group/name", each starting with a letter or digit and using only letters, digits, ".", "_" or "-" (max ${CHAT_SKILL_LIMITS.sectionPath} characters).`)
}

function readSection(value: unknown, english: boolean): ChatSkillSectionFields {
  const raw = isRecord(value) ? value : {}
  const path = readSectionPath(raw.path, english)
  return {
    path,
    title: readText(raw.title, CHAT_SKILL_LIMITS.sectionTitle, { ko: `섹션 "${path}" 제목을`, en: `Section "${path}" title` }, english),
    summary: readText(raw.summary, CHAT_SKILL_LIMITS.sectionSummary, { ko: `섹션 "${path}" 목차 요약을`, en: `Section "${path}" summary` }, english, false),
    content: readText(raw.content, CHAT_SKILL_LIMITS.sectionContent, { ko: `섹션 "${path}" 내용을`, en: `Section "${path}" content` }, english),
  }
}

/** A skill's sections as they would be saved: each valid, the paths unique (without case), at most the limit. */
export function checkSkillSections(value: unknown, english = false): ChatSkillSectionFields[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) fail(english, '섹션 목록이 올바르지 않아.', 'sections must be a list.')
  if (value.length > CHAT_SKILL_LIMITS.sections) fail(english, `섹션은 ${CHAT_SKILL_LIMITS.sections}개까지 둘 수 있어.`, `A skill holds at most ${CHAT_SKILL_LIMITS.sections} sections.`)
  const keys = new Set<string>()
  return value.map((item) => {
    const section = readSection(item, english)
    const key = skillSectionPathKey(section.path)
    if (keys.has(key)) fail(english, `섹션 경로가 겹쳐: ${section.path}`, `Section path "${section.path}" is used twice.`)
    keys.add(key)
    return section
  })
}

/** Name, description, category and overview within their limits (the name not yet checked for being taken). */
function readSkillFields(input: ChatSkillInput, english: boolean): Omit<ChatSkillSnapshot, 'sections'> {
  return {
    name: readText(input.name, CHAT_SKILL_LIMITS.name, { ko: '스킬 이름을', en: 'name' }, english).replace(/\s+/g, ' '),
    description: readText(input.description, CHAT_SKILL_LIMITS.description, { ko: '언제 쓰는 스킬인지', en: 'description' }, english),
    category: readText(input.category, CHAT_SKILL_LIMITS.category, { ko: '분류를', en: 'category' }, english, false).replace(/\s+/g, ' '),
    instructions: readText(input.instructions, CHAT_SKILL_LIMITS.instructions, { ko: '스킬 개요를', en: 'instructions' }, english),
  }
}

/** A skill's fields and sections within their limits, without asking whether its name is taken (a plugin's skill is renamed instead). */
export function checkSkillSnapshot(input: ChatSkillInput): ChatSkillSnapshot {
  return { ...readSkillFields(input, false), sections: checkSkillSections(input.sections) }
}

/** Another skill with this name (case, width and spacing aside), ignoring `exceptId`. */
function skillNamedLike(name: string, exceptId: number | null) {
  const rows = getUserSettingsDb().prepare('SELECT id, name FROM chat_skills').all() as Array<{ id: number; name: string }>
  return rows.find((row) => row.id !== exceptId && skillNameKey(row.name) === skillNameKey(name))
}

/**
 * A skill as it would be saved: every field within its limit, the sections valid, the name unique (ignoring
 * `exceptId`, the skill being changed). `english`: the messages go to a chat model (propose_skill) instead of the editor.
 */
export function checkSkill(input: ChatSkillInput, exceptId: number | null, english = false): ChatSkillSnapshot {
  const fields = readSkillFields(input, english)
  const taken = skillNamedLike(fields.name, exceptId)
  if (taken) fail(english, `같은 이름의 스킬이 이미 있어: ${taken.name}`, `Skill name "${fields.name}" is taken by skill #${taken.id}; choose another name or change that skill (skill_id).`)
  return { ...fields, sections: checkSkillSections(input.sections, english) }
}

const sectionBody = (section: ChatSkillSectionFields): Omit<ChatSkillSectionFields, 'path'> => ({ title: section.title, summary: section.summary, content: section.content })
const sameBody = (a: Omit<ChatSkillSectionFields, 'path'>, b: unknown) => isRecord(b) && a.title === b.title && a.summary === b.summary && a.content === b.content

/**
 * `sections` after `changes` (see ChatSkillSectionChange), in order: an added section goes after the last one of its
 * group (else at the end). `stale` is called with the path of an update or removal whose `before` no longer matches.
 */
export function applySectionChanges(sections: ChatSkillSectionFields[], changes: unknown, stale: (path: string) => never, english = false): ChatSkillSectionFields[] {
  if (!Array.isArray(changes)) fail(english, '섹션 변경 목록이 올바르지 않아.', 'sectionChanges must be a list.')
  const next = sections.map((section) => ({ ...section }))
  const indexOf = (path: unknown) => {
    const key = skillSectionPathKey(readSectionPath(path, english))
    return next.findIndex((section) => skillSectionPathKey(section.path) === key)
  }
  for (const change of changes as unknown[]) {
    const raw = isRecord(change) ? change : {}
    if (raw.action === 'add') {
      const section = readSection(raw, english)
      // The change was made against sections without it: one added since makes the change stale.
      if (indexOf(section.path) >= 0) stale(section.path)
      const group = skillSectionGroup(section.path)
      const groupKey = group === null ? null : skillSectionPathKey(group)
      let last = -1
      if (groupKey !== null) next.forEach((item, index) => { const own = skillSectionGroup(item.path); if (own !== null && skillSectionPathKey(own) === groupKey) last = index })
      next.splice(last >= 0 ? last + 1 : next.length, 0, section)
    } else if (raw.action === 'update' || raw.action === 'remove') {
      const index = indexOf(raw.path)
      // Gone (renamed or removed since) or changed since: either way the change no longer fits.
      if (index < 0 || !sameBody(sectionBody(next[index]), raw.before)) stale(String(raw.path))
      if (raw.action === 'remove') { next.splice(index, 1); continue }
      const merged = readSection({
        path: raw.newPath === undefined ? next[index].path : raw.newPath,
        title: raw.title === undefined ? next[index].title : raw.title,
        summary: raw.summary === undefined ? next[index].summary : raw.summary,
        content: raw.content === undefined ? next[index].content : raw.content,
      }, english)
      const clash = indexOf(merged.path)
      // Like an add: a path taken since the change was made makes it stale.
      if (clash >= 0 && clash !== index) stale(merged.path)
      next[index] = merged
    } else {
      fail(english, '섹션 변경의 action은 add, update, remove 중 하나여야 해.', 'Each section change needs action "add", "update" or "remove".')
    }
  }
  if (next.length > CHAT_SKILL_LIMITS.sections) fail(english, `섹션은 ${CHAT_SKILL_LIMITS.sections}개까지 둘 수 있어.`, `A skill holds at most ${CHAT_SKILL_LIMITS.sections} sections.`)
  return next
}

// ------------------------------------------------------------------ storage

function linkedProfiles() {
  const rows = getUserSettingsDb().prepare(`SELECT id, name, skill_ids FROM llm_chat_profiles WHERE skill_ids IS NOT NULL AND skill_ids != '[]' ORDER BY ${chatProfileOrderSql()}`).all() as Array<{ id: number; name: string; skill_ids: string }>
  return rows.map((row) => ({ id: row.id, name: row.name, skillIds: normalizeSkillIds(row.skill_ids) }))
}

function baseOf(row: Omit<SkillRow, 'instructions'>, profiles: ReturnType<typeof linkedProfiles>): ChatSkillBase {
  const source: ChatSkillSource = row.source === 'plugin' || row.source === 'import' ? row.source : 'user'
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    source,
    pluginId: source === 'plugin' && row.source_ref ? row.source_ref.slice(0, row.source_ref.indexOf('/')) : null,
    enabled: row.enabled === 1,
    revision: row.revision,
    loadCount: row.load_count,
    lastLoadedAt: row.last_loaded_at,
    profiles: profiles.filter((profile) => profile.skillIds.includes(row.id)).map(({ id, name }) => ({ id, name })),
    createdDate: row.created_date,
    updatedDate: row.updated_date,
  }
}

function sectionsOf(skillId: number): ChatSkillSection[] {
  const rows = getUserSettingsDb().prepare('SELECT * FROM chat_skill_sections WHERE skill_id = ? ORDER BY position, id').all(skillId) as SectionRow[]
  return rows.map((row) => ({ path: row.path, title: row.title, summary: row.summary, content: row.content, loadCount: row.load_count, lastLoadedAt: row.last_loaded_at, updatedDate: row.updated_date }))
}

const snapshotOf = (skill: ChatSkill): ChatSkillSnapshot => ({
  name: skill.name,
  description: skill.description,
  category: skill.category,
  instructions: skill.instructions,
  sections: skill.sections.map(({ path, title, summary, content }) => ({ path, title, summary, content })),
})

/** Words of a library search, each as a LIKE pattern. */
function likePatterns(query: string) {
  return [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))].map((word) => `%${word.replace(/[\\%_]/g, (char) => `\\${char}`)}%`)
}

/**
 * The sections a save leaves, by path (case aside): an unchanged section keeps its row, so its load counts and date
 * stay; a renamed one starts over as a new row.
 */
function writeSections(skillId: number, sections: ChatSkillSectionFields[]) {
  const db = getUserSettingsDb()
  const stored = new Map((db.prepare('SELECT id, path_key, path, title, summary, content, position FROM chat_skill_sections WHERE skill_id = ?').all(skillId) as Array<{ id: number; path_key: string; path: string; title: string; summary: string; content: string; position: number }>)
    .map((row) => [row.path_key, row]))
  const keys = new Set(sections.map((section) => skillSectionPathKey(section.path)))
  const remove = db.prepare('DELETE FROM chat_skill_sections WHERE id = ?')
  for (const [key, row] of stored) if (!keys.has(key)) remove.run(row.id)
  const insert = db.prepare('INSERT INTO chat_skill_sections (skill_id, path, path_key, title, summary, content, tokens, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  const change = db.prepare('UPDATE chat_skill_sections SET path = ?, title = ?, summary = ?, content = ?, tokens = ?, position = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?')
  const move = db.prepare('UPDATE chat_skill_sections SET position = ? WHERE id = ?')
  sections.forEach((section, position) => {
    const row = stored.get(skillSectionPathKey(section.path))
    if (!row) insert.run(skillId, section.path, skillSectionPathKey(section.path), section.title, section.summary, section.content, rawTokenEstimate(section.content), position)
    else if (row.path !== section.path || row.title !== section.title || row.summary !== section.summary || row.content !== section.content) change.run(section.path, section.title, section.summary, section.content, rawTokenEstimate(section.content), position, row.id)
    else if (row.position !== position) move.run(position, row.id)
  })
}

const sameSnapshot = (a: ChatSkillSnapshot, b: ChatSkillSnapshot) => JSON.stringify(a) === JSON.stringify(b)

/** Unlinks `skillIds` from every profile and deletes them (their sections and versions go with them). */
function deleteSkills(skillIds: number[]) {
  if (skillIds.length === 0) return 0
  const db = getUserSettingsDb()
  return db.transaction(() => {
    const gone = new Set(skillIds)
    const unlink = db.prepare('UPDATE llm_chat_profiles SET skill_ids = ? WHERE id = ?')
    for (const profile of linkedProfiles()) {
      if (profile.skillIds.some((id) => gone.has(id))) unlink.run(JSON.stringify(profile.skillIds.filter((id) => !gone.has(id))), profile.id)
    }
    return db.prepare(`DELETE FROM chat_skills WHERE id IN (${skillIds.map(() => '?').join(', ')})`).run(...skillIds).changes
  })()
}

/** A name no other skill has: `name`, else `name · mark`, numbered when that is taken too. */
export function uniqueSkillName(name: string, mark: string, exceptId: number | null) {
  if (!skillNamedLike(name, exceptId)) return name
  const marked = `${name} · ${mark}`.slice(0, CHAT_SKILL_LIMITS.name)
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? marked : `${marked.slice(0, CHAT_SKILL_LIMITS.name - String(n).length - 1)} ${n}`
    if (!skillNamedLike(candidate, exceptId)) return candidate
  }
}

export const ChatSkillStore = {
  /** The library, optionally narrowed to skills whose name, description, category or a section's path, title or summary holds every word of `query`. */
  list(query?: string): ChatSkillSummary[] {
    const db = getUserSettingsDb()
    const patterns = query ? likePatterns(query) : []
    const where = patterns.map(() => `(lower(name) LIKE ? ESCAPE '\\' OR lower(description) LIKE ? ESCAPE '\\' OR lower(category) LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM chat_skill_sections s WHERE s.skill_id = chat_skills.id AND (lower(s.path) LIKE ? ESCAPE '\\' OR lower(s.title) LIKE ? ESCAPE '\\' OR lower(s.summary) LIKE ? ESCAPE '\\')))`)
    const rows = db.prepare(`SELECT id, name, description, category, source, source_ref, enabled, revision, load_count, last_loaded_at, created_date, updated_date,
      length(instructions) AS instructions_length FROM chat_skills ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name COLLATE NOCASE ASC, id ASC`)
      .all(...patterns.flatMap((pattern) => Array(6).fill(pattern))) as Array<Omit<SkillRow, 'instructions'> & { instructions_length: number }>
    const sections = new Map<number, ChatSkillSummary['sections']>()
    const sectionRows = db.prepare('SELECT skill_id, path, title, summary, length(content) AS length, load_count, last_loaded_at FROM chat_skill_sections ORDER BY skill_id, position, id').all() as Array<{ skill_id: number; path: string; title: string; summary: string; length: number; load_count: number; last_loaded_at: string | null }>
    for (const row of sectionRows) {
      const list = sections.get(row.skill_id) ?? []
      list.push({ path: row.path, title: row.title, summary: row.summary, length: row.length, loadCount: row.load_count, lastLoadedAt: row.last_loaded_at })
      sections.set(row.skill_id, list)
    }
    const profiles = linkedProfiles()
    return rows.map((row) => ({ ...baseOf(row, profiles), instructionsLength: row.instructions_length, sections: sections.get(row.id) ?? [] }))
  },

  find(skillId: number): ChatSkill | null {
    const row = getUserSettingsDb().prepare('SELECT * FROM chat_skills WHERE id = ?').get(skillId) as SkillRow | undefined
    return row ? { ...baseOf(row, linkedProfiles()), instructions: row.instructions, sections: sectionsOf(skillId) } : null
  },

  /** What use_skill reads first: the overview and the table of contents, without the sections' texts. */
  outline(skillId: number) {
    const db = getUserSettingsDb()
    const row = db.prepare('SELECT id, name, instructions FROM chat_skills WHERE id = ?').get(skillId) as { id: number; name: string; instructions: string } | undefined
    if (!row) return null
    const contents = db.prepare('SELECT path, title, summary, tokens FROM chat_skill_sections WHERE skill_id = ? ORDER BY position, id').all(skillId) as ContentsEntry[]
    return { ...row, contents }
  },

  /** These sections of a skill, by saved path, in the order given (a path it lacks is left out). */
  sectionTexts(skillId: number, paths: string[]): ChatSkillSectionFields[] {
    const read = getUserSettingsDb().prepare('SELECT path, title, summary, content FROM chat_skill_sections WHERE skill_id = ? AND path_key = ?')
    return paths.flatMap((path) => { const row = read.get(skillId, skillSectionPathKey(path)) as ChatSkillSectionFields | undefined; return row ? [row] : [] })
  },

  /** Ids of these that still exist, in the given order. */
  existing(ids: number[]) {
    if (ids.length === 0) return []
    const found = new Set((getUserSettingsDb().prepare(`SELECT id FROM chat_skills WHERE id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as Array<{ id: number }>).map((row) => row.id))
    return ids.filter((id) => found.has(id))
  },

  /** Names by id (any state), for showing links. */
  names(ids: number[]) {
    if (ids.length === 0) return new Map<number, string>()
    const rows = getUserSettingsDb().prepare(`SELECT id, name FROM chat_skills WHERE id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as Array<{ id: number; name: string }>
    return new Map(rows.map((row) => [row.id, row.name]))
  },

  /** The skills a profile may use (linked and not switched off with their plugin), in link order, without the texts. */
  linked(ids: number[]): Array<{ id: number; name: string; description: string }> {
    if (ids.length === 0) return []
    const rows = getUserSettingsDb().prepare(`SELECT id, name, description FROM chat_skills WHERE enabled = 1 AND id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as Array<{ id: number; name: string; description: string }>
    const byId = new Map(rows.map((row) => [row.id, row]))
    return ids.flatMap((id) => byId.get(id) ?? [])
  },

  create(input: ChatSkillInput, source: 'user' | 'import' = 'user') {
    const snapshot = checkSkill(input, null)
    const db = getUserSettingsDb()
    const id = db.transaction(() => {
      const result = db.prepare('INSERT INTO chat_skills (name, description, category, instructions, source) VALUES (?, ?, ?, ?, ?)').run(snapshot.name, snapshot.description, snapshot.category, snapshot.instructions, source)
      const skillId = Number(result.lastInsertRowid)
      writeSections(skillId, snapshot.sections)
      return skillId
    })()
    notifySemanticChange('skill')
    return ChatSkillStore.find(id) as ChatSkill
  },

  /**
   * A field left out keeps its value. `sections` replaces the whole list; `sectionChanges` edits it (a proposal), and
   * an edit whose section changed since is refused like a stale `revision`. Saving keeps the replaced state as a version.
   */
  update(skillId: number, patch: ChatSkillPatch, options: { revision?: number } = {}) {
    const current = ChatSkillStore.find(skillId)
    if (!current) return null
    if (current.source === 'plugin') fail(false, '플러그인 스킬은 플러그인 패키지에서만 바뀌어.', 'A plugin skill changes only with its plugin.')
    if (options.revision !== undefined && options.revision !== current.revision) throw new ChatRevisionConflict(current)
    if (patch.sections !== undefined && patch.sectionChanges !== undefined) fail(false, '섹션 전체와 섹션 변경은 함께 보낼 수 없어.', 'Send sections or sectionChanges, not both.')
    const sections = patch.sectionChanges !== undefined
      ? applySectionChanges(snapshotOf(current).sections, patch.sectionChanges, () => { throw new ChatRevisionConflict(current) })
      : patch.sections === undefined ? snapshotOf(current).sections : patch.sections
    const next = checkSkill({
      name: patch.name === undefined ? current.name : patch.name,
      description: patch.description === undefined ? current.description : patch.description,
      category: patch.category === undefined ? current.category : patch.category,
      instructions: patch.instructions === undefined ? current.instructions : patch.instructions,
      sections,
    }, skillId)
    return saveSnapshot(current, next)
  },

  /** Also unlinks the skill from every profile. A plugin's skill goes only with its plugin. */
  delete(skillId: number) {
    const current = ChatSkillStore.find(skillId)
    if (current?.source === 'plugin') fail(false, '플러그인 스킬은 플러그인을 지우면 함께 지워져.', 'A plugin skill goes when its plugin is removed.')
    const deleted = deleteSkills([skillId]) > 0
    if (deleted) notifySemanticChange('skill')
    return deleted
  },

  /** The earlier revisions kept, newest first; null for an unknown skill. */
  versions(skillId: number) {
    const current = getUserSettingsDb().prepare('SELECT revision FROM chat_skills WHERE id = ?').get(skillId) as { revision: number } | undefined
    if (!current) return null
    const rows = getUserSettingsDb().prepare('SELECT revision, saved_date, name, section_count FROM chat_skill_versions WHERE skill_id = ? ORDER BY revision DESC')
      .all(skillId) as Array<{ revision: number; saved_date: string; name: string; section_count: number }>
    return { current: current.revision, versions: rows.map((row) => ({ revision: row.revision, savedDate: row.saved_date, name: row.name, sectionCount: row.section_count })) }
  },

  version(skillId: number, revision: number) {
    const row = getUserSettingsDb().prepare('SELECT revision, saved_date, snapshot FROM chat_skill_versions WHERE skill_id = ? AND revision = ?').get(skillId, revision) as { revision: number; saved_date: string; snapshot: string } | undefined
    return row ? { revision: row.revision, savedDate: row.saved_date, snapshot: JSON.parse(row.snapshot) as ChatSkillSnapshot } : null
  },

  /** Saves the state of revision `from` as a new revision (null: no such skill or version). */
  restore(skillId: number, from: number, options: { revision?: number } = {}) {
    const version = ChatSkillStore.version(skillId, from)
    if (!version) return null
    return ChatSkillStore.update(skillId, version.snapshot, options)
  },

  /** A use_skill load: of the overview (no paths) or of these sections. */
  recordLoad(skillId: number, paths: string[]) {
    const db = getUserSettingsDb()
    if (paths.length === 0) {
      db.prepare('UPDATE chat_skills SET load_count = load_count + 1, last_loaded_at = CURRENT_TIMESTAMP WHERE id = ?').run(skillId)
      return
    }
    const bump = db.prepare('UPDATE chat_skill_sections SET load_count = load_count + 1, last_loaded_at = CURRENT_TIMESTAMP WHERE skill_id = ? AND path_key = ?')
    db.transaction(() => { for (const path of paths) bump.run(skillId, skillSectionPathKey(path)) })()
  },

  /** Plugins that have skills stored. */
  pluginIds(): string[] {
    const rows = getUserSettingsDb().prepare("SELECT DISTINCT substr(source_ref, 1, instr(source_ref, '/') - 1) AS plugin_id FROM chat_skills WHERE source = 'plugin' AND source_ref IS NOT NULL").all() as Array<{ plugin_id: string }>
    return rows.map((row) => row.plugin_id)
  },

  /** Turns off every skill of a plugin that cannot be read now, keeping them and their links. */
  pluginOff(pluginId: string) {
    const prefix = `${pluginId}/`
    const changed = getUserSettingsDb().prepare("UPDATE chat_skills SET enabled = 0 WHERE source = 'plugin' AND substr(source_ref, 1, ?) = ? AND enabled = 1").run(prefix.length, prefix).changes
    if (changed) notifySemanticChange('skill')
  },

  /**
   * Brings a plugin's skills in line with its package: `skills` null removes them all (the plugin is gone), else each
   * folder's skill is added or replaced (no history: the package is the source) and the ones the package no longer
   * names go. `enabled` false keeps them (and the profiles' links) but out of use; `unreadable` folders keep their
   * skills, off, until the package reads again. A clashing name is marked with the plugin.
   */
  syncPlugin(pluginId: string, skills: Array<{ folder: string; snapshot: ChatSkillSnapshot }> | null, enabled: boolean, unreadable: string[] = []) {
    const db = getUserSettingsDb()
    const prefix = `${pluginId}/`
    const stored = (db.prepare("SELECT id, source_ref FROM chat_skills WHERE source = 'plugin' AND substr(source_ref, 1, ?) = ?").all(prefix.length, prefix) as Array<{ id: number; source_ref: string }>)
    if (skills === null) {
      const deleted = deleteSkills(stored.map((row) => row.id))
      if (deleted) notifySemanticChange('skill')
      return deleted
    }
    const byRef = new Map(stored.map((row) => [row.source_ref, row.id]))
    const off = new Set(unreadable.map((folder) => `${prefix}${folder}`))
    const keep = new Set([...skills.map((skill) => `${prefix}${skill.folder}`), ...off])
    deleteSkills(stored.filter((row) => !keep.has(row.source_ref)).map((row) => row.id))
    const turnOff = db.prepare('UPDATE chat_skills SET enabled = 0 WHERE id = ?')
    db.transaction(() => {
      for (const row of stored) if (off.has(row.source_ref)) turnOff.run(row.id)
      for (const { folder, snapshot } of skills) {
        const ref = `${prefix}${folder}`
        const id = byRef.get(ref) ?? null
        const name = uniqueSkillName(snapshot.name, pluginId, id)
        let skillId = id
        if (skillId === null) {
          skillId = Number(db.prepare("INSERT INTO chat_skills (name, description, category, instructions, source, source_ref, enabled) VALUES (?, ?, ?, ?, 'plugin', ?, ?)")
            .run(name, snapshot.description, snapshot.category, snapshot.instructions, ref, enabled ? 1 : 0).lastInsertRowid)
        } else {
          const current = ChatSkillStore.find(skillId) as ChatSkill
          if (!sameSnapshot(snapshotOf(current), { ...snapshot, name })) {
            db.prepare('UPDATE chat_skills SET name = ?, description = ?, category = ?, instructions = ?, revision = revision + 1, updated_date = CURRENT_TIMESTAMP WHERE id = ?')
              .run(name, snapshot.description, snapshot.category, snapshot.instructions, skillId)
          }
          db.prepare('UPDATE chat_skills SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, skillId)
        }
        writeSections(skillId, snapshot.sections)
      }
    })()
    notifySemanticChange('skill')
    return skills.length
  },
}

/**
 * A skill section used as a generation preset's writing guide: `path` is a section, or `group/` for a group's
 * sections in order. Names are null once the skill or the section is gone; `text` is null as well while the skill's
 * plugin is off.
 */
export function skillGuide(skillId: number, path: string) {
  const db = getUserSettingsDb()
  const skill = db.prepare('SELECT name, enabled FROM chat_skills WHERE id = ?').get(skillId) as { name: string; enabled: number } | undefined
  if (!skill) return { skillName: null, title: null, updatedDate: null, text: null }
  const group = path.endsWith('/') ? skillSectionPathKey(path.slice(0, -1)) : null
  const rows = (group === null
    ? db.prepare('SELECT path, title, content, updated_date FROM chat_skill_sections WHERE skill_id = ? AND path_key = ?').all(skillId, skillSectionPathKey(path))
    : db.prepare('SELECT path, title, content, updated_date FROM chat_skill_sections WHERE skill_id = ? AND substr(path_key, 1, ?) = ? ORDER BY position, id').all(skillId, group.length + 1, `${group}/`)) as Array<{ path: string; title: string; content: string; updated_date: string }>
  if (rows.length === 0) return { skillName: skill.name, title: null, updatedDate: null, text: null }
  return {
    skillName: skill.name,
    title: group === null ? rows[0].title : `${path} (${rows.length})`,
    updatedDate: rows.reduce((latest, row) => (row.updated_date > latest ? row.updated_date : latest), rows[0].updated_date),
    text: skill.enabled === 1 ? (group === null ? rows[0].content : skillSectionsText(rows.map((row) => ({ ...row, summary: '' })))) : null,
  }
}

/** Saves `next` over `current` (nothing when they match), keeping `current` as a version and the newest ones only. */
function saveSnapshot(current: ChatSkill, next: ChatSkillSnapshot) {
  if (sameSnapshot(snapshotOf(current), next)) return current
  const db = getUserSettingsDb()
  db.transaction(() => {
    db.prepare('INSERT OR REPLACE INTO chat_skill_versions (skill_id, revision, name, section_count, snapshot, saved_date) VALUES (?, ?, ?, ?, ?, ?)')
      .run(current.id, current.revision, current.name, current.sections.length, JSON.stringify(snapshotOf(current)), current.updatedDate)
    db.prepare('DELETE FROM chat_skill_versions WHERE skill_id = ? AND revision NOT IN (SELECT revision FROM chat_skill_versions WHERE skill_id = ? ORDER BY revision DESC LIMIT ?)').run(current.id, current.id, CHAT_SKILL_VERSIONS_KEPT)
    db.prepare('UPDATE chat_skills SET name = ?, description = ?, category = ?, instructions = ?, revision = revision + 1, updated_date = CURRENT_TIMESTAMP WHERE id = ?')
      .run(next.name, next.description, next.category, next.instructions, current.id)
    writeSections(current.id, next.sections)
  })()
  notifySemanticChange('skill')
  return ChatSkillStore.find(current.id) as ChatSkill
}

// ------------------------------------------------------------------ what the chat model sees

/**
 * `## Skills` for the system prompt: how to use them, then one `- name: when to use it` line per usable linked skill.
 * It changes only when a skill or the profile's links do. '' without skills, and only beside the use_skill tool.
 */
export function profileSkillIndex(profile: { skillIds: number[] }) {
  const skills = ChatSkillStore.linked(profile.skillIds)
  if (skills.length === 0) return ''
  return [
    '## Skills',
    `Skills are task instructions written by the administrator. When the user's request matches what a skill below is for, first call ${USE_SKILL_TOOL} with that skill's name: it returns the skill's overview and, when the skill has sections, their table of contents. Then load only the sections the request needs (${USE_SKILL_TOOL} with section) and follow what you loaded while you handle the request. Never guess what a skill says, and do not load one the request does not need. Load it again in every reply that needs it: instructions loaded in an earlier reply may no longer be in front of you.`,
    ...skills.map(skillIndexLine),
  ].join('\n')
}

/** One skill's line in the system prompt's skill list. */
export function skillIndexLine(skill: { name: string; description: string }) {
  return `- ${skill.name}: ${skill.description.replace(/\s+/g, ' ')}`
}

/**
 * One line for the end of a request, where small models look most, naming the skills and the rule to load one that
 * fits; it goes beside the skill list, so '' without skills.
 */
export function skillReminderText(profile: { skillIds: number[] }) {
  const names = ChatSkillStore.linked(profile.skillIds).map((skill) => `"${skill.name}"`)
  return names.length ? `If this request matches one of your skills (${names.join(', ')}), call ${USE_SKILL_TOOL} with that name first and follow what it returns.` : ''
}

/** How a use_skill call reads in a later request's replayed history (its result is not kept). */
export function skillCallLabel(args: { name?: unknown; section?: unknown; query?: unknown }) {
  const name = typeof args.name === 'string' ? args.name.trim() : ''
  const section = typeof args.section === 'string' ? args.section.trim() : ''
  if (typeof args.query === 'string' && args.query.trim()) return `A search of ${name ? `skill "${name}"` : 'your skills'} for "${args.query.trim()}"`
  return section ? `Skill "${name}" (section ${section})` : `Skill "${name}"`
}

/**
 * The part of `text` from `offset` that fits in `room` characters (at least 100), never splitting a surrogate pair;
 * `more` when text is left after it. A tool result cut by the output limit would otherwise drop the end silently.
 */
export function skillChunk(text: string, offset: number, room: number) {
  const start = Math.min(offset, text.length)
  let end = Math.min(text.length, start + Math.max(100, room))
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1] ?? '')) end -= 1
  return { start, end, text: text.slice(start, end), more: end < text.length }
}

export type ContentsEntry = Pick<ChatSkillSectionFields, 'path' | 'title' | 'summary'> & { tokens: number }

export const contentsEntries = (sections: ChatSkillSectionFields[]): ContentsEntry[] =>
  sections.map((section) => ({ path: section.path, title: section.title, summary: section.summary, tokens: rawTokenEstimate(section.content) }))

const contentsLine = (entry: ContentsEntry) => `- ${entry.path} — ${entry.title}${entry.summary ? `: ${entry.summary.replace(/\s+/g, ' ')}` : ''} (~${entry.tokens} tokens)`

/**
 * The table of contents under a skill's overview: one line per section (path, title, when to read it, rough size).
 * When that is longer than `room`, each group folds into one line naming its sections; `group` lists one group alone
 * (use_skill section "group/"). '' when there is nothing to list.
 */
export function skillContents(name: string, entries: ContentsEntry[], room: number, group?: string): string {
  const how = `Load only what the request needs: ${USE_SKILL_TOOL} with name "${name}" and section "<path>" (several paths separated by commas load together).`
  if (group !== undefined) {
    const key = skillSectionPathKey(group)
    const listed = entries.filter((entry) => { const own = skillSectionGroup(entry.path); return own !== null && skillSectionPathKey(own) === key })
    return listed.length ? [`## Sections in "${group}/"`, how, ...listed.map(contentsLine)].join('\n') : ''
  }
  if (entries.length === 0) return ''
  const full = ['## Sections', how, ...entries.map(contentsLine)].join('\n')
  if (full.length <= room) return full
  const order: Array<ContentsEntry | string> = []
  const groups = new Map<string, ContentsEntry[]>()
  for (const entry of entries) {
    const own = skillSectionGroup(entry.path)
    if (own === null) { order.push(entry); continue }
    const key = skillSectionPathKey(own)
    if (!groups.has(key)) { groups.set(key, []); order.push(own) }
    groups.get(key)!.push(entry)
  }
  const lines = order.map((item) => {
    if (typeof item !== 'string') return contentsLine(item)
    const members = groups.get(skillSectionPathKey(item))!
    return `- ${item}/ — ${members.length} sections: ${members.map((entry) => entry.title).join('; ')} (section "${item}/" lists them)`
  })
  return ['## Sections', how, ...lines].join('\n')
}

/** What use_skill returns first, uncut: the overview, then the table of contents (folded past half the output limit). */
export function skillOverviewText(name: string, instructions: string, entries: ContentsEntry[], outputLimit: number) {
  const contents = skillContents(name, entries, Math.floor(outputLimit / 2))
  return contents ? `${instructions}\n\n${contents}` : instructions
}

/** Sections as use_skill returns them, each under its title and path. */
export function skillSectionsText(sections: ChatSkillSectionFields[]) {
  return sections.map((section) => `### ${section.title} (${section.path})\n\n${section.content}`).join('\n\n')
}

/**
 * What use_skill returns: `body` (the overview, sections or a group's contents, already rendered) from `offset`, one
 * part that fits `outputLimit` characters; `section` is what the call asked for, for the header and the continuation.
 */
export function skillResultText(skill: Pick<ChatSkill, 'name'>, body: string, offset: number, outputLimit: number, section?: string) {
  const start = Math.min(offset, body.length)
  const what = section ? `Skill "${skill.name}", section ${section}` : `Skill "${skill.name}"`
  const full = start > 0
    ? `${what}, continued from offset ${start}.`
    : section
      ? `${what}: part of the administrator's instructions for this kind of request. Follow it together with the skill's overview and your character's own instructions.`
      : `${what}: the administrator's instructions for this kind of request. Follow them for the current request, together with your character's own instructions.`
  const more = (end: number) => `\n\n(The skill continues. Call ${USE_SKILL_TOOL} with name "${skill.name}"${section ? `, section "${section}"` : ''} and offset ${end} for the rest before you act on it.)`
  // The frame is measured (the continuation with the largest offset), so the whole result fits and the offset survives;
  // a small output limit gets the short header so the part keeps its room.
  const room = (header: string) => outputLimit - header.length - 2 - more(body.length).length
  const header = room(full) >= 100 ? full : `Skill "${skill.name}"${start > 0 ? `, from offset ${start}` : ''}:`
  const chunk = skillChunk(body, start, room(header))
  return `${header}\n\n${chunk.text}${chunk.more ? more(chunk.end) : ''}`
}

/**
 * What the chat model would see of a draft (the editor's preview): its line in the skill list, the first use_skill
 * result and each section's, with rough token counts, and hints that never block a save.
 */
export function previewSkill(input: ChatSkillInput, exceptId: number | null) {
  const skill = checkSkill(input, exceptId)
  const limit = CHAT_PROFILE_DEFAULTS.toolOutputLimit
  const index = skillIndexLine(skill)
  const overviewBody = skillOverviewText(skill.name, skill.instructions, contentsEntries(skill.sections), limit)
  const overview = skillResultText(skill, overviewBody, 0, Number.MAX_SAFE_INTEGER)
  const sections = skill.sections.map((section) => ({ path: section.path, text: skillResultText(skill, skillSectionsText([section]), 0, Number.MAX_SAFE_INTEGER, section.path) }))
  const warnings: string[] = []
  const overviewTokens = rawTokenEstimate(overview)
  // Agent Skills' guidance: an activated skill's main text stays under about 5,000 tokens; the rest goes to references.
  if (overviewTokens > 5000) warnings.push(`개요가 약 ${overviewTokens}토큰이야. 5,000토큰 아래가 좋아. 세부 내용은 섹션으로 옮겨줘.`)
  const entries = contentsEntries(skill.sections)
  if (entries.length > 0 && !overviewBody.endsWith(skillContents(skill.name, entries, Number.MAX_SAFE_INTEGER))) warnings.push('섹션 목록이 길어서 모델에게는 그룹 단위로 접혀 보여.')
  const titles = new Map<string, string>()
  for (const section of skill.sections) {
    if (!section.summary) warnings.push(`섹션 "${section.path}"에 목차 요약이 없어. 모델이 언제 읽을지 고르기 어려워.`)
    const key = section.title.toLowerCase()
    if (titles.has(key)) warnings.push(`섹션 "${titles.get(key)}"와 "${section.path}"의 제목이 같아.`)
    else titles.set(key, section.path)
  }
  return {
    index,
    overview,
    sections,
    tokens: { index: rawTokenEstimate(index), overview: overviewTokens, sections: Object.fromEntries(sections.map((section) => [section.path, rawTokenEstimate(section.text)])) },
    warnings,
  }
}
