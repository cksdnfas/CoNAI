import path from 'path'
import AdmZip from 'adm-zip'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { CHAT_SKILL_LIMITS, normalizeSkillSectionPath, skillSectionPathKey, type ChatSkillSectionFields } from '@conai/shared'
import { zipEntryBytes, zipEntryKind } from '../../utils/zipEntries'
import { ChatProfileError } from './chatProfileError'
import type { ChatSkill, ChatSkillSnapshot } from './chatSkills'

/**
 * Skills as Agent Skills folders (agentskills.io): `SKILL.md` (YAML front matter with name and description, then the
 * instructions) beside optional reference documents. CoNAI keeps the overview as SKILL.md's body and each section as
 * `references/<path>.md` with its title and summary in front matter, so an export imports back unchanged and a
 * folder from elsewhere becomes an overview plus sections. Scripts and other assets are never brought in: chat
 * models do not run package code here.
 */

export const SKILL_UPLOAD_LIMIT = 8 * 1024 * 1024
const MAX_FILE = 4 * 1024 * 1024
const MAX_TOTAL = 16 * 1024 * 1024
const MAX_ENTRIES = 512
const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt'])
/** Where an export lists the sections in SKILL.md; an import drops it, since CoNAI writes the table of contents itself. */
const SECTIONS_MARK = '<!-- conai:sections -->'

export type SkillDraft = ChatSkillSnapshot
export type SkillPackageRead = { draft: SkillDraft; warnings: string[] }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (bytes: Buffer) => bytes.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')

/** Front matter (`---` YAML `---`) and the body after it; a file without it is all body. */
function splitFrontMatter(source: string): { meta: Record<string, unknown>; body: string } {
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(source)
  if (!match) return { meta: {}, body: source.trim() }
  let meta: unknown
  try { meta = parseYaml(match[1]) } catch { throw new ChatProfileError('SKILL.md 앞부분(YAML)을 읽을 수 없어.') }
  return { meta: isRecord(meta) ? meta : {}, body: source.slice(match[0].length).trim() }
}

const metaText = (meta: Record<string, unknown>, key: string) => (typeof meta[key] === 'string' || typeof meta[key] === 'number' ? String(meta[key]).trim() : '')

/** An Agent Skills name: lowercase letters, digits and single hyphens, at most 64 characters. */
export function skillSlug(skill: Pick<ChatSkill, 'id' | 'name'>) {
  const slug = skill.name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '')
  return slug || `skill-${skill.id}`
}

/** A section path from a document's place in the folder (two levels at most, other characters as hyphens). */
function sectionPathOf(relative: string) {
  const parts = relative.replace(/\.(md|markdown|txt)$/i, '').split('/').map((part) => part.normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[._-]+|-+$/g, '')).filter(Boolean)
  const joined = parts.length > 2 ? [parts[0], parts.slice(1).join('-')] : parts
  return normalizeSkillSectionPath(joined.join('/'))
}

