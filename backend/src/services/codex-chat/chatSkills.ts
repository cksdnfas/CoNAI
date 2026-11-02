import { CHAT_SKILL_LIMITS } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { chatProfileOrderSql } from './chatProfileOrder'
import { ChatProfileError } from './chatProfileError'

/**
 * Shared skills: instructions for one kind of task, kept on their own so profiles link them by id the way they link
 * display blocks. A request's system prompt lists only each linked skill's name and when to use it; the model loads
 * the instructions with use_skill when a request fits. Only administrators write them (the editor, or a propose_skill
 * card), never the shared file store, so whoever may edit files cannot change a profile's instructions.
 */
export type ChatSkill = {
  id: number
  name: string
  /** When the skill applies: the chat model chooses by this alone. */
  description: string
  instructions: string
  /** Profiles that link this skill. */
  profiles: Array<{ id: number; name: string }>
  createdDate: string
  updatedDate: string
}

export type ChatSkillFields = Pick<ChatSkill, 'name' | 'description' | 'instructions'>
export type ChatSkillInput = { name?: unknown; description?: unknown; instructions?: unknown }

export const USE_SKILL_TOOL = 'use_skill'

type SkillRow = { id: number; name: string; description: string; instructions: string; created_date: string; updated_date: string }

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

/**
 * A skill as it would be saved: every field filled and within its limit, the name unique (ignoring `exceptId`, the
 * skill being changed). `english`: the messages go to a chat model (propose_skill) instead of the editor.
 */
export function checkSkillFields(input: ChatSkillInput, exceptId: number | null, english = false): ChatSkillFields {
  const fail = (ko: string, en: string): never => { throw new ChatProfileError(english ? en : ko) }
  const read = (value: unknown, max: number, label: { ko: string; en: string }) => {
    const text = typeof value === 'string' ? value.trim() : ''
    if (!text) fail(`${label.ko} 적어줘.`, `${label.en} is required.`)
    if (text.length > max) fail(`${label.ko} ${max}자까지 적을 수 있어.`, `${label.en} holds at most ${max} characters.`)
    return text
  }
  const name = read(input.name, CHAT_SKILL_LIMITS.name, { ko: '스킬 이름을', en: 'name' }).replace(/\s+/g, ' ')
  const description = read(input.description, CHAT_SKILL_LIMITS.description, { ko: '언제 쓰는 스킬인지', en: 'description' })
  const instructions = read(input.instructions, CHAT_SKILL_LIMITS.instructions, { ko: '스킬 지시를', en: 'instructions' })
  const rows = getUserSettingsDb().prepare('SELECT id, name FROM chat_skills').all() as Array<{ id: number; name: string }>
  const taken = rows.find((row) => row.id !== exceptId && skillNameKey(row.name) === skillNameKey(name))
  if (taken) fail(`같은 이름의 스킬이 이미 있어: ${taken.name}`, `Skill name "${name}" is taken by skill #${taken.id}; choose another name or change that skill (skill_id).`)
  return { name, description, instructions }
}

function linkedProfiles() {
  const rows = getUserSettingsDb().prepare(`SELECT id, name, skill_ids FROM llm_chat_profiles WHERE skill_ids IS NOT NULL AND skill_ids != '[]' ORDER BY ${chatProfileOrderSql()}`).all() as Array<{ id: number; name: string; skill_ids: string }>
  return rows.map((row) => ({ id: row.id, name: row.name, skillIds: normalizeSkillIds(row.skill_ids) }))
}

function toSkill(row: SkillRow, profiles: ReturnType<typeof linkedProfiles>): ChatSkill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    profiles: profiles.filter((profile) => profile.skillIds.includes(row.id)).map(({ id, name }) => ({ id, name })),
    createdDate: row.created_date,
    updatedDate: row.updated_date,
  }
}

