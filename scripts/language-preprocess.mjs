#!/usr/bin/env node
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const SCAN_TARGETS = [
  { area: 'frontend', dir: path.join(ROOT, 'frontend', 'src') },
  { area: 'backend', dir: path.join(ROOT, 'backend', 'src') },
  { area: 'shared', dir: path.join(ROOT, 'shared', 'src') },
]
const OUTPUT_DIR = path.join(ROOT, 'docs')
const OUTPUT_JSON = path.join(OUTPUT_DIR, 'english-only-preprocess-report.json')
const OUTPUT_MD = path.join(OUTPUT_DIR, 'english-only-preprocess-report.md')
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '__tests__'])
const HANGUL_REGEX = /[가-힣]/
const MAX_SOURCE_EXAMPLES = 8
const MAX_GROUPS_IN_REPORT = 40

function toSlash(filePath) {
  return filePath.split(path.sep).join('/')
}

function relativePath(filePath) {
  return toSlash(path.relative(ROOT, filePath))
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      walkFiles(full, out)
      continue
    }

    if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      out.push(full)
    }
  }

  return out
}

function getLineStarts(code) {
  const starts = [0]
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] === '\n') starts.push(i + 1)
  }
  return starts
}

function getLineColumn(lineStarts, index) {
  let low = 0
  let high = lineStarts.length - 1
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (lineStarts[mid] <= index) low = mid + 1
    else high = mid - 1
  }

  const lineIndex = Math.max(0, high)
  return { line: lineIndex + 1, column: index - lineStarts[lineIndex] + 1 }
}