/** Splits text longer than `max` at a heading or blank line (else anywhere) into parts that fit. */
export function splitLong(content: string, max: number) {
  const parts: string[] = []
  let rest = content
  while (rest.length > max) {
    const window = rest.slice(0, max)
    const cut = Math.max(window.lastIndexOf('\n#'), window.lastIndexOf('\n\n'))
    const at = cut > max / 2 ? cut : max
    parts.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  parts.push(rest)
  return parts.filter(Boolean)
}

/**
 * One skill folder's files (`files` keyed by path inside `root`) as a draft: SKILL.md gives the name, description,
 * category (CoNAI metadata) and overview; every other text document but scripts and assets becomes a section, in the
 * order SKILL.md first mentions it.
 */
export function readSkillFolder(files: Map<string, Buffer>, root: string): SkillPackageRead {
  const warnings: string[] = []
  const skillFile = files.get(`${root}SKILL.md`)
  if (!skillFile) throw new ChatProfileError('SKILL.md가 없어.')
  const { meta, body } = splitFrontMatter(text(skillFile))
  const metadata = isRecord(meta.metadata) ? meta.metadata : {}
  const name = metaText(metadata, 'conai-name') || metaText(meta, 'name') || root.replace(/\/$/, '').split('/').pop() || ''
  const description = metaText(meta, 'description')
  if (!description) warnings.push('언제 쓰는지(description)가 없어. 저장 전에 적어줘.')
  const marked = body.indexOf(SECTIONS_MARK)
  const instructions = (marked >= 0 ? body.slice(0, marked) : body).trim()
  if (instructions.length > CHAT_SKILL_LIMITS.instructions) warnings.push(`개요가 ${CHAT_SKILL_LIMITS.instructions}자를 넘어. 저장 전에 일부를 섹션으로 옮겨줘.`)

  const sections: Array<ChatSkillSectionFields & { mention: number }> = []
  const keys = new Set<string>()
  for (const [file, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    if (!file.startsWith(root) || file === `${root}SKILL.md`) continue
    const relative = file.slice(root.length)
    const top = relative.split('/')[0]
    if (top === 'scripts' || top === 'assets' || !TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase())) {
      warnings.push(`${relative}: ${top === 'scripts' ? '실행 파일은' : '문서가 아닌 파일은'} 가져오지 않았어.`)
      continue
    }
    const folders = relative.split('/').slice(0, -1)
    if (folders.some((_, index) => files.has(`${root}${folders.slice(0, index + 1).join('/')}/SKILL.md`))) {
      warnings.push(`${relative}: 안에 든 다른 스킬의 파일이라 가져오지 않았어.`)
      continue
    }
    const sectionPath = sectionPathOf(relative.replace(/^references\//, ''))
    if (!sectionPath) { warnings.push(`${relative}: 섹션 경로로 바꿀 수 없어 가져오지 않았어.`); continue }
    const document = splitFrontMatter(text(bytes))
    let content = document.body
    let title = metaText(document.meta, 'title')
    if (!title) {
      const heading = /^#\s+(.+)\n?/.exec(content)
      title = heading ? heading[1].trim() : path.basename(sectionPath)
      if (heading) content = content.slice(heading[0].length).trim()
    }
    const summary = metaText(document.meta, 'summary')
    if (summary.length > CHAT_SKILL_LIMITS.sectionSummary) warnings.push(`${relative}: 목차 요약이 ${CHAT_SKILL_LIMITS.sectionSummary}자를 넘어. 저장 전에 줄여줘.`)
    if (title.length > CHAT_SKILL_LIMITS.sectionTitle) warnings.push(`${relative}: 제목이 ${CHAT_SKILL_LIMITS.sectionTitle}자를 넘어. 저장 전에 줄여줘.`)
    if (!content) { warnings.push(`${relative}: 내용이 비어 있어 건너뛰었어.`); continue }
    const parts = splitLong(content, CHAT_SKILL_LIMITS.sectionContent)
    if (parts.length > 1) warnings.push(`${relative}: ${CHAT_SKILL_LIMITS.sectionContent}자를 넘어 섹션 ${parts.length}개로 나눴어.`)
    const mention = body.indexOf(relative)
    parts.forEach((part, index) => {
      const partPath = parts.length > 1 ? normalizeSkillSectionPath(`${sectionPath}-${index + 1}`) ?? sectionPath : sectionPath
      const key = skillSectionPathKey(partPath)
      if (keys.has(key)) { warnings.push(`${relative}: 경로 "${partPath}"가 겹쳐 건너뛰었어.`); return }
      keys.add(key)
      sections.push({
        path: partPath,
        title: parts.length > 1 ? `${title} (${index + 1}/${parts.length})` : title,
        summary,
        content: part,
        mention: mention < 0 ? Number.MAX_SAFE_INTEGER : mention,
      })
    })
  }
  if (sections.length > CHAT_SKILL_LIMITS.sections) warnings.push(`섹션이 ${sections.length}개야. ${CHAT_SKILL_LIMITS.sections}개까지 저장할 수 있으니 합치거나 줄여줘.`)
  if (sections.some((section) => !section.summary)) warnings.push('목차 요약이 없는 섹션이 있어. 모델이 언제 읽을지 알 수 있게 적어줘.')
  sections.sort((a, b) => a.mention - b.mention)
  if (name.length > CHAT_SKILL_LIMITS.name) warnings.push(`이름이 ${CHAT_SKILL_LIMITS.name}자를 넘어. 저장 전에 줄여줘.`)
  if (description.length > CHAT_SKILL_LIMITS.description) warnings.push(`언제 쓰는지(description)가 ${CHAT_SKILL_LIMITS.description}자를 넘어. 저장 전에 줄여줘.`)
  return {
    draft: {
      name: name.replace(/\s+/g, ' '),
      description,
      category: metaText(metadata, 'conai-category'),
      instructions,
      sections: sections.map(({ mention: _mention, ...section }) => section),
    },
    warnings,
  }
}

/** The files of a ZIP upload, checked like a plugin package: no links, encryption, oversized or too many entries. */
function zipFiles(bytes: Buffer) {
  let entries: ReturnType<AdmZip['getEntries']>
  try { entries = new AdmZip(bytes).getEntries() } catch { throw new ChatProfileError('ZIP 파일을 읽을 수 없어.') }
  if (entries.length > MAX_ENTRIES) throw new ChatProfileError(`ZIP 안 파일은 ${MAX_ENTRIES}개까지야.`)
  const files = new Map<string, Buffer>()
  let total = 0
  for (const entry of entries) {
    const kind = zipEntryKind(entry)
    if (!kind) throw new ChatProfileError('암호화되었거나 링크인 파일은 가져올 수 없어.')
    const name = entry.entryName.replace(/\\/g, '/')
    if (kind === 'folder' || name.startsWith('__MACOSX/') || path.posix.basename(name).startsWith('.')) continue
    if (name.split('/').some((part) => part === '..' || part === '') || name.startsWith('/')) throw new ChatProfileError('ZIP 안 경로가 올바르지 않아.')
    if ((total += entry.header.size) > MAX_TOTAL) throw new ChatProfileError('압축을 푼 크기가 너무 커.')
    const content = zipEntryBytes(entry, MAX_FILE)
    if (!content) throw new ChatProfileError(`${name}: 파일이 너무 크거나 압축 정보가 올바르지 않아.`)
    files.set(name, content)
  }
  return files
}

/** An uploaded `.zip` (one skill folder, SKILL.md at its root or in its one top folder) or a lone `.md` as a draft. */
export function readSkillUpload(fileName: string, bytes: Buffer): SkillPackageRead {
  if (bytes.length > SKILL_UPLOAD_LIMIT) throw new ChatProfileError('8MB까지 가져올 수 있어.')
  const extension = path.extname(fileName).toLowerCase()
  if (extension === '.md' || extension === '.markdown') {
    const files = new Map([['SKILL.md', bytes]])
    const read = readSkillFolder(files, '')
    if (!read.draft.name) read.draft.name = path.basename(fileName, extension)
    return read
  }
  if (extension !== '.zip') throw new ChatProfileError('.zip이나 .md 파일을 골라줘.')
  const files = zipFiles(bytes)
  const roots = [...files.keys()].filter((name) => /(^|\/)SKILL\.md$/.test(name)).map((name) => name.slice(0, -'SKILL.md'.length))
  const shallowest = Math.min(...roots.map((root) => root.split('/').length))
  const top = roots.filter((root) => root.split('/').length === shallowest)
  if (top.length === 0) throw new ChatProfileError('ZIP에 SKILL.md가 없어.')
  if (top.length > 1) throw new ChatProfileError(`ZIP에 스킬이 ${top.length}개 있어. 하나씩 가져와줘.`)
  return readSkillFolder(files, top[0])
}

/** A skill as an Agent Skills ZIP: `<slug>/SKILL.md` and `<slug>/references/<path>.md`. */
export function exportSkillZip(skill: ChatSkill): { fileName: string; bytes: Buffer } {
  const slug = skillSlug(skill)
  const zip = new AdmZip()
  const front = (meta: Record<string, unknown>) => `---\n${stringifyYaml(meta, { lineWidth: 0 }).trimEnd()}\n---\n`
  const metadata: Record<string, string> = { 'conai-name': skill.name }
  if (skill.category) metadata['conai-category'] = skill.category
  const contents = skill.sections.map((section) => `- [${section.title}](references/${section.path}.md)${section.summary ? `: ${section.summary}` : ''}`)
  const body = contents.length ? `${skill.instructions}\n\n${SECTIONS_MARK}\n## References\n\n${contents.join('\n')}\n` : `${skill.instructions}\n`
  zip.addFile(`${slug}/SKILL.md`, Buffer.from(`${front({ name: slug, description: skill.description, metadata })}\n${body}`, 'utf8'))
  for (const section of skill.sections) {
    const meta: Record<string, string> = { title: section.title }
    if (section.summary) meta.summary = section.summary
    zip.addFile(`${slug}/references/${section.path}.md`, Buffer.from(`${front(meta)}\n${section.content}\n`, 'utf8'))
  }
  return { fileName: `${slug}.zip`, bytes: zip.toBuffer() }
}
