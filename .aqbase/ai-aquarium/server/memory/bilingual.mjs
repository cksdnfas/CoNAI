import { createHash } from 'node:crypto'
import { clipProse } from '../../shared/speech.mjs'
export const LANGUAGES = ['en', 'ko', 'ja', 'zh']
export const textHash = entry => createHash('sha256').update(JSON.stringify([entry.title, entry.keys, entry.content])).digest('hex')
export function translationOf(entry, value) {
  if (!value || !LANGUAGES.includes(value.language) || typeof value.title !== 'string' || typeof value.content !== 'string' || !value.content.trim() || !Array.isArray(value.keys)) return null
  const sourceHash = textHash(entry)
  if (value.sourceHash && value.sourceHash !== sourceHash) return null
  const keys = value.keys.filter(k => typeof k === 'string' && k.trim()).slice(0, 20).map(k => clipProse(k, 100))
  return { language: value.language, title: clipProse(value.title, 80), keys, content: clipProse(value.content, 2000), sourceHash }
}

const count = (text, re) => (text.match(re) ?? []).length
/** The language a text is plainly written in, by its letters; null when no script clearly leads. */
export function scriptLanguage(text) {
  const s = String(text ?? '')
  const scores = { ko: count(s, /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g), ja: count(s, /[\u3040-\u30ff]/g), zh: count(s, /[\u4e00-\u9fff]/g), en: count(s, /[A-Za-z]/g) }
  if (scores.ja) { scores.ja += scores.zh; scores.zh = 0 }
  const [best, second] = Object.entries(scores).sort((a, b) => b[1] - a[1])
  return best[1] >= 4 && best[1] >= second[1] * 2 ? best[0] : null
}

/**
 * Up to 3.9.3 the host labelled every answer with the profile's model language, so text a persona wrote in the display
 * language was stored as "en" with a copy of itself as its translation. Relabel such rows by their letters, once, and
 * drop a "translation" that is in the source's own language.
 */
export function healLanguageLabels(db, table, { source, display, displayLanguage, clear }) {
  db.exec('CREATE TABLE IF NOT EXISTS aquarium_fixes (name TEXT PRIMARY KEY)')
  const name = `language-labels:${table}`
  if (db.prepare('SELECT 1 FROM aquarium_fixes WHERE name=?').get(name)) return
  db.transaction(() => {
    for (const row of db.prepare(`SELECT rowid AS rid,* FROM ${table} WHERE language IS NOT NULL`).all()) {
      const real = scriptLanguage(source(row))
      if (!real || real === row.language) continue
      const shown = display(row)
      db.prepare(`UPDATE ${table} SET language=? WHERE rowid=?`).run(real, row.rid)
      if (shown !== null && displayLanguage(row) === real) db.prepare(`UPDATE ${table} SET ${clear} WHERE rowid=?`).run(row.rid)
    }
    db.prepare('INSERT INTO aquarium_fixes(name) VALUES(?)').run(name)
  })()
}
export const displayJson = result => result?.translation?.status === 'completed' ? result.translation.json : null