function decodeBasicEscapes(value) {
  return value
    .replace(/\\n/g, ' ')
    .replace(/\\r/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\`/g, '`')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
}

function compactText(value) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:)\]}])/g, '$1')
    .replace(/([({\[])\s+/g, '$1')
    .trim()
}

function shouldIgnoreText(text) {
  if (!text || !HANGUL_REGEX.test(text)) return true
  if (text.length > 320) return true
  if (/^\s*\/\//.test(text)) return true
  if (/^\s*\*/.test(text)) return true
  return false
}

function extractStringsFromCode(code, filePath, area) {
  const findings = []
  const lineStarts = getLineStarts(code)
  const file = relativePath(filePath)
  const feature = inferFeature(file, area)

  const addFinding = (kind, rawText, index) => {
    const text = compactText(decodeBasicEscapes(rawText))
    if (shouldIgnoreText(text)) return
    const location = getLineColumn(lineStarts, index)
    const exposure = classifyExposure({ area, feature, file, text })
    findings.push({
      id: `${file}:${location.line}:${location.column}:${kind}`,
      area,
      feature,
      file,
      line: location.line,
      column: location.column,
      kind,
      exposure,
      text,
      normalizedText: normalizeMessage(text),
      signature: buildSignature(text),
    })
  }

  // String literals and template literals. Good enough for preprocessing; not a parser by design.
  const literalRegex = /(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g
  let match
  while ((match = literalRegex.exec(code)) !== null) {
    addFinding(match[1] === '`' ? 'template-literal' : 'string-literal', match[2], match.index)
  }

  // JSX text between tags can be missed when it is not quoted.
  const jsxTextRegex = />\s*([^<>{}\n][^<>{}]*)\s*</g
  while ((match = jsxTextRegex.exec(code)) !== null) {
    addFinding('jsx-text', match[1], match.index + 1)
  }

  return dedupeFindings(findings)
}

function dedupeFindings(findings) {
  const seen = new Set()
  const unique = []
  for (const finding of findings) {
    const key = `${finding.file}:${finding.line}:${finding.column}:${finding.kind}:${finding.text}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(finding)
  }
  return unique
}

function inferFeature(file, area) {
  if (area === 'frontend') {
    const match = file.match(/frontend\/src\/features\/([^/]+)/)
    if (match) return match[1]
    const appMatch = file.match(/frontend\/src\/([^/]+)/)
    return appMatch ? appMatch[1] : 'frontend'
  }

  if (area === 'backend') {
    const match = file.match(/backend\/src\/([^/]+)/)
    return match ? match[1] : 'backend'
  }

  const match = file.match(/shared\/src\/([^/]+)/)
  return match ? match[1] : 'shared'
}

function classifyExposure({ area, feature, file, text }) {
  if (area === 'frontend') {
    return {
      tier: 'p0-visible-ui',
      label: 'Visible UI candidate',
      reason: 'Frontend source text is likely user-facing in the current app.',
    }
  }

  if (area === 'shared') {
    return {
      tier: 'p1-shared-runtime',
      label: 'Shared runtime candidate',
      reason: 'Shared code can feed frontend or backend output.',
    }
  }

  const lowerFile = file.toLowerCase()
  const lowerText = text.toLowerCase()

  if (lowerFile.includes('/routes/')) {
    return {
      tier: 'p1-api-response-candidate',
      label: 'API response candidate',
      reason: 'Backend route strings can still reach the frontend through errors, validation, or status responses.',
    }
  }

  if (lowerFile.includes('/database/usersettingsbuiltinmodules')) {
    return {
      tier: 'p2-catalog-seed-candidate',
      label: 'Built-in catalog candidate',
      reason: 'Built-in module names/descriptions may be shown if the new frontend still consumes the module catalog.',
    }
  }

  if (lowerFile.includes('/database/migrations/') || lowerFile.includes('/scripts/') || lowerFile.includes('/test') || lowerFile.includes('versioncheck')) {
    return {
      tier: 'p4-dev-internal',
      label: 'Dev/internal only',
      reason: 'Migration, script, test, or developer diagnostic text is unlikely to affect the current frontend.',
    }
  }

  if (/console\.|logger\.|log\(|warn\(|error\(/.test(lowerText) || /시작|완료|로그|스캔/.test(text)) {
    return {
      tier: 'p3-operational-log',
      label: 'Operational log candidate',
      reason: 'Likely process log or operator-facing diagnostic text, not normal app UI.',
    }
  }

  if (feature === 'services' || feature === 'models' || feature === 'utils') {
    return {
      tier: 'p2-backend-runtime-candidate',
      label: 'Backend runtime candidate',
      reason: 'Service/model/utility errors can surface through API failure paths, but many are internal.',
    }
  }

  return {
    tier: 'p3-backend-internal-unknown',
    label: 'Backend internal/unknown',
    reason: 'Backend source text needs route usage or frontend API-flow confirmation before conversion.',
  }
}

function normalizeMessage(text) {
  return compactText(text)
    .replace(/\$\{[^}]+\}/g, '{value}')
    .replace(/\{[^}]+\}/g, '{value}')
    .replace(/`[^`]+`/g, '{value}')
    .replace(/'[^']+'/g, '{value}')
    .replace(/"[^"]+"/g, '{value}')
    .replace(/[A-Z]:[\\/][^\s]+/gi, '{path}')
    .replace(/https?:\/\/\S+/gi, '{url}')
    .replace(/\b\d+(?:\.\d+)?\b/g, '{number}')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildSignature(text) {
  return normalizeMessage(text)
    .toLowerCase()
    .replace(/\{(?:value|number|path|url)\}/g, ' ')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\b(true|false|null|undefined|px|rem|ms|id|url|api)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function countBy(items, getKey) {
  const counts = new Map()
  for (const item of items) {
    const key = getKey(item)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
}

function groupBy(items, getKey) {
  const groups = new Map()
  for (const item of items) {
    const key = getKey(item)
    const group = groups.get(key) ?? []
    group.push(item)
    groups.set(key, group)
  }
  return groups
}

function findingExample(finding) {
  return {
    file: finding.file,
    line: finding.line,
    column: finding.column,
    kind: finding.kind,
    exposure: finding.exposure.tier,
    text: finding.text,
  }
}

function buildExactGroups(findings) {
  return [...groupBy(findings, (finding) => finding.normalizedText).entries()]
    .map(([normalizedText, group]) => ({
      normalizedText,
      count: group.length,
      uniqueTexts: [...new Set(group.map((finding) => finding.text))].slice(0, 12),
      areas: countBy(group, (finding) => finding.area),
      features: countBy(group, (finding) => finding.feature).slice(0, 12),
      exposures: countBy(group, (finding) => finding.exposure.tier).slice(0, 12),
      examples: group.slice(0, MAX_SOURCE_EXAMPLES).map(findingExample),
    }))
    .sort((left, right) => right.count - left.count || left.normalizedText.localeCompare(right.normalizedText))
}

function tokenizeSignature(signature) {
  return new Set(signature.split(/\s+/).filter((token) => token.length >= 2))
}

function jaccard(left, right) {
  if (left.size === 0 && right.size === 0) return 1
  let intersection = 0
  for (const token of left) {
    if (right.has(token)) intersection += 1
  }
  return intersection / (left.size + right.size - intersection)
}

function levenshteinRatio(left, right) {
  if (left === right) return 1
  if (!left || !right) return 0

  const a = left.length <= right.length ? left : right
  const b = left.length <= right.length ? right : left
  const previous = Array.from({ length: a.length + 1 }, (_, index) => index)
  const current = new Array(a.length + 1)

  for (let i = 1; i <= b.length; i += 1) {
    current[0] = i
    for (let j = 1; j <= a.length; j += 1) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      )
    }
    previous.splice(0, previous.length, ...current)
  }

  const distance = previous[a.length]
  return 1 - distance / Math.max(left.length, right.length)
}

function areSimilar(left, right) {
  if (!left.signature || !right.signature) return false
  if (left.signature === right.signature) return true
  if (left.signature.length < 4 || right.signature.length < 4) return false

  const tokenScore = jaccard(left.tokens, right.tokens)
  if (tokenScore >= 0.58) return true

  const ratio = levenshteinRatio(left.signature, right.signature)
  return ratio >= 0.72
}

function buildSimilarGroups(exactGroups) {
  const candidates = exactGroups
    .map((group, index) => ({
      index,
      normalizedText: group.normalizedText,
      signature: buildSignature(group.normalizedText),
      tokens: tokenizeSignature(buildSignature(group.normalizedText)),
      count: group.count,
      uniqueTexts: group.uniqueTexts,
      examples: group.examples,
      features: group.features,
      areas: group.areas,
      exposures: group.exposures,
    }))
    .filter((group) => group.signature.length >= 4)
    .sort((left, right) => right.count - left.count || left.normalizedText.localeCompare(right.normalizedText))

  const used = new Set()
  const clusters = []

  for (let i = 0; i < candidates.length; i += 1) {
    if (used.has(i)) continue
    const seed = candidates[i]
    const members = [seed]
    used.add(i)

    for (let j = i + 1; j < candidates.length; j += 1) {
      if (used.has(j)) continue
      const candidate = candidates[j]
      if (!areSimilar(seed, candidate)) continue
      used.add(j)
      members.push(candidate)
    }

    const totalCount = members.reduce((sum, item) => sum + item.count, 0)
    if (members.length < 2 && totalCount < 3) continue

    clusters.push({
      signature: seed.signature,
      groupCount: members.length,
      totalCount,
      members: members
        .sort((left, right) => right.count - left.count || left.normalizedText.localeCompare(right.normalizedText))
        .slice(0, 16)
        .map((member) => ({
          normalizedText: member.normalizedText,
          count: member.count,
          uniqueTexts: member.uniqueTexts.slice(0, 5),
          examples: member.examples.slice(0, 3),
        })),
    })
  }

  return clusters.sort((left, right) => right.totalCount - left.totalCount || right.groupCount - left.groupCount)
}

function buildOutput(findings) {
  const exactGroups = buildExactGroups(findings)
  const reusableExactGroups = exactGroups.filter((group) => group.count >= 2)
  const similarGroups = buildSimilarGroups(exactGroups)

  return {
    generatedAt: new Date().toISOString(),
    mode: 'english-only-preprocess',
    purpose: 'Find Korean user-facing strings before replacing them with final English copy. Group exact and similar messages so repeated UI/status/error text can be converted consistently.',
    scanTargets: SCAN_TARGETS.map((target) => ({ area: target.area, dir: relativePath(target.dir) })),
    summary: {
      totalFindings: findings.length,
      filesWithFindings: new Set(findings.map((finding) => finding.file)).size,
      uniqueNormalizedMessages: exactGroups.length,
      reusableExactGroups: reusableExactGroups.length,
      similarGroups: similarGroups.length,
    },
    byArea: countBy(findings, (finding) => finding.area).map(([area, count]) => ({ area, count })),
    byExposure: countBy(findings, (finding) => finding.exposure.tier).map(([exposure, count]) => ({ exposure, count })),
    byFeature: countBy(findings, (finding) => `${finding.area}/${finding.feature}`).slice(0, 40).map(([feature, count]) => ({ feature, count })),
    byFile: countBy(findings, (finding) => finding.file).slice(0, 80).map(([file, count]) => ({ file, count })),
    reusableExactGroups,
    similarGroups,
    allFindings: findings,
  }
}

function writeMarkdownReport(output) {
  const lines = []
  lines.push('# English-only Language Preprocess Report')
  lines.push('')
  lines.push(`Generated: ${output.generatedAt}`)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`- Findings: ${output.summary.totalFindings}`)
  lines.push(`- Files with findings: ${output.summary.filesWithFindings}`)
  lines.push(`- Unique normalized messages: ${output.summary.uniqueNormalizedMessages}`)
  lines.push(`- Reusable exact groups: ${output.summary.reusableExactGroups}`)
  lines.push(`- Similar groups: ${output.summary.similarGroups}`)
  lines.push('')
  lines.push('## By Area')
  lines.push('')
  for (const item of output.byArea) lines.push(`- ${item.area}: ${item.count}`)
  lines.push('')
  lines.push('## By Exposure / Priority')
  lines.push('')
  for (const item of output.byExposure) lines.push(`- ${item.exposure}: ${item.count}`)
  lines.push('')
  lines.push('## By Feature / Module')
  lines.push('')
  for (const item of output.byFeature.slice(0, 25)) lines.push(`- ${item.feature}: ${item.count}`)
  lines.push('')
  lines.push('## Top Files')
  lines.push('')
  for (const item of output.byFile.slice(0, 25)) lines.push(`- ${item.file}: ${item.count}`)
  lines.push('')
  lines.push('## Reusable Exact Groups')
  lines.push('')
  for (const group of output.reusableExactGroups.slice(0, MAX_GROUPS_IN_REPORT)) {
    lines.push(`### ${group.normalizedText}`)
    lines.push(`- Count: ${group.count}`)
    lines.push(`- Variants: ${group.uniqueTexts.join(' / ')}`)
    lines.push(`- Exposure: ${group.exposures.map(([exposure, count]) => `${exposure} ${count}`).join(', ')}`)
    lines.push('- Examples:')
    for (const example of group.examples.slice(0, 5)) {
      lines.push(`  - ${example.file}:${example.line} [${example.kind}/${example.exposure}] ${example.text}`)
    }
    lines.push('')
  }
  lines.push('## Similar Message Groups')
  lines.push('')
  for (const cluster of output.similarGroups.slice(0, MAX_GROUPS_IN_REPORT)) {
    lines.push(`### Signature: ${cluster.signature}`)
    lines.push(`- Total occurrences: ${cluster.totalCount}`)
    lines.push(`- Normalized groups: ${cluster.groupCount}`)
    for (const member of cluster.members.slice(0, 8)) {
      lines.push(`  - (${member.count}) ${member.normalizedText}`)
      for (const example of member.examples.slice(0, 2)) {
        lines.push(`    - ${example.file}:${example.line} [${example.exposure}] ${example.text}`)
      }
    }
    lines.push('')
  }
  lines.push('## Suggested English-only Conversion Order')
  lines.push('')
  lines.push('1. Convert p0-visible-ui repeated exact/similar messages first so common UI copy stays consistent.')
  lines.push('2. Convert shell/navigation/settings strings next because they establish global English-only behavior.')
  lines.push('3. Convert the highest-count frontend feature modules one by one, keeping each batch buildable.')
  lines.push('4. Treat backend strings as candidates, not automatic work: p1 API responses first, p2 catalog/runtime only when the current frontend consumes them, p3/p4 logs/scripts last or never.')
  lines.push('5. Keep this report regenerated after each batch to shrink the remaining Korean string inventory.')
  lines.push('')

  fs.writeFileSync(OUTPUT_MD, lines.join('\n'), 'utf8')
}

function main() {
  const findings = []
  for (const target of SCAN_TARGETS) {
    for (const file of walkFiles(target.dir)) {
      const code = fs.readFileSync(file, 'utf8')
      findings.push(...extractStringsFromCode(code, file, target.area))
    }
  }

  const output = buildOutput(findings)
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2), 'utf8')
  writeMarkdownReport(output)

  console.log(`[language-preprocess] Wrote ${relativePath(OUTPUT_JSON)}`)
  console.log(`[language-preprocess] Wrote ${relativePath(OUTPUT_MD)}`)
  console.log(`[language-preprocess] Findings: ${output.summary.totalFindings}; files: ${output.summary.filesWithFindings}; unique: ${output.summary.uniqueNormalizedMessages}; exact reusable: ${output.summary.reusableExactGroups}; similar groups: ${output.summary.similarGroups}`)
}

main()
