import fs from 'fs'
import path from 'path'

/**
 * The user guides (docs/GUIDE/*.md, the same pages the docs site shows) as text for the chat and MCP clients, so a
 * question about how a CoNAI feature works is answered from the app's own guide instead of the model's guesses.
 * Every build ships the folder next to the app (see scripts/build-*.js and the Dockerfile).
 */

const MARKER = 'START_HERE.md'
let cachedDir: string | null | undefined

/** The guide folder across the dev tree, the compiled and bundled builds, Docker, portable and SEA layouts. */
export function appGuideDir(): string | null {
  if (cachedDir !== undefined) return cachedDir
  const candidates = [
    process.env.CONAI_GUIDE_DIR,
    // Bundle builds (Docker bundle image, portable app/): docs next to bundle.js
    path.join(__dirname, 'docs', 'GUIDE'),
    // Development: backend/src/services -> <repo>/docs/GUIDE
    path.join(__dirname, '..', '..', '..', 'docs', 'GUIDE'),
    // Bundle run inside the repo: backend/dist -> <repo>/docs/GUIDE
    path.join(__dirname, '..', '..', 'docs', 'GUIDE'),
    // Compiled build (root Dockerfile, integrated): backend/dist/backend/src/services -> <repo>/docs/GUIDE
    path.join(__dirname, '..', '..', '..', '..', '..', 'docs', 'GUIDE'),
    // SEA: docs next to the executable
    path.join(path.dirname(process.execPath), 'docs', 'GUIDE'),
    path.join(process.cwd(), 'docs', 'GUIDE'),
    path.join(process.cwd(), 'app', 'docs', 'GUIDE'),
  ].filter((candidate): candidate is string => Boolean(candidate))
  cachedDir = candidates.find((candidate) => fs.existsSync(path.join(candidate, MARKER))) ?? null
  return cachedDir
}

/** Tests point the lookup at a folder of their own. */
export function resetAppGuideDirForTests(dir?: string | null) {
  cachedDir = dir === undefined ? undefined : dir
}

export type AppGuideTopic = { topic: string; title: string; sections: string[]; chars: number }

const TOPIC = /^[A-Z0-9_]+$/

/**
 * Drop what only the docs site understands: VitePress containers (`::: v-pre`, `::: warning Title` … `:::`), site
 * links turned into plain topic references, and HTML comments.
 */
export function plainGuideText(markdown: string): string {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^:::\s*v-pre\s*$\n?/gm, '')
    .replace(/^:::\s*(tip|info|warning|danger|details)\s*(.*)$/gm, (_match, kind: string, title: string) => `> **${title.trim() || kind}**`)
    .replace(/^:::\s*$\n?/gm, '')
    .replace(/\]\(\.\/([A-Z0-9_]+)\.md(#[^)]*)?\)/g, (_match, topic: string, anchor?: string) => `](topic:${topic}${anchor ?? ''})`)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function readTopic(dir: string, topic: string): string | null {
  if (!TOPIC.test(topic)) return null
  const file = path.join(dir, `${topic}.md`)
  try { return plainGuideText(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function headings(text: string) {
  return text.split('\n').filter((line) => /^#{1,3}\s/.test(line)).map((line) => line.replace(/^#+\s*/, '').trim())
}

/** Every guide with its title and section headings (the table of contents). */
export function listAppGuides(): AppGuideTopic[] {
  const dir = appGuideDir()
  if (!dir) return []
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== 'index.md')
    .map((name) => name.slice(0, -3))
    .filter((topic) => TOPIC.test(topic))
    .sort()
    .flatMap((topic) => {
      const text = readTopic(dir, topic)
      if (text === null) return []
      const all = headings(text)
      return [{ topic, title: all[0] ?? topic, sections: all.slice(1, 40), chars: text.length }]
    })
}

/** The sections of a guide whose heading contains `section` (case-insensitive), each running to the next heading of its level or above. */
function sectionsOf(text: string, section: string) {
  const lines = text.split('\n')
  const wanted = section.trim().toLowerCase()
  const parts: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.*)$/.exec(lines[index])
    if (!match || !match[2].toLowerCase().includes(wanted)) continue
    const level = match[1].length
    let end = index + 1
    while (end < lines.length) {
      const next = /^(#{1,6})\s/.exec(lines[end])
      if (next && next[1].length <= level) break
      end += 1
    }
    parts.push(lines.slice(index, end).join('\n').trim())
    index = end - 1
  }
  return parts
}

export type AppGuidePage = { topic: string; title: string; section?: string; text: string; offset: number; next_offset?: number; total_chars: number }
export type AppGuideOutline = { topic: string; title: string; intro: string; sections: string[]; total_chars: number }

/** What a guide opens with before its first section, clipped: enough to tell whether it is the right one. */
const INTRO_CHARS = 800

/**
 * One guide. By default only its outline (intro and section headings); the sections whose heading contains `section`,
 * or (with an offset) the whole text, come paged by characters at line boundaries.
 */
export function readAppGuide(topic: string, options: { section?: string; offset?: number; limit: number }): AppGuidePage | AppGuideOutline | { error: string; topics: string[] } {
  const dir = appGuideDir()
  const topics = listAppGuides().map((entry) => entry.topic)
  const normalized = topic.trim().replace(/\.md$/i, '').toUpperCase()
  const text = dir ? readTopic(dir, normalized) : null
  if (text === null) return { error: dir ? `No guide named ${topic}.` : 'The user guides are not installed with this build.', topics }
  const title = headings(text)[0] ?? normalized
  if (!options.section?.trim() && options.offset === undefined) {
    const intro = text.split('\n').filter((line, index) => index > 0 || !/^#\s/.test(line)).join('\n').split(/\n#{2,6}\s/)[0].trim()
    return { topic: normalized, title, intro: intro.length > INTRO_CHARS ? `${intro.slice(0, INTRO_CHARS)}…` : intro, sections: headings(text).slice(1), total_chars: text.length }
  }
  let body = text
  if (options.section?.trim()) {
    const parts = sectionsOf(text, options.section)
    if (!parts.length) return { error: `No section of ${normalized} matches "${options.section}". Sections: ${headings(text).slice(1).join(' | ')}`, topics }
    body = parts.join('\n\n')
  }
  const offset = Math.max(0, Math.min(options.offset ?? 0, body.length))
  let end = Math.min(body.length, offset + options.limit)
  if (end < body.length) {
    const lineEnd = body.lastIndexOf('\n', end)
    if (lineEnd > offset) end = lineEnd + 1
  }
  return {
    topic: normalized,
    title,
    ...(options.section?.trim() ? { section: options.section.trim() } : {}),
    text: body.slice(offset, end),
    offset,
    ...(end < body.length ? { next_offset: end } : {}),
    total_chars: body.length,
  }
}
