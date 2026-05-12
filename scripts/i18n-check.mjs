#!/usr/bin/env node
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const I18N_RESOURCES_DIR = path.join(ROOT, 'frontend', 'src', 'i18n', 'resources')
const FRONTEND_FEATURES_DIR = path.join(ROOT, 'frontend', 'src', 'features')
const OUTPUT_MD = path.join(ROOT, 'docs', 'i18n-gap-report.md')
const OUTPUT_JSON = path.join(ROOT, 'docs', 'i18n-gap-report.json')

const BASE_LANG = 'ko'
const TARGET_LANGS = ['en']
const RESOURCE_FILE_EXCLUDES = new Set(['index.ts', 'types.ts'])

function listResourceFiles() {
  if (!fs.existsSync(I18N_RESOURCES_DIR)) return []
  return fs
    .readdirSync(I18N_RESOURCES_DIR)
    .filter((f) => f.endsWith('.ts') && !RESOURCE_FILE_EXCLUDES.has(f))
    .sort()
}

function extractLocaleBlock(code, lang) {
  const marker = new RegExp(`\\b${lang}:\\s*{`, 'm')
  const match = marker.exec(code)
  if (!match) return null

  let i = match.index + match[0].length - 1
  let depth = 0
  let inString = false
  let quote = ''
  let escaped = false
  for (; i < code.length; i += 1) {
    const ch = code[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === quote) {
        inString = false
      }
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true
      quote = ch
      continue
    }
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return code.slice(match.index + match[0].length, i)
    }
  }
  return null
}

function extractResourceKeys(filePath) {
  const code = fs.readFileSync(filePath, 'utf8')
  const byLang = {}
  for (const lang of [BASE_LANG, ...TARGET_LANGS]) {
    const block = extractLocaleBlock(code, lang)
    if (block == null) {
      byLang[lang] = null
      continue
    }
    const keys = []
    const keyRegex = /^\s*"([^"]+)"\s*:/gm
    let m
    while ((m = keyRegex.exec(block)) !== null) keys.push(m[1])
    byLang[lang] = keys
  }
  return byLang
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

function shouldIgnoreHardcodedCandidate(txt) {
  if (/^[0-9_.,:;|\-+/%()\[\]{}#@!?*\s]+$/.test(txt)) return true
  if (/^https?:\/\//i.test(txt)) return true
  if (/^[a-z][a-z0-9-]*$/.test(txt)) return true
  if (txt.includes('{') || txt.includes('}')) return true
  if (/^(Promise|void \| Promise|void|Extract|NonNullable|ReturnType|Dispatch|SetStateAction)$/.test(txt)) return true
  if (/\b(state|record|event|candidate|groups|filter|map|get|set)[A-Z.([]/i.test(txt)) return true
  if (/[()]/.test(txt) && /[?:=>]/.test(txt)) return true
  if (/^[A-Za-z_$][\w$]*(\.[\w$]+|\([^)]*\)|\[[^\]]+\])/.test(txt)) return true
  return false
}

function detectHardcodedStrings(code) {
  const results = []
  const textRegex = />[ \t\r]*([^<>{}\r\n][^<>{}\r\n]*)[ \t\r]*</g
  let m
  while ((m = textRegex.exec(code)) !== null) {
    const txt = m[1].trim()
    if (!txt || txt.length < 3) continue
    if (shouldIgnoreHardcodedCandidate(txt)) continue
    results.push({ type: 'jsx-text', text: txt })
  }

  const attrRegex = /(?:title|placeholder|aria-label|label|alt)=\"([^\"]{3,})\"/g
  while ((m = attrRegex.exec(code)) !== null) {
    const txt = m[1].trim()
    if (!txt) continue
    if (shouldIgnoreHardcodedCandidate(txt)) continue
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
  const resourceFiles = listResourceFiles()
  const missingByLang = {}
  const missingNamespacesByLang = {}
  const statsByLang = {}
  const resourceKeyCountsByNamespace = {}

  for (const lang of TARGET_LANGS) {
    missingByLang[lang] = {}
    missingNamespacesByLang[lang] = []
    let total = 0
    let missingCount = 0

    for (const resourceFile of resourceFiles) {
      const ns = resourceFile.replace(/\.ts$/, '')
      const byLang = extractResourceKeys(path.join(I18N_RESOURCES_DIR, resourceFile))
      const baseKeys = byLang[BASE_LANG]
      const targetKeys = byLang[lang]

      if (!baseKeys) {
        missingNamespacesByLang[BASE_LANG] = missingNamespacesByLang[BASE_LANG] || []
        missingNamespacesByLang[BASE_LANG].push(resourceFile)
        continue
      }

      resourceKeyCountsByNamespace[ns] = baseKeys.length
      total += baseKeys.length

      if (!targetKeys) {
        missingNamespacesByLang[lang].push(resourceFile)
        missingByLang[lang][ns] = baseKeys
        missingCount += baseKeys.length
        continue
      }

      const targetKeySet = new Set(targetKeys)
      const missing = baseKeys.filter((k) => !targetKeySet.has(k))
      if (missing.length > 0) missingByLang[lang][ns] = missing
      missingCount += missing.length
    }

    statsByLang[lang] = {
      totalKeysCompared: total,
      missingKeys: missingCount,
      translatedKeys: total - missingCount,
      missingNamespaces: missingNamespacesByLang[lang].length,
    }
  }

  const files = walkFiles(FRONTEND_FEATURES_DIR, ['.tsx'])
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
    resourceKeyCountsByNamespace,
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
  lines.push('## Resource Namespace Summary')
  lines.push('')
  lines.push(`- Resource files checked: ${resourceFiles.length}`)
  lines.push(`- Base keys checked: ${Object.values(resourceKeyCountsByNamespace).reduce((acc, count) => acc + count, 0)}`)
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
  lines.push('1. P0: Fill missing keys in locales where missing count > 0 (keep ko/en resource files lockstep).')
  lines.push('2. P0: Replace confirmed user-visible hardcoded strings in feature pages with t() calls (start from top hardcoded features).')
  lines.push('3. P1: Add CI step npm run i18n:check and fail on missing keys.')
  lines.push('4. P1: Add component-level lint rule/codemod for hardcoded JSX text patterns.')
  lines.push('5. P2: Expand check script with AST parsing to reduce false positives further.')

  fs.writeFileSync(OUTPUT_MD, lines.join('\n') + '\n', 'utf8')
  console.log(`[i18n-check] Wrote ${path.relative(ROOT, OUTPUT_JSON)}`)
  console.log(`[i18n-check] Wrote ${path.relative(ROOT, OUTPUT_MD)}`)
  console.log(`[i18n-check] Missing key summary: ${JSON.stringify(statsByLang)}`)

  const totalMissingKeys = Object.values(statsByLang).reduce((acc, stats) => acc + stats.missingKeys, 0)
  const totalMissingNamespaces = Object.values(statsByLang).reduce((acc, stats) => acc + stats.missingNamespaces, 0)
  if (totalMissingKeys > 0 || totalMissingNamespaces > 0) {
    console.error(`[i18n-check] Missing translation resources found: ${totalMissingKeys} keys, ${totalMissingNamespaces} namespaces`)
    process.exitCode = 1
  }
}

main()
