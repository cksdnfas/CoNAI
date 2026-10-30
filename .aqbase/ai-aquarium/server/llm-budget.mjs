import { randomUUID, createHash } from 'node:crypto'
import { jsonData } from './llm-json.mjs'
import { budgetText } from '../shared/village-settings.mjs'
import { llmErrorText, llmFailure, admissionRejected, PAYLOAD_LOST } from './llm-errors.mjs'
export { budgetText } from '../shared/village-settings.mjs'

/** Estimate only for selection against a REAL profile context, never an assumed
 * context: CJK/Hangul/kana 1.5 tokens/codepoint; other text 0.3. Host measure wins. */
function tokenUnits(text) {
  let n = 0
  for (const c of text) n += /[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/u.test(c) ? 15 : 3
  return n
}
export function estimateTokens(value) {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)
  return Math.ceil(tokenUnits(text) / 10)
}
export const PURPOSES = Object.freeze({
  talk: [0.65, 0.15, 0.12, 0.08], decision: [0.75, 0.10, 0.10, 0.05],
  gm: [0.55, 0.20, 0.15, 0.10], memory: [0.90, 0, 0.10, 0], research: [1, 0, 0, 0],
})
export const outputCap = (profile, requested) => requested == null
  ? profile?.context?.maxOutputTokens ?? null : Math.min(requested, profile?.context?.maxOutputTokens ?? requested)
export const modernHost = conai => typeof conai?.llm?.measure === 'function'
export const resultDiagnostic = (conai, result, diagnostic) => modernHost(conai) && diagnostic
  ? { ...diagnostic, outputNotice: result?.truncated ? '모델 출력 길이 한도에서 종료됐어. 받은 원문은 보존했어.' : null } : diagnostic
// Only old hosts have plugin-request transport caps. New hosts enforce their
// outer HTTP/worker body and aggregate queue resource limits themselves.
const OLD_TRANSPORT = { message: 16000, history: 32000, schema: 16384 }
const NATIVE_TRANSPORT = { message: Infinity, history: Infinity, schema: Infinity }
export async function resolveBudget(conai, input) {
  const profiles = typeof conai.llm.profiles === 'function' ? await conai.llm.profiles() : []
  const profile = profiles.find(p => p.id === input.profileId)
  const cap = input.model === 'judge' ? input.maxTokens ?? null : outputCap(profile, input.maxTokens)
  return { contextTokens: input.model === 'judge' ? null : profile?.context?.contextTokens ?? null, outputReserve: cap, overhead: 0,
    // The host admits against the native minimum reply allowance, not the entire
    // configured output ceiling. A negative measured `available` alone is valid.
    admissionReserve: cap == null ? 0 : Math.min(cap, 256),
    transport: modernHost(conai) ? NATIVE_TRANSPORT : OLD_TRANSPORT }
}
/** The strict measure schema is NOT the start schema. */
export const measureInput = input => jsonData(Object.fromEntries(
  ['profileId', 'message', 'history', 'userName', 'useLorebooks', 'maxTokens', 'model', 'structuredOutput', 'translation']
    .filter(k => input[k] !== undefined).map(k => [k, input[k]])))
export function selectLines(text, tokens = Infinity, chars = Infinity) {
  const records = Array.isArray(text) ? text : [String(text ?? '')], out = []
  let units = 0, length = 0
  for (let i = records.length - 1; i >= 0; i--) {
    const row = String(records[i]), separator = out.length ? 1 : 0, cost = tokenUnits(row) + separator * 3
    if (!row || units + cost > tokens * 10 || length + row.length + separator > chars) continue
    out.push(row); units += cost; length += row.length + separator
  }
  return out.reverse().join('\n')
}
export const GM_PRUNING = ['recent', 'lore', 'management.relationships', 'management.agentSettings.statusDefs', 'management.agentSettings.actionCatalog',
  'management.art.subjects', 'management.items', 'management.quests', 'management.floors', 'management.npcs',
  'management.constructions', 'management.geometry', 'adventure', 'management.residents', 'management.buildings', 'management.pendingRequests', 'management.agentSettings']
