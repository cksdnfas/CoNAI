#!/usr/bin/env node
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const LOCALES_DIR = path.join(ROOT, 'frontend', 'src', 'i18n', 'locales')
const FRONTEND_FEATURES_DIR = path.join(ROOT, 'frontend', 'src', 'features')
const OUTPUT_MD = path.join(ROOT, 'docs', 'i18n-gap-report.md')
const OUTPUT_JSON = path.join(ROOT, 'docs', 'i18n-gap-report.json')

const BASE_LANG = 'en'
const TARGET_LANGS = ['ko', 'ja', 'zh-CN', 'zh-TW']

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function flatten(obj, prefix = '') {
  const out = {}
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) {
    if (prefix) out[prefix] = obj
    return out
  }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key))
    } else {
      out[key] = v
    }
  }
  return out
}

function listNamespaceFiles(lang) {
  const dir = path.join(LOCALES_DIR, lang)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
}

function walkFiles(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      walkFiles(full, exts, out)
    } else if (exts.some((ext) => full.endsWith(ext))) {
      out.push(full)
    }
  }
  return out
}

function detectHardcodedStrings(code) {
  const results = []
  const textRegex = />\s*([^<>{}\n][^<>{}]*)\s*</g
  let m
  while ((m = textRegex.exec(code)) !== null) {
    const txt = m[1].trim()
    if (!txt || txt.length < 3) continue
    if (/^[0-9_.,:;|\-+/%()\[\]{}#@!?*\s]+$/.test(txt)) continue
    if (/^https?:\/\//i.test(txt)) continue
    if (/^[a-z][a-z0-9-]*$/.test(txt)) continue
    if (txt.includes('{') || txt.includes('}')) continue
    results.push({ type: 'jsx-text', text: txt })
  }

  const attrRegex = /(?:title|placeholder|aria-label|label|alt)=\"([^\"]{3,})\"/g
  while ((m = attrRegex.exec(code)) !== null) {
    const txt = m[1].trim()
    if (!txt) continue
    if (/^[0-9_.,:;|\-+/%()\[\]{}#@!?*\s]+$/.test(txt)) continue
    if (/^https?:\/\//i.test(txt)) continue
    results.push({ type: 'attr', text: txt })
  }

  const seen = new Set()
  const uniq = []
  for (const r of results) {
    const k = `${r.type}::${r.text}`
    if (seen.has(k)) continue
    seen.add(k)
    uniq.push(r)
  }
  return uniq.slice(0, 40)
}

function featureFromPath(filePath) {
  const norm = filePath.split(path.sep).join('/')
  const idx = norm.indexOf('/features/')
  if (idx < 0) return 'misc'
  const rest = norm.slice(idx + '/features/'.length)
  return rest.split('/')[0] || 'misc'
}

function main() {
  const baseFiles = listNamespaceFiles(BASE_LANG)
  const missingByLang = {}
  const missingNamespacesByLang = {}
  const statsByLang = {}

  for (const lang of TARGET_LANGS) {
    missingByLang[lang] = {}
    missingNamespacesByLang[lang] = []

    for (const nsFile of baseFiles) {
      const basePath = path.join(LOCALES_DIR, BASE_LANG, nsFile)
      const targetPath = path.join(LOCALES_DIR, lang, nsFile)
      if (!fs.existsSync(targetPath)) {
        missingNamespacesByLang[lang].push(nsFile)
        continue
      }
      const baseFlat = flatten(readJson(basePath))
      const targetFlat = flatten(readJson(targetPath))
      const missing = Object.keys(baseFlat).filter((k) => !(k in targetFlat))
      if (missing.length > 0) missingByLang[lang][nsFile.replace('.json', '')] = missing
    }

    let total = 0
    let missingCount = 0
    for (const nsFile of baseFiles) {
      const baseFlat = flatten(readJson(path.join(LOCALES_DIR, BASE_LANG, nsFile)))
      total += Object.keys(baseFlat).length
    }
    for (const misses of Object.values(missingByLang[lang])) missingCount += misses.length

    statsByLang[lang] = {
      totalKeysCompared: total,
      missingKeys: missingCount,
      translatedKeys: total - missingCount,
      missingNamespaces: missingNamespacesByLang[lang].length,
    }
  }

  const files = walkFiles(FRONTEND_FEATURES_DIR, ['.tsx', '.ts'])
  const hardcodedFiles = []
  const hardcodedByFeature = {}

  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8')
    const findings = detectHardcodedStrings(code)
    if (!findings.length) continue
    const feature = featureFromPath(f)
    hardcodedFiles.push({ file: path.relative(ROOT, f).split(path.sep).join('/'), feature, findings })
    hardcodedByFeature[feature] = (hardcodedByFeature[feature] || 0) + findings.length
  }

  const byFeature = Object.entries(hardcodedByFeature)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([feature, count]) => ({ feature, count }))

  const output = {
    generatedAt: new Date().toISOString(),
    baseLocale: BASE_LANG,
    comparedLocales: TARGET_LANGS,
    missingNamespacesByLang,
    missingByLang,
    statsByLang,
    hardcodedSummary: {
      filesWithFindings: hardcodedFiles.length,
      totalFindings: hardcodedFiles.reduce((acc, cur) => acc + cur.findings.length, 0),
      byFeature,
    },
    hardcodedFiles,
  }

  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true })
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2), 'utf8')

  const lines = []
  lines.push('# i18n Gap Report')
  lines.push('')
  lines.push(`Generated: ${output.generatedAt}`)
  lines.push(`Base locale: ${BASE_LANG}`)
  lines.push('')
  lines.push('## Locale Missing Summary')
  lines.push('')
  for (const lang of TARGET_LANGS) {
    const s = statsByLang[lang]
    lines.push(`- ${lang}: missing keys ${s.missingKeys}, missing namespaces ${s.missingNamespaces}`)
  }
  lines.push('')
  lines.push('## Missing Keys by Language/Namespace')
  lines.push('')
  for (const lang of TARGET_LANGS) {
    lines.push(`### ${lang}`)
    if (!Object.keys(missingByLang[lang]).length && !missingNamespacesByLang[lang].length) {
      lines.push('- No missing keys/namespaces')
      lines.push('')
      continue
    }
    if (missingNamespacesByLang[lang].length) lines.push(`- Missing namespaces: ${missingNamespacesByLang[lang].join(', ')}`)
    for (const [ns, keys] of Object.entries(missingByLang[lang])) {
      lines.push(`- ${ns}: ${keys.length} missing keys`)
      for (const key of keys.slice(0, 30)) lines.push(`  - ${key}`)
      if (keys.length > 30) lines.push(`  - ... (${keys.length - 30} more)`)
    }
    lines.push('')
  }

  lines.push('## Hardcoded String Findings (Heuristic)')
  lines.push('')
  lines.push(`- Files with findings: ${output.hardcodedSummary.filesWithFindings}`)
  lines.push(`- Total findings: ${output.hardcodedSummary.totalFindings}`)
  lines.push('')
  lines.push('### By Feature (Top)')
  for (const item of byFeature) lines.push(`- ${item.feature}: ${item.count}`)
  lines.push('')
  lines.push('### File Details (Top 40)')
  for (const fileEntry of hardcodedFiles.slice(0, 40)) {
    lines.push(`- ${fileEntry.file} (${fileEntry.findings.length})`)
    for (const f of fileEntry.findings.slice(0, 8)) lines.push(`  - [${f.type}] ${f.text}`)
  }
  lines.push('')
  lines.push('## Priority TODO (Actionable Units)')
  lines.push('')
  lines.push('1. P0: Fill missing keys in locales where missing count > 0 (keep en schema lockstep).')
  lines.push('2. P0: Replace hardcoded strings in feature pages with t() calls (start from top hardcoded features).')
  lines.push('3. P1: Add CI step npm run i18n:check and fail on missing keys.')
  lines.push('4. P1: Add component-level lint rule/codemod for hardcoded JSX text patterns.')
  lines.push('5. P2: Expand check script with AST parsing to reduce false positives.')

  fs.writeFileSync(OUTPUT_MD, lines.join('\n') + '\n', 'utf8')
  console.log(`[i18n-check] Wrote ${path.relative(ROOT, OUTPUT_JSON)}`)
  console.log(`[i18n-check] Wrote ${path.relative(ROOT, OUTPUT_MD)}`)
  console.log(`[i18n-check] Missing key summary: ${JSON.stringify(statsByLang)}`)
}

main()
