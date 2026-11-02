import { CHAT_SKILL_LIMITS, normalizeSkillSectionPath, rawTokenEstimate, skillSectionGroup, skillSectionPathKey } from '@conai/shared'
import type { ChatSkillSectionFields, ChatSkillSnapshot } from '@/lib/api-codex-chat'

/**
 * A section in the editor; `key` stays the same while its path is renamed. `savedPath` is the stored path it was
 * loaded with (null: added here), so a rename can be told apart from a new section.
 */
export type SectionDraft = ChatSkillSectionFields & { key: string; savedPath: string | null }
export type SkillDraft = Omit<ChatSkillSnapshot, 'sections'> & { sections: SectionDraft[] }
export type SectionProblem = 'path' | 'duplicate' | 'length' | 'title' | 'content'
export type SkillProblem = 'length' | 'count'

export const EMPTY_SKILL: ChatSkillSnapshot = { name: '', description: '', category: '', instructions: '', sections: [] }

let lastSectionKey = 0
export const newSectionKey = () => `s${++lastSectionKey}`

/** The contents alone (a stored skill also carries usage and dates). */
export function skillSnapshotOf(skill: ChatSkillSnapshot): ChatSkillSnapshot {
  return {
    name: skill.name, description: skill.description, category: skill.category ?? '', instructions: skill.instructions,
    sections: skill.sections.map((section) => ({ path: section.path, title: section.title, summary: section.summary, content: section.content })),
  }
}

/** The order the tree shows and a save sends: top-level sections, then each group together. */
export function treeOrder<T extends { path: string }>(sections: T[]): T[] {
  return sectionGroups(sections).flatMap((group) => group.sections)
}

/** A stored or starting skill as the editor keeps it, in tree order. */
export function skillDraftOf(snapshot: ChatSkillSnapshot): SkillDraft {
  const contents = skillSnapshotOf(snapshot)
  return { ...contents, sections: treeOrder(contents.sections).map((section) => ({ ...section, key: newSectionKey(), savedPath: section.path })) }
}

/** What saving sends: the contents in tree order, so a renamed section is stored where the tree shows it. */
export function draftSnapshot(draft: SkillDraft): ChatSkillSnapshot {
  return skillSnapshotOf({ ...draft, sections: treeOrder(draft.sections) })
}

/** Adds a section after the last one of its group (a new group goes last), as the server files section changes. */
export function insertSection(sections: SectionDraft[], section: SectionDraft): SectionDraft[] {
  const group = groupKey(section.path)
  let index = -1
  sections.forEach((other, position) => { if (groupKey(other.path) === group) index = position })
  if (index < 0) return [...sections, section]
  return [...sections.slice(0, index + 1), section, ...sections.slice(index + 1)]
}

/** Field by field, so a large skill is not serialized on every keystroke. */
export function sameSkillContents(left: ChatSkillSnapshot, right: ChatSkillSnapshot) {
  return left.name === right.name && left.description === right.description && left.category === right.category && left.instructions === right.instructions
    && left.sections.length === right.sections.length
    && left.sections.every((section, index) => {
      const other = right.sections[index]
      return section.path === other.path && section.title === other.title && section.summary === other.summary && section.content === other.content
    })
}

/** The group a section is filed under, compared without case like paths. */
function groupKey(path: string) {
  const group = skillSectionGroup(path.trim())
  return group === null ? null : skillSectionPathKey(group)
}

/** How the tree lists them: top-level sections first, then each group in the order its first section appears. */
export function sectionGroups<T extends { path: string }>(sections: T[]): Array<{ group: string | null; sections: T[] }> {
  const groups = new Map<string | null, T[]>([[null, []]])
  for (const section of sections) {
    const key = groupKey(section.path)
    const list = groups.get(key)
    if (list) list.push(section)
    else groups.set(key, [section])
  }
  return [...groups.entries()].map(([key, list]) => ({ group: key === null ? null : skillSectionGroup(list[0].path.trim()), sections: list }))
}

/** Swaps a section with its neighbour in the same group (the tree shows groups together); null at the end. */
export function moveSection(sections: SectionDraft[], key: string, step: -1 | 1): SectionDraft[] | null {
  const index = sections.findIndex((section) => section.key === key)
  if (index < 0) return null
  const group = groupKey(sections[index].path)
  const sameGroup = (section: SectionDraft) => groupKey(section.path) === group
  let other = index + step
  while (other >= 0 && other < sections.length && !sameGroup(sections[other])) other += step
  if (other < 0 || other >= sections.length) return null
  const next = [...sections]
  ;[next[index], next[other]] = [next[other], next[index]]
  return next
}

/** `wanted`, or `wanted-2`, `wanted-3`… when another section already has it. */
export function uniqueSectionPath(sections: Array<{ path: string }>, wanted: string) {
  const taken = new Set(sections.map((section) => skillSectionPathKey(section.path)))
  if (!taken.has(skillSectionPathKey(wanted))) return wanted
  let n = 2
  while (taken.has(skillSectionPathKey(`${wanted}-${n}`))) n += 1
  return `${wanted}-${n}`
}

// Section objects are replaced on every edit, so results cached by identity stay right while typing elsewhere.
const pathKeys = new WeakMap<ChatSkillSectionFields, string | null>()