/** Prune whole list entries or sections, not strings inside records. */
export function fitObject(value, { tokens = Infinity, chars = Infinity, bytes = Infinity }, paths = []) {
  const copy = structuredClone(value)
  const cost = text => ({ chars: text.length, bytes: Buffer.byteLength(text), units: tokenUnits(text) })
  const add = (a, b, sign = 1) => { for (const k of ['chars', 'bytes', 'units']) a[k] += sign * b[k] }
  const comma = cost(',')
  const build = (value, parent = null, key = null) => {
    const node = { value, parent, key, alive: true, children: new Map(), keys: [], prefix: parent && !Array.isArray(parent.value) ? cost(`${JSON.stringify(key)}:`) : cost('') }
    if (value === null || typeof value !== 'object') { Object.assign(node, cost(JSON.stringify(value))); return node }
    Object.assign(node, cost(Array.isArray(value) ? '[]' : '{}'))
    for (const key of Object.keys(value)) {
      if (value[key] === undefined) continue
      const child = build(value[key], node, key)
      if (node.children.size) add(node, comma)
      node.children.set(key, child); node.keys.push(key); add(node, child); add(node, child.prefix)
    }
    return node
  }
  const root = build(copy), fits = () => root.units <= tokens * 10 && root.chars <= chars && root.bytes <= bytes
  const remove = node => {
    const parent = node.parent
    const delta = { chars: node.chars, bytes: node.bytes, units: node.units }
    add(delta, node.prefix); if (parent.children.size > 1) add(delta, comma)
    parent.children.delete(node.key); node.alive = false
    if (Array.isArray(parent.value)) parent.value.pop()
    else delete parent.value[node.key]
    for (let n = parent; n; n = n.parent) add(n, delta, -1)
  }
  const last = node => { while (node.keys.length && !node.children.has(node.keys.at(-1))) node.keys.pop(); return node.children.get(node.keys.at(-1)) }
  for (const path of paths) {
    if (fits()) break
    const node = path.split('.').reduce((n, key) => n?.children.get(key), root)
    if (!node) continue
    while (!fits() && Array.isArray(node.value) && node.children.size) remove(last(node))
    if (!fits()) remove(node)
  }
  const arrays = []
  const collect = node => {
    if (Array.isArray(node.value)) { arrays.push(node); return }
    const children = [...node.children.values()].reverse()
    for (const n of children) if (Array.isArray(n.value)) arrays.push(n)
    for (const n of children) if (!Array.isArray(n.value)) collect(n)
  }
  collect(root)
  const live = node => node.alive && (!node.parent || live(node.parent))
  let at = 0
  while (!fits()) {
    while (at < arrays.length && (!live(arrays[at]) || !arrays[at].children.size)) at++
    const child = at < arrays.length ? last(arrays[at]) : last(root)
    if (!child) throw new Error('필수 자료가 호스트 전송/프로필 문맥 한도보다 커.')
    remove(child)
  }
  return copy
}
// Only builders mark optional data. Unmarked JSON-looking player/scene text is
// required, never inferred to be disposable because of its contents.
const DATA = '\u001e'
export const dataLine = value => DATA + JSON.stringify(value)
export function messageParts(message) {
  return String(message ?? '').split('\n').map(text => {
    if (text.startsWith(DATA)) {
      try { return { value: JSON.parse(text.substring(DATA.length)) } } catch { /* plain required text */ }
    }
    return { text }
  })
}
export function budgetInput(input, { purpose = 'talk', recent = input.history ?? '', personal = [], world = [] } = {}) {
  return { ...input, _budget: { purpose, recent, personal, world } }
}
export function fitPrompt(input, limits, shrinks = 0) {
  const meta = input._budget ?? {}, ratios = PURPOSES[meta.purpose] ?? PURPOSES.talk
  const request = Object.fromEntries(Object.entries(input).filter(([k, v]) => !k.startsWith('_') && v !== undefined))
  const parts = messageParts(request.message), fixed = parts.filter(p => p.text !== undefined).map(p => p.text).join('\n')
  const schema = estimateTokens(request.structuredOutput), overhead = limits.overhead ?? 0
  const transport = limits.transport ?? OLD_TRANSPORT
  const reserve = limits.admissionReserve ?? limits.outputReserve ?? 0
  if (request.structuredOutput !== undefined && Number.isFinite(transport.schema) &&
    Buffer.byteLength(typeof request.structuredOutput === 'string' ? request.structuredOutput : JSON.stringify(request.structuredOutput)) > transport.schema) throw new Error('이전 호스트의 출력 스키마 전송 한도를 넘었어. 호스트를 업데이트해줘.')
  const known = limits.contextTokens != null
  const fixedTokens = limits.fixedTokens ?? overhead + schema + estimateTokens(fixed)
  const room = known ? Math.floor(limits.contextTokens - reserve - fixedTokens) : Infinity
  const recentRecords = meta.recent ?? request.history ?? ''
  const fullHistory = [...(Array.isArray(recentRecords) ? recentRecords : [recentRecords]), ...(meta.personal ?? []), ...(ratios[3] ? meta.world ?? [] : [])].join('\n')
  const dataTokens = parts.reduce((n, p) => n + (p.value === undefined ? 0 : estimateTokens(p.value) + 1), 0)
  const optionalTokens = dataTokens + estimateTokens(fullHistory) + 1
  const scale = limits.optionalScale ?? 1
  const constrained = scale < 1 || known && optionalTokens > room
  const allowance = Math.floor(Math.min(room, optionalTokens) * scale)
  const fixedChars = parts.reduce((n, p) => n + (p.text?.length ?? 0), 0) + Math.max(0, parts.length - 1)
  if (room < 0) throw new Error('문맥이 모델 한도를 넘었어. 필수 지시만으로 프로필 문맥보다 커. 원문은 보존했어.')
  if (fixedChars > transport.message) throw new Error('요청 본문이 호스트 전송 한도를 넘었어. 이전 호스트에 보낼 필수 지시가 너무 커. 원문은 보존했어.')
  const historyNeeds = [estimateTokens(Array.isArray(recentRecords) ? recentRecords.join('\n') : recentRecords),
    estimateTokens((meta.personal ?? []).join('\n')), estimateTokens((meta.world ?? []).join('\n'))]
  const historyAllowance = constrained ? historyNeeds.reduce((n, need, i) => n + Math.min(need, allowance * ratios[i + 1]), 0) : 0
  let taskRoom = constrained ? Math.floor(allowance - historyAllowance) : room, chars = transport.message - fixedChars
  for (const p of parts) if (p.value !== undefined) {
    if (taskRoom < 2 || chars < 2) { p.text = ''; delete p.value; continue }
    p.value = fitObject(p.value, { tokens: taskRoom, chars }, meta.purpose === 'gm' ? GM_PRUNING : [])
    taskRoom -= estimateTokens(p.value); chars -= JSON.stringify(p.value).length
  }
  request.message = parts.map(p => p.text ?? JSON.stringify(p.value)).join('\n')
  let remaining = Math.max(0, (constrained ? allowance : room) - estimateTokens(request.message) + estimateTokens(fixed)), historyChars = 0
  const history = []
  const append = (rows, allowance) => {
    for (const row of rows) {
      const cost = estimateTokens(row) + 1
      const length = row.length + (history.length ? 1 : 0)
      if (cost <= allowance && cost <= remaining && historyChars + length <= transport.history) { history.push(row); historyChars += length; allowance -= cost; remaining -= cost }
    }
  }
  const recent = selectLines(recentRecords, constrained ? Math.min(remaining, allowance * ratios[1]) : remaining, transport.history)
  if (recent) append([recent], remaining)
  append(meta.personal ?? [], constrained ? allowance * ratios[2] : remaining)
  if (ratios[3]) append(meta.world ?? [], constrained ? allowance * ratios[3] : remaining)
  if (history.length || Object.hasOwn(input, 'history')) request.history = history.join('\n')
  // `inputSize`, not `inputTokens`: diagnostics reach the page state, where the host refuses keys containing "token".
  const diagnostics = { inputSize: fixedTokens + estimateTokens(request.message) - estimateTokens(fixed) + estimateTokens(request.history),
    outputReserve: limits.outputReserve, contextTokens: limits.contextTokens, shrinks, timeoutMs: request.timeoutMs }
  return { request, diagnostics }
}
/** No maxTokens is invented. Unknown context is sent as-is except the host's
 * old-host transport bounds. A known overflow shrinks at most twice, with a fresh ID after
 * 413. Retry state survives uncertain admission so rejected payloads aren't replayed. */