export const ChatSkillStore = {
  list() {
    const rows = getUserSettingsDb().prepare('SELECT * FROM chat_skills ORDER BY name COLLATE NOCASE ASC, id ASC').all() as SkillRow[]
    const profiles = linkedProfiles()
    return rows.map((row) => toSkill(row, profiles))
  },

  find(skillId: number) {
    const row = getUserSettingsDb().prepare('SELECT * FROM chat_skills WHERE id = ?').get(skillId) as SkillRow | undefined
    return row ? toSkill(row, linkedProfiles()) : null
  },

  /** Ids of these that still exist, in the given order. */
  existing(ids: number[]) {
    if (ids.length === 0) return []
    const found = new Set((getUserSettingsDb().prepare(`SELECT id FROM chat_skills WHERE id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as Array<{ id: number }>).map((row) => row.id))
    return ids.filter((id) => found.has(id))
  },

  /** The skills a profile links, in link order (a missing one is skipped), without the linked-profile scan. */
  skillsOf(ids: number[]): Array<ChatSkillFields & { id: number }> {
    if (ids.length === 0) return []
    const rows = getUserSettingsDb().prepare(`SELECT id, name, description, instructions FROM chat_skills WHERE id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as Array<ChatSkillFields & { id: number }>
    const byId = new Map(rows.map((row) => [row.id, row]))
    return ids.flatMap((id) => byId.get(id) ?? [])
  },

  create(input: ChatSkillInput) {
    const fields = checkSkillFields(input, null)
    const result = getUserSettingsDb().prepare('INSERT INTO chat_skills (name, description, instructions) VALUES (@name, @description, @instructions)').run(fields)
    return ChatSkillStore.find(Number(result.lastInsertRowid)) as ChatSkill
  },

  /** A field left out keeps its value. */
  update(skillId: number, patch: ChatSkillInput) {
    const current = ChatSkillStore.find(skillId)
    if (!current) return null
    const fields = checkSkillFields({
      name: patch.name === undefined ? current.name : patch.name,
      description: patch.description === undefined ? current.description : patch.description,
      instructions: patch.instructions === undefined ? current.instructions : patch.instructions,
    }, skillId)
    getUserSettingsDb().prepare('UPDATE chat_skills SET name = @name, description = @description, instructions = @instructions, updated_date = CURRENT_TIMESTAMP WHERE id = @id').run({ ...fields, id: skillId })
    return ChatSkillStore.find(skillId)
  },

  /** Also unlinks the skill from every profile. */
  delete(skillId: number) {
    const db = getUserSettingsDb()
    return db.transaction(() => {
      const unlink = db.prepare('UPDATE llm_chat_profiles SET skill_ids = ? WHERE id = ?')
      for (const profile of linkedProfiles()) {
        if (profile.skillIds.includes(skillId)) unlink.run(JSON.stringify(profile.skillIds.filter((id) => id !== skillId)), profile.id)
      }
      return db.prepare('DELETE FROM chat_skills WHERE id = ?').run(skillId).changes > 0
    })()
  },
}

/**
 * `## Skills` for the system prompt: how to use them, then one `- name: when to use it` line per linked skill. It
 * changes only when a skill or the profile's links do. '' without skills, and only beside the use_skill tool.
 */
export function profileSkillIndex(profile: { skillIds: number[] }) {
  const skills = ChatSkillStore.skillsOf(profile.skillIds)
  if (skills.length === 0) return ''
  return [
    '## Skills',
    `Skills are task instructions written by the administrator. When the user's request matches what a skill below is for, first call ${USE_SKILL_TOOL} with that skill's name, then follow the instructions it returns while you handle the request. Never guess what a skill says, and do not load one the request does not need.`,
    ...skills.map((skill) => `- ${skill.name}: ${skill.description.replace(/\s+/g, ' ')}`),
  ].join('\n')
}

/** Room a use_skill result keeps for its header and continuation line within the profile's tool output limit. */
const RESULT_FRAME = 400

/**
 * What use_skill returns: the skill's instructions (already rendered), cut to fit `outputLimit` characters. A longer
 * skill ends with the offset to continue from, so the profile's tool output limit never silently drops its end.
 */
export function skillResultText(skill: Pick<ChatSkill, 'name'>, instructions: string, offset: number, outputLimit: number) {
  const start = Math.min(offset, instructions.length)
  let end = Math.min(instructions.length, start + Math.max(100, outputLimit - RESULT_FRAME))
  // Never split a surrogate pair.
  if (end < instructions.length && /[\uD800-\uDBFF]/.test(instructions[end - 1] ?? '')) end -= 1
  const header = start === 0
    ? `Skill "${skill.name}": the administrator's instructions for this kind of request. Follow them for the current request, together with your character's own instructions.`
    : `Skill "${skill.name}", continued from offset ${start}.`
  const more = end < instructions.length ? `\n\n(The skill continues. Call ${USE_SKILL_TOOL} with name "${skill.name}" and offset ${end} for the rest before you act on it.)` : ''
  return `${header}\n\n${instructions.slice(start, end)}${more}`
}