/** The saved form's comparison key of a section's path; null when it is not a valid path. */
export function sectionPathKey(section: ChatSkillSectionFields) {
  let key = pathKeys.get(section)
  if (key === undefined) {
    const path = normalizeSkillSectionPath(section.path)
    key = path === null ? null : skillSectionPathKey(path)
    pathKeys.set(section, key)
  }
  return key
}

/** What keeps each section from saving (by key), first problem first; duplicates are counted once for all. */
export function sectionProblems(sections: SectionDraft[]): Map<string, SectionProblem | null> {
  const counts = new Map<string, number>()
  for (const section of sections) {
    const key = sectionPathKey(section)
    if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return new Map(sections.map((section) => {
    const key = sectionPathKey(section)
    const problem: SectionProblem | null = key === null ? 'path'
      : (counts.get(key) ?? 0) > 1 ? 'duplicate'
        : section.title.length > CHAT_SKILL_LIMITS.sectionTitle || section.summary.length > CHAT_SKILL_LIMITS.sectionSummary || section.content.length > CHAT_SKILL_LIMITS.sectionContent ? 'length'
          : !section.title.trim() ? 'title'
            : !section.content.trim() ? 'content'
              : null
    return [section.key, problem]
  }))
}

/** What keeps the skill as a whole from saving: an overview field over its limit, or too many sections (an imported file). */
export function skillProblem(draft: SkillDraft): SkillProblem | null {
  if (draft.sections.length > CHAT_SKILL_LIMITS.sections) return 'count'
  if (draft.name.length > CHAT_SKILL_LIMITS.name || draft.description.length > CHAT_SKILL_LIMITS.description || draft.category.length > CHAT_SKILL_LIMITS.category || draft.instructions.length > CHAT_SKILL_LIMITS.instructions) return 'length'
  return null
}

/** A section path from a heading: spaces become '-', characters a path cannot hold are dropped. */
function pathFromHeading(title: string, sections: Array<{ path: string }>, fallback: string) {
  const slug = title.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}._-]/gu, '').replace(/^[._-]+/, '').slice(0, 60)
  return uniqueSectionPath(sections, normalizeSkillSectionPath(slug) ?? fallback)
}

/**
 * Names of generation presets whose guide is this skill's section at `path` or that section's whole group (`group/`);
 * a null `path`: any guide in the skill.
 */
export function presetsGuidedBy(presets: Array<{ name: string; prompting: { guideSkill: { skillId: number; path: string } | null } }>, skillId: number, path: string | null) {
  const key = path === null ? null : skillSectionPathKey(path)
  const group = path === null ? null : skillSectionGroup(path.trim())
  return presets.filter(({ prompting: { guideSkill: guide } }) => {
    if (!guide || guide.skillId !== skillId) return false
    if (key === null) return true
    const linked = skillSectionPathKey(guide.path)
    return linked === key || (group !== null && linked === `${skillSectionPathKey(group)}/`)
  }).map((preset) => preset.name)
}

/** Whether the overview has a `## ` line to split at (fenced code is only checked when splitting). */
export const hasHeadingToSplit = (instructions: string) => /^##\s+\S/m.test(instructions)

/**
 * Moves each `## Heading` block of the overview into a section of its own (title = heading, path from it); the text
 * before the first heading stays the overview. Headings inside fenced code are text. Null when there is none to move.
 */
export function splitOverviewByHeadings(draft: SkillDraft): SkillDraft | null {
  const lines = draft.instructions.split('\n')
  const blocks: Array<{ title: string; lines: string[] }> = []
  const head: string[] = []
  let fenced = false
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    const heading = fenced ? null : /^##\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) blocks.push({ title: heading[1], lines: [] })
    else if (blocks.length > 0) blocks[blocks.length - 1].lines.push(line)
    else head.push(line)
  }
  if (blocks.length === 0) return null
  const room = CHAT_SKILL_LIMITS.sections - draft.sections.length
  const moved = blocks.slice(0, Math.max(0, room))
  let sections = draft.sections
  for (const block of moved) {
    const title = block.title.slice(0, CHAT_SKILL_LIMITS.sectionTitle)
    sections = insertSection(sections, { key: newSectionKey(), savedPath: null, path: pathFromHeading(title, sections, `section-${sections.length + 1}`), title, summary: '', content: block.lines.join('\n').trim() })
  }
  const kept = blocks.slice(moved.length).flatMap((block) => [`## ${block.title}`, ...block.lines])
  return { ...draft, instructions: [...head, ...kept].join('\n').trim(), sections }
}

const tokenCounts = new WeakMap<ChatSkillSectionFields, { section: number; tableLine: number }>()
function sectionCounts(section: ChatSkillSectionFields) {
  let counts = tokenCounts.get(section)
  if (!counts) {
    counts = { section: rawTokenEstimate(`${section.title}\n${section.content}`), tableLine: rawTokenEstimate(`- ${section.path}: ${section.title} — ${section.summary}`) }
    tokenCounts.set(section, counts)
  }
  return counts
}

/** Rough tokens of what use_skill returns for a section. */
export const sectionTokens = (section: ChatSkillSectionFields) => sectionCounts(section).section

/** Rough tokens of use_skill's first result: the overview and one table-of-contents line per section. */
export function overviewTokens(draft: Pick<ChatSkillSnapshot, 'instructions' | 'sections'>) {
  return rawTokenEstimate(draft.instructions) + draft.sections.reduce((sum, section) => sum + sectionCounts(section).tableLine, 0)
}