export async function startBudgeted(conai, input, { purpose, onDiagnostic = () => {}, invoke = call => call() } = {}) {
  if (input._budget?.payloadLost) throw Object.assign(new Error(PAYLOAD_LOST), { terminal: true, noModelCall: true })
  const source = input._budget ? input : budgetInput(input, { purpose })
  input._budget ??= source._budget
  const limits = await resolveBudget(conai, input)
  limits.admissionReserve = Math.max(limits.admissionReserve, source._budget.answerRoom ?? input._answerRoom ?? 0)
  const meta = source._budget, retry = meta.retry ??= { shrinks: 0, scale: 1, requestId: input.requestId }
  const sourceHash = createHash('sha256').update(JSON.stringify({
    input: Object.fromEntries(Object.entries(source).filter(([key]) => !key.startsWith('_'))),
    recent: meta.recent, personal: meta.personal, world: meta.world, answerRoom: meta.answerRoom,
  })).digest('hex')
  if (meta.delivery?.sourceHash && meta.delivery.sourceHash !== sourceHash) {
    meta.delivery.rejected = true; retry.shrinks = 0; retry.scale = 1; retry.transportShrink = false
  }
  let diagnostics = meta.diagnostics, fitMeasured = false
  const report = () => {
    if (diagnostics) { diagnostics = { ...diagnostics, shrinks: retry.shrinks, retry: { ...retry } }; meta.diagnostics = diagnostics; onDiagnostic(diagnostics) }
  }
  try {
    for (;;) {
      let request = meta.delivery && !meta.delivery.rejected ? structuredClone(meta.delivery.request) : null
      if (!request) {
        const canMeasure = source.mode !== 'profile' && modernHost(conai)
        const fitted = fitPrompt(source, { ...limits, contextTokens: canMeasure && !fitMeasured ? null : limits.contextTokens,
          optionalScale: retry.scale }, retry.shrinks)
        request = { ...fitted.request, requestId: retry.requestId }
        diagnostics = { ...fitted.diagnostics, contextTokens: limits.contextTokens }
        if (source._outputKind === 'look') diagnostics.subjectIds = messageParts(source.message).flatMap(p => Array.isArray(p.value) ? p.value.filter(v => request.message.includes(JSON.stringify(v))).map(v => v.id) : [])
        if (canMeasure) {
          let measured
          try { measured = await conai.llm.measure(measureInput(request)) }
          catch (error) {
            if (llmFailure(error).category !== 'transport' || retry.transportShrink) throw error
            retry.transportShrink = true; retry.scale *= 0.5; report(); continue
          }
          limits.contextTokens = measured.contextTokens
          diagnostics = { ...diagnostics, inputSize: measured.inputTokens, outputReserve: limits.outputReserve, contextTokens: measured.contextTokens }
          if (measured.contextTokens != null && measured.inputTokens + limits.admissionReserve > measured.contextTokens) {
            if (retry.shrinks >= 2) throw new Error('문맥이 모델 한도를 넘었어. 필수 지시/프로필 문맥을 확인해줘.')
            const required = fitPrompt(source, { ...limits, contextTokens: null, optionalScale: 0 }).request
            const fixed = await conai.llm.measure(measureInput(required))
            limits.fixedTokens = fixed.inputTokens; fitMeasured = true
            retry.shrinks++; retry.scale = retry.shrinks === 1 ? 1 : retry.scale * 0.6
            report(); continue
          }
        }
        const fingerprint = createHash('sha256').update(JSON.stringify({ ...request, requestId: '' })).digest('hex')
        if (meta.delivery?.rejected && fingerprint === meta.delivery.fingerprint) {
          if (!retry.transportShrink && retry.shrinks < 2) { retry.shrinks++; retry.scale *= 0.6; continue }
          throw new Error(`${retry.transportShrink ? '요청 본문이 호스트 전송 한도를 넘었어.' : '문맥이 모델 한도를 넘었어.'} 더 줄일 선택 자료가 없어.`)
        }
        if (meta.delivery && fingerprint !== meta.delivery.fingerprint) request.requestId = retry.requestId = `budget:${randomUUID()}`
        meta.delivery = { request: structuredClone(request), sourceHash, fingerprint, rejected: false, diagnostics: structuredClone(diagnostics) }
      } else {
        diagnostics = meta.delivery.diagnostics
      }
      // Persist the exact payload before admission. Uncertain response loss
      // replays these bytes, never a new fit under the old identity.
      report()
      try {
        const job = await invoke(async () => {
          try { return await conai.llm.start(jsonData(request)) }
          catch (error) { if (admissionRejected(error)) error.noModelCall = true; throw error }
        })
        if (job?.jobId) {
          // The host owns the acknowledged payload now. Only uncertain start
          // responses need the replay snapshot, never running/completed jobs.
          delete input._budget
          delete input.history
        }
        return job && { ...job, budget: diagnostics }
      } catch (error) {
        const category = llmFailure(error).category
        if (!['context', 'transport'].includes(category)) throw error
        meta.delivery.rejected = true
        if (category === 'transport') {
          if (retry.transportShrink) throw error
          retry.transportShrink = true; retry.scale *= 0.5
        } else {
          if (limits.contextTokens == null || retry.shrinks >= 2) throw error
          retry.shrinks++; retry.scale = retry.shrinks === 1 ? 1 : retry.scale * 0.6
          if (modernHost(conai) && source.mode !== 'profile') {
            const required = fitPrompt(source, { ...limits, contextTokens: null, optionalScale: 0 }).request
            const fixed = await conai.llm.measure(measureInput(required))
            limits.contextTokens = fixed.contextTokens; limits.fixedTokens = fixed.inputTokens; fitMeasured = true
          }
        }
        report()
      }
    }
  } catch (error) {
    report()
    throw Object.assign(new Error(`${llmErrorText(error)}${diagnostics ? ` (${budgetText(diagnostics)})` : ''}`),
      { status: error?.status ?? error?.statusCode })
  }
}
