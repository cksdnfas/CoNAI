import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import { JSDOM } from 'jsdom'
import * as domain from '../../plugins/video-canvas/domain.mjs'
import * as publication from '../../plugins/video-canvas/assistant-state.mjs'
import { copyChatPageData } from '../../shared/src/utils/chatPageAction'

type PageHandler = (args: Record<string, unknown>, context: { signal: AbortSignal }) => unknown | Promise<unknown>
type Snapshot = { data: Record<string, unknown> }
type PageRequest =
  | { op: 'list_projects' }
  | { op: 'read_canvas'; full?: boolean; project_id?: string }
  | { op: 'read_node'; id: string }
  | { op: 'apply_ops'; ops: Record<string, unknown>[]; expected_revision: number }
  | { op: 'save_profile'; profile: Record<string, unknown>; origin?: string }
  | { op: 'save_settings'; settings: Record<string, string | null> }
  | { op: 'run_cut'; expected_revision: number; mode?: string; input_digest?: string; action?: string; take_id?: string }
  | { op: 'workflow_options' }
  | { op: 'check' | 'extract_frame' }
// The fake hosts answer any page request; their bodies are read loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServerBody = { op: string } & Record<string, any>
/** excerpt's options as inferred from its JS default parameters; page requests are cast to it. */
type Excerpt = Parameters<typeof publication.excerpt>[1]
const section = <T>(data: Record<string, unknown>, name: string) => (data[name] as { data: T }).data
const pluginRoot = fileURLToPath(new URL('../../plugins/video-canvas', import.meta.url))
/** Runs the page in a JSDOM window with `api` as its SDK connection and resolves with the page actions it registered. */
async function bootPage(dom: JSDOM, api: unknown) {
  const handlers: Record<string, PageHandler> = {}
  class Observer { observe() {} unobserve() {} disconnect() {} }
  const sandbox = vm.createContext({
    ...domain, ...publication, document: dom.window.document, window: dom.window, Event: dom.window.Event,
    CSS: { escape: (id: string) => id }, IntersectionObserver: Observer, ResizeObserver: Observer,
    requestAnimationFrame: (fn: () => void) => { fn(); return 0 }, crypto: { randomUUID },
    AbortController, structuredClone, console, setTimeout, clearTimeout,
    connectPlugin: async (actions: Record<string, PageHandler>) => { Object.assign(handlers, actions); return api },
  })
  // Package builds inject the SDK and the browser resolves the page's ES modules. Resolve both in memory: each
  // module becomes a function scope returning its exports, and main.js runs last with the SDK and domain as globals.
  const modules = ['util', 'state', 'ink', 'toast', 'menu', 'session', 'viewport', 'nodes', 'dialogs', 'workflow', 'settings', 'actions', 'inspector', 'sequence', 'home', 'links', 'canvas', 'dispatch']
  const link = (source: string) => source.split('\n').flatMap(line => {
    const imported = /^import \{(.+)\} from '\.\/(\w+)\.mjs'$/.exec(line)
    if (!imported) return line.startsWith('import ') ? [] : [line]
    return modules.includes(imported[2]) ? [`const {${imported[1]}} = __m.${imported[2]};`] : []
  }).join('\n')
  const bundle = modules.map(name => {
    const source = fs.readFileSync(path.join(pluginRoot, `${name}.mjs`), 'utf8')
    const exported = [...source.matchAll(/^export (?:async )?(?:function|const|let|class) (\w+|\$)/gm)].map(match => match[1])
    return `__m.${name} = (() => {\n${link(source).replace(/^export /gm, '')}\nreturn { ${exported.join(', ')} }\n})()`
  }).join('\n')
  const source = link(fs.readFileSync(path.join(pluginRoot, 'main.js'), 'utf8'))
  await vm.runInContext(`(async () => { const __m = {};\n${bundle}\n${source}\n })()`, sandbox)
  return handlers
}

test('video canvas publishes page-action outcomes when return values are discarded and locks double-click runs', { timeout: 15000 }, async t => {
  const dom = new JSDOM(fs.readFileSync(path.join(pluginRoot, 'index.html'), 'utf8'), { url: 'http://localhost/' })
  t.after(() => dom.window.close())
  let project = domain.applyOps(domain.newProject('project', '영상'), [{ op: 'add_node', kind: 'cut', seed: 42 }], 0, randomUUID).project
  project.profiles.push({ id: 'draft', label: '초안', workflowId: 12, directorFieldId: 'director', seedFieldId: 'seed', overrides: {} })
  project.nodes[0].data.profileId = 'draft'
  // The account's settings library rides on every project read.
  Object.assign(project, { settings: { cutProfileId: 'draft', upscaleProfileId: null } })
  const otherProject = domain.newProject('other-project', '다른 영상')
  const cut = project.nodes[0], snapshots: Snapshot[] = [], handlers: Record<string, PageHandler> = {}, events = new Map<string, (event: unknown) => void>()
  let calls = 0, release!: () => void, entered!: () => void, published!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { entered = resolve })
  const completed = new Promise<void>(resolve => { published = resolve })
  const currentDigest = () => String(project.revision).padStart(64, '0')
  const nodeDetail = (id: string) => ({ revision: project.revision, node: domain.nodeOf(project, id), preview: { inputDigest: currentDigest() }, edges: project.edges, takes: project.takes, nextEdgeCursor: null, nextTakeCursor: null })
  const snapshotWaiters = new Set<{ matches: (snapshot: Snapshot) => boolean; resolve: () => void }>()
  const whenPublished = (matches: (snapshot: Snapshot) => boolean) => new Promise<void>(resolve => { snapshotWaiters.add({ matches, resolve }) })
  const api = {
    supports: () => false,
    storage: { get: async () => ({ value: null }), set: async () => ({}) },
    events: { on(name: string, fn: (event: unknown) => void) { events.set(name, fn) } },
    publish(snapshot: Snapshot) {
      assert.ok(JSON.stringify(snapshot).length <= 200000)
      copyChatPageData(JSON.parse(JSON.stringify(snapshot.data)))
      snapshots.push(JSON.parse(JSON.stringify(snapshot)))
      if ((snapshot.data.lastRun as { summary?: { status?: string } } | undefined)?.summary?.status === 'queued' || snapshot.data.lastError) published()
      for (const waiter of snapshotWaiters) if (waiter.matches(snapshot)) { snapshotWaiters.delete(waiter); waiter.resolve() }
    },
    async server(body: PageRequest) {
      if (body.op === 'list_projects') return { projects: [project, otherProject].map(item => ({ id: item.id, name: item.name, nodeCount: item.nodes.length })), nextOffset: null }
      if (body.op === 'read_canvas') {
        const current = body.project_id === otherProject.id ? otherProject : project
        // JS default-parameter inference narrows excerpt's options to { cursor?, selection?: never[], launch?: null }.
        return body.full ? structuredClone(current) : publication.excerpt(current, body as Excerpt)
      }
      if (body.op === 'workflow_options') return { workflows: [], servers: [], tags: [], profiles: [], settings: {} }
      if (body.op === 'read_node') return nodeDetail(body.id)
      if (body.op === 'apply_ops') {
        const result = domain.applyOps(project, body.ops, body.expected_revision, randomUUID)
        project = result.project
        return { revision: result.revision, applied: result.applied, rejected: result.rejected, tempIds: result.tempIds }
      }
      // The library belongs to the account: saving a setting names no project and moves no revision.
      if (body.op === 'save_profile') {
        project.profiles[0] = domain.validateProfile(body.profile, { input_schema: [
          { id: 'director', type: 'node', node_editor: 'minimax_h3_director_dasiwa' },
          { id: 'seed', type: 'number', seed_rule: 'explicit' },
        ] })
        // As the server answers: an assistant gets the setting already published (with its role), a person the stored object.
        const shown = body.origin === 'assistant' ? { ...domain.profilePublication(project.profiles[0]), role: domain.roleOf(project.profiles[0]) } : structuredClone(project.profiles[0])
        return { profile: shown, profileId: project.profiles[0].id, settings: structuredClone(project.settings) }
      }
      if (body.op === 'save_settings') {
        Object.assign(project.settings, body.settings)
        return { settings: structuredClone(project.settings) }
      }
      if (body.op === 'check') return { assets: {}, cuts: [{ id: cut.id, ...domain.checkCut(project, project.nodes[0]) }], revision: project.revision }
      if (body.op === 'run_cut') {
        calls++; entered(); await gate
        if (body.action === 'upscale') {
          const upscale = { id: 'upscale-one', takeId: 'upscale-one', cutId: cut.id, upscaleOf: body.take_id, seed: 7, status: 'queued', profile: project.profiles[0] }
          project.takes.push(upscale)
          return upscale
        }
        if (body.expected_revision !== project.revision || body.mode === 'propose' && body.input_digest !== currentDigest()) return { ok: false, status: 409, error: '409: edit-then-run used stale inputs' }
        const id = calls === 1 ? 'take-one' : 'proposal-two'
        const take = { id, takeId: id, cutId: cut.id, seed: project.nodes[0].data.seed, status: body.mode === 'propose' ? 'proposed' : 'queued', profile: project.profiles[0],
          resolved: { prompt: '보낼 장면', table: [{ name: '기준', label: '<Picture 1>' }] }, checks: { blocked: false, errors: [], warnings: [] }, inputDigest: 'd'.repeat(64) }
        project.takes.push(take)
        return take
      }
      if (body.op === 'extract_frame') {
        const item = { id: 'extract-one', status: 'completed', jobId: 'frame-job', nodeIds: ['frame-one'], resultHashes: ['a'.repeat(32)] }
        project.extractions.push(item)
        return item
      }
      throw new Error(`Unexpected page request: ${JSON.stringify(body)}`)
    },
  }
  Object.assign(handlers, await bootPage(dom, api))
  const act = async (id: string, args: Record<string, unknown> = {}) => { await handlers[`video-canvas.${id}`](args, { signal: new AbortController().signal }); return snapshots.at(-1)!.data }
  let data = await act('read', {})
  assert.equal(section<{ nodes: { id: string }[] }>(data, 'lastRead').nodes[0].id, cut.id)
  data = await act('read_node', { id: cut.id })
  assert.equal(section<{ preview: { inputDigest: string } }>(data, 'lastNode').preview.inputDigest, '0'.repeat(63) + '1')
  await act('select', { project_id: project.id, id: cut.id })
  const prompt = dom.window.document.querySelector<HTMLTextAreaElement>('[data-field="prompt"]')!
  prompt.value = '방금 편집한 장면'
  prompt.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  const runButton = () => dom.window.document.querySelector<HTMLButtonElement>('.vc-node [data-action="run"]')!
  runButton().click()
  runButton().click()
  await started
  assert.equal(calls, 1)
  assert.equal(runButton().disabled, true)
  release(); await completed
  assert.equal(snapshots.at(-1)!.data.lastError, undefined, 'pending prompt edits must settle before reading the run revision')
  // The queued handler finishes its reload after publishing the result.
  await act('read', { section: 'lastRun' })
  data = snapshots.at(-1)!.data
  const run = section<{ takeId: string; seed: number; resolved: { table: { label: string }[] } }>(data, 'lastRun')
  assert.equal(run.takeId, 'take-one')
  assert.equal(run.seed, 42)
  assert.equal(run.resolved.table[0].label, '<Picture 1>')
  await act('select', { id: cut.id })
  dom.window.document.getElementById('toggle-inspector')!.click() // the detail panel starts closed
  const seed = dom.window.document.querySelector<HTMLInputElement>('[data-field="seed"]')!
  seed.value = '43'
  seed.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  const proposed = whenPublished(snapshot => (snapshot.data.lastRun as { summary?: { status?: string } } | undefined)?.summary?.status === 'proposed' || Boolean(snapshot.data.lastError))
  // 제안으로 올리기 sits in the detail head's menu.
  dom.window.document.querySelector<HTMLButtonElement>('#insp-top [data-imenu="node"]')!.click()
  ;[...dom.window.document.querySelectorAll<HTMLButtonElement>('#menu [role=menuitem]')].find(item => item.textContent === '제안으로 올리기')!.click()
  await proposed
  assert.equal(snapshots.at(-1)!.data.lastError, undefined, 'pending seed edits must settle before reading the proposal digest')
  assert.equal(section<{ seed: number }>(snapshots.at(-1)!.data, 'lastRun').seed, 43)
  await act('select', { id: cut.id })
  const assistantRevision = section<{ revision: number }>(await act('read_node', { id: cut.id }), 'lastNode').revision
  const humanPrompt = dom.window.document.querySelector<HTMLTextAreaElement>('[data-field="prompt"]')!
  humanPrompt.value = '어시스턴트 조회 뒤 사람의 편집'
  humanPrompt.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  const takesBeforeStaleRuns = project.takes.length
  for (const args of [{}, { take_id: 'take-one', inputs: 'take' }]) {
    await assert.rejects(() => act('run_cut', { cut_id: cut.id, expected_revision: assistantRevision, ...args }), /409/)
    assert.equal(section<{ status: number }>(snapshots.at(-1)!.data, 'lastError').status, 409)
  }
  assert.equal(project.takes.length, takesBeforeStaleRuns)
  data = await act('edit', { profile_json: JSON.stringify({
    ...project.profiles[0], unknown_token: 'not a profile field', overrides: { prompt_enhancer_token_limit: 12000 },
  }) })
  const publishedProfile = section<{ profiles: { overrides: string; role: string; unknown_token?: unknown }[] }>(data, 'lastEdit').profiles[0]
  assert.deepEqual(JSON.parse(publishedProfile.overrides), { prompt_enhancer_token_limit: 12000 })
  assert.equal(publishedProfile.role, 'cut')
  assert.equal(publishedProfile.unknown_token, undefined)
  // Defaults and upscale are the same page actions: settings_json needs no revision, run_cut takes action upscale.
  data = await act('edit', { settings_json: JSON.stringify({ upscaleProfileId: 'draft' }) })
  assert.equal(section<{ settings: { upscaleProfileId: string } }>(data, 'lastEdit').settings.upscaleProfileId, 'draft')
  await act('run_cut', { cut_id: cut.id, expected_revision: project.revision, action: 'upscale', take_id: 'take-one' })
  // The queued handler finishes its reload after publishing the result.
  data = await act('read', { section: 'lastRun' })
  // The profile's own setting key `prompt_enhancer_token_limit` makes the host reject the plain object, so the result is published as a JSON string.
  const upscale = JSON.parse(JSON.parse((data.lastRun as { json: string }).json)) as { takeId: string; upscaleOf: string }
  assert.equal(upscale.upscaleOf, 'take-one')
  await assert.rejects(() => act('edit', { expected_revision: project.revision, ops: JSON.stringify([
    { op: 'add_node', kind: 'cut', tempId: 'token-shot' },
    { op: 'connect', from: 'token-shot', to: cut.id, port: 'start' },
  ]) }), /1건 적용, 1건 거절/)
  data = snapshots.at(-1)!.data
  const edit = section<{ tempIds: { tempId: string; id: string }[]; applied: unknown[]; rejected: unknown[] }>(data, 'lastEdit')
  assert.ok(edit.tempIds.find(entry => entry.tempId === 'token-shot')?.id)
  assert.equal(edit.applied.length, 1)
  assert.equal(edit.rejected.length, 1)
  data = await act('check', {})
  assert.equal(section<{ cuts: { blocked: boolean }[] }>(data, 'lastCheck').cuts[0].blocked, false)
  data = await act('extract_frame', { take_id: 'take-one', expected_revision: project.revision })
  assert.equal(section<{ id: string }>(data, 'lastExtraction').id, 'extract-one')
  assert.equal(section<{ resultHashes: string[] }[]>(data, 'pendingExtractions')[0].resultHashes[0], 'a'.repeat(32))
  const projects = section<{ id: string; name: string; nodeCount: number }[]>(data, 'projects')
  assert.equal(projects.find(item => item.id === otherProject.id)?.nodeCount, 0)
  data = await act('select', { project_id: projects.find(item => item.name === '다른 영상')!.id })
  assert.equal(data.projectId, otherProject.id)
  assert.equal(section<{ id: string }[]>(data, 'projects').length, 2)
})

test('video canvas detail panel groups inputs by slot, edits the prompt in its tabs and keeps its place across redraws', { timeout: 15000 }, async t => {
  const dom = new JSDOM(fs.readFileSync(path.join(pluginRoot, 'index.html'), 'utf8'), { url: 'http://localhost/' })
  t.after(() => dom.window.close())
  const doc = dom.window.document, hash = (char: string) => char.repeat(32), library = (char: string) => ({ source: 'library', compositeHash: hash(char) })
  let project = domain.applyOps(domain.newProject('project', '영상'), [
    { op: 'add_node', kind: 'cut', name: '앞', tempId: 'a' },
    { op: 'add_node', kind: 'cut', name: '뒤', tempId: 'b', fields: { mode: 'REF2VA', prompt: 'A B' } },
    { op: 'add_node', kind: 'image', name: '크림', ref: library('c'), tempId: 'cream' },
    { op: 'add_node', kind: 'image', name: '포즈', ref: library('d'), tempId: 'pose' },
    { op: 'add_node', kind: 'frame', name: '앞 마지막 프레임', ref: library('e'), tempId: 'frame' },
    { op: 'connect', from: 'cream', to: 'b', port: 'ref_image' },
  ], 0, randomUUID).project
  const [a, b, , pose, frame] = project.nodes
  Object.assign(project, { settings: { cutProfileId: null, upscaleProfileId: null } })
  // Cut B continues from A's take among its reference images, and still has an image on the end slot REF2VA ignores.
  frame.data.origin = { nodeId: null, takeId: 'ta', position: 'last' }
  project.edges.push({ id: 'e-frame', from: frame.id, to: b.id, port: 'ref_image', position: 1, props: {} }, { id: 'e-pose', from: pose.id, to: b.id, port: 'end', position: 0, props: {} })
  project.takes = [
    { id: 'ta', cutId: a.id, status: 'completed', resultHash: hash('f'), seed: 1 },
    { id: 'tb1', cutId: b.id, status: 'completed', resultHash: hash('1'), seed: 7, jobId: 'job-7', resolved: { prompt: 'A B', table: [] } },
    { id: 'tb2', cutId: b.id, status: 'failed', seed: 8, error: 'CUDA out of memory' },
  ]
  const requests: string[] = []
  const api = {
    supports: () => false,
    storage: { get: async () => ({ value: null }), set: async () => ({}) },
    events: { on() {} },
    publish() {},
    async server(body: ServerBody) {
      requests.push(body.op)
      if (body.op === 'list_projects') return { projects: [{ id: project.id, name: project.name, nodeCount: project.nodes.length }], nextOffset: null }
      if (body.op === 'read_canvas') return body.full ? structuredClone(project) : publication.excerpt(project, body as Excerpt)
      if (body.op === 'workflow_options') return { workflows: [], servers: [], tags: [], profiles: [], settings: {} }
      if (body.op === 'read_node') return { revision: project.revision, node: domain.nodeOf(project, body.id), preview: { inputDigest: '0'.repeat(64) }, edges: project.edges, takes: project.takes, nextEdgeCursor: null, nextTakeCursor: null }
      if (body.op === 'apply_ops') {
        const result = domain.applyOps(project, body.ops, body.expected_revision, randomUUID)
        project = result.project
        return { revision: result.revision, applied: result.applied, rejected: result.rejected, tempIds: result.tempIds }
      }
      if (body.op === 'get_take') return project.takes.find((take: { id: string }) => take.id === body.take_id)
      throw new Error(`Unexpected page request: ${JSON.stringify(body)}`)
    },
  }
  const handlers = await bootPage(dom, api)
  const act = (id: string, args: Record<string, unknown> = {}) => handlers[`video-canvas.${id}`](args, { signal: new AbortController().signal })
  const until = async (check: () => boolean, what: string) => { for (let index = 0; index < 400 && !check(); index++) await new Promise(resolve => setTimeout(resolve, 5)); assert.ok(check(), what) }
  const key = (el: Element, name: string) => el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
  const body = () => doc.getElementById('insp-body')!, top = () => doc.getElementById('insp-top')!
  const cutB = () => project.nodes.find((node: { id: string }) => node.id === b.id)
  await act('select', { project_id: project.id, id: b.id })
  doc.getElementById('toggle-inspector')!.click()
  // The page runs in a sandbox without allow-forms.
  assert.equal(doc.querySelector('form'), null)
  assert.equal(top().querySelector('h2')!.textContent, '뒤')
  // One text button in the head: the failed latest take is generated again.
  assert.deepEqual([...top().querySelectorAll('button:not(.conai-icon-button)')].map(button => [button.textContent, button.getAttribute('data-action')]), [['다시 생성', 'retry']])

  // Inputs are grouped by slot; the continuation frame is marked; the end image REF2VA ignores sits in the unused group with a move to the reference images.
  const group = (port: string) => body().querySelector(`#insp-port-${port}`)?.closest('.vc-port')
  const titles = (port: string) => [...group(port)!.querySelectorAll('.vc-in .conai-row-title')].map(el => el.textContent)
  assert.deepEqual(titles('ref_image'), ['크림', '앞 · 마지막'])
  assert.match(group('ref_image')!.querySelector('.vc-port-head')!.textContent!, /2\/9/)
  assert.ok(group('ref_image')!.querySelector('.vc-mark'))
  assert.ok(!group('start'), 'REF2VA uses no start slot')
  assert.equal(body().querySelector('[data-action="continue-prev"]'), null, 'a continued cut offers no 앞 컷에서 이어가기 row')
  const unused = body().querySelector('details.vc-unused')!
  assert.match(unused.querySelector('summary')!.textContent!, /안 쓰는 연결 1/)
  const move = unused.querySelector<HTMLButtonElement>('[data-action="move-link"]')!
  assert.equal(move.getAttribute('aria-label'), '참조 이미지로 옮기기')
  move.click()
  await until(() => !body().querySelector('details.vc-unused'), 'the moved image leaves the unused group')
  assert.deepEqual(titles('ref_image'), ['크림', '앞 · 마지막', '포즈'])
  assert.equal(project.edges.find((edge: { from: string }) => edge.from === pose.id).port, 'ref_image')
  assert.equal(cutB().data.prompt, 'A B', 'moving a link writes nothing into the prompt')

  // The prompt field: three text tabs, the chosen one with its panel.
  const tabs = () => [...body().querySelectorAll<HTMLButtonElement>('[role=tablist] [role=tab]')]
  const field = () => body().querySelector<HTMLTextAreaElement>('textarea[data-field="prompt"]')!
  assert.deepEqual(tabs().map(tab => [tab.dataset.ptab, tab.getAttribute('aria-selected'), tab.tabIndex]), [['prompt', 'true', 0], ['raw', 'false', -1], ['sent', 'false', -1]])
  assert.equal(body().querySelector('[role=tabpanel]')!.getAttribute('aria-labelledby'), 'insp-ptab-prompt')
  // A chip goes in at the caret, spaced from the words around it, keeps the focus and saves; with a selection it replaces it.
  field().focus(); field().setSelectionRange(1, 1)
  const chip = (name: string) => body().querySelector<HTMLButtonElement>(`.vc-tokens [data-token="${name}"]`)!
  assert.equal(chip('크림').dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true })), false, 'a chip takes no focus from the field')
  chip('크림').click()
  assert.equal(field().value, 'A @크림 B')
  assert.equal(doc.activeElement, field())
  assert.equal(field().selectionStart, 5)
  await until(() => cutB().data.prompt === 'A @크림 B', 'the chip saves the prompt')
  assert.equal(doc.activeElement, field(), 'the redraw after the save keeps the focus in the field')
  field().setSelectionRange(6, 7)
  chip('포즈').click()
  await until(() => cutB().data.prompt === 'A @크림 @포즈 ', 'a chip replaces the selection')
  // From the keyboard the chip has the focus: the caret the field had when it lost it is used.
  field().focus(); field().setSelectionRange(0, 0)
  chip('크림').focus()
  chip('크림').click()
  await until(() => cutB().data.prompt === '@크림 A @크림 @포즈 ', 'a chip pressed from the keyboard goes in at the caret the field had')

  // Each input row's label is a chip for its @name; one the sent text never names is marked (dashed, warning tone, said in its name),
  // and its 쓰지 않은 참조야 warning is a button that puts the @name in too (only the name, for a continuation frame as for any other).
  const rowChip = (name: string) => body().querySelector<HTMLButtonElement>(`.vc-in [data-token="${name}"]`)!
  const warning = (name: string) => body().querySelector<HTMLButtonElement>(`.vc-issues button[data-token="${name}"]`)
  const frameName = '앞 마지막 프레임'
  assert.deepEqual([rowChip('크림').tagName, rowChip('크림').textContent, rowChip('크림').getAttribute('aria-label'), rowChip('크림').title, rowChip('크림').classList.contains('missing')],
    ['BUTTON', 'Picture 1', 'Picture 1, 프롬프트에 넣기: @크림', '프롬프트에 넣기: @크림', false])
  assert.ok(rowChip(frameName).classList.contains('missing'))
  assert.equal(rowChip(frameName).getAttribute('aria-label'), 'Picture 2, 프롬프트에 넣기: @앞 마지막 프레임, 프롬프트에 없음')
  assert.equal(warning(frameName)!.textContent, '쓰지 않은 참조야: @앞 마지막 프레임')
  assert.equal(warning(frameName)!.getAttribute('aria-label'), '쓰지 않은 참조야: @앞 마지막 프레임, 프롬프트에 넣기')
  assert.equal(warning('크림'), null)
  field().focus(); field().setSelectionRange(field().value.length, field().value.length)
  assert.equal(warning(frameName)!.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true })), false, 'a warning takes no focus from the field')
  warning(frameName)!.click()
  await until(() => cutB().data.prompt === '@크림 A @크림 @포즈 @앞 마지막 프레임 ', 'the warning puts only the frame\'s @name in at the caret')
  assert.equal(doc.activeElement, field())
  await until(() => !rowChip(frameName).classList.contains('missing') && !warning(frameName), 'a named reference loses its mark and its warning')
  assert.equal(rowChip(frameName).getAttribute('aria-label'), 'Picture 2, 프롬프트에 넣기: @앞 마지막 프레임')
  // Taking a name out marks its chip again; the row chip puts it back at the caret.
  field().value = '@크림 A'
  field().dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  await until(() => rowChip('포즈').classList.contains('missing') && rowChip(frameName).classList.contains('missing'), 'unnamed references are marked again')
  field().focus(); field().setSelectionRange(0, 0)
  assert.equal(rowChip('포즈').dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true })), false, 'a row chip takes no focus from the field')
  rowChip('포즈').click()
  assert.equal(field().value, '@포즈 @크림 A')
  assert.equal(doc.activeElement, field())
  await until(() => cutB().data.prompt === '@포즈 @크림 A' && !rowChip('포즈').classList.contains('missing'), 'the row chip saves the prompt and its mark goes')

  // 원문 with text is what is sent: it is marked, and the prompt tab says it is not sent.
  tabs()[1].click()
  const raw = body().querySelector<HTMLTextAreaElement>('textarea[data-field="raw"]')!
  raw.value = '원문 장면'
  raw.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  await until(() => Boolean(body().querySelector('[data-ptab="raw"] .vc-tab-dot')), '원문 with text is marked')
  assert.ok(body().querySelector('[data-ptab="prompt"].unsent'))
  assert.match(body().querySelector('[data-ptab="prompt"]')!.textContent!, /보내지 않음/)
  // ←/→ move along the tabs and choose (wrapping), Home and End go to the ends; only the chosen tab is in the tab order.
  body().querySelector<HTMLButtonElement>('[data-ptab="raw"]')!.focus()
  key(doc.activeElement!, 'ArrowRight')
  assert.equal(doc.activeElement?.getAttribute('data-ptab'), 'sent')
  assert.equal(body().querySelector('[data-ptab="sent"]')!.getAttribute('aria-selected'), 'true')
  assert.ok(body().querySelector('pre.vc-sent'), '전송 shows what is sent')
  assert.deepEqual(tabs().map(tab => tab.tabIndex), [-1, -1, 0])
  key(doc.activeElement!, 'Home')
  assert.equal(doc.activeElement?.getAttribute('data-ptab'), 'prompt')
  key(doc.activeElement!, 'ArrowLeft')
  assert.equal(doc.activeElement?.getAttribute('data-ptab'), 'sent')
  key(doc.activeElement!, 'ArrowRight')
  assert.equal(body().querySelector('[data-ptab="prompt"]')!.getAttribute('aria-selected'), 'true')
  // From the 전송 tab a chip opens the text that is sent (원문 here) and puts the name in there; marks follow the sent text.
  assert.ok(rowChip('크림').classList.contains('missing'), '원문 is sent and does not name 크림')
  tabs()[1].click()
  const rawField = () => body().querySelector<HTMLTextAreaElement>('textarea[data-field="raw"]')!
  rawField().focus(); rawField().setSelectionRange(5, 5)
  tabs()[2].click()
  assert.ok(body().querySelector('pre.vc-sent'))
  rowChip('크림').click()
  assert.equal(body().querySelector('[data-ptab="raw"]')!.getAttribute('aria-selected'), 'true')
  assert.equal(rawField().value, '원문 장면 @크림 ', 'the caret the field had when its tab was left')
  assert.equal(doc.activeElement, rawField())
  await until(() => cutB().data.raw === '원문 장면 @크림 ' && !rowChip('크림').classList.contains('missing'), 'the name goes into the sent text and is saved')
  assert.equal(cutB().data.prompt, '@포즈 @크림 A')
  tabs()[0].click()
  // The panel's own tabs work the same way.
  const panelTab = (name: string) => doc.getElementById(`insp-tab-${name}`)!
  panelTab('detail').focus()
  key(panelTab('detail'), 'ArrowRight')
  assert.equal(doc.activeElement, panelTab('checks'))
  assert.deepEqual(['detail', 'checks', 'assistant'].map(name => [panelTab(name).getAttribute('aria-selected'), panelTab(name).tabIndex]), [['false', -1], ['true', 0], ['false', -1]])
  assert.equal(doc.getElementById('insp-panel')!.getAttribute('aria-labelledby'), 'insp-tab-checks')
  key(panelTab('checks'), 'End')
  assert.equal(doc.activeElement, panelTab('assistant'))
  key(panelTab('assistant'), 'Home')
  assert.equal(doc.activeElement, panelTab('detail'))
  assert.equal(top().querySelector('h2')!.textContent, '뒤')

  // A take's menu: arrow keys move, Escape closes it back to its button (and keeps the selection), an item still runs its action.
  const takeMenu = () => body().querySelector<HTMLButtonElement>('[data-imenu="take"][data-take="tb1"]')!
  const menu = doc.getElementById('menu')!, items = () => [...menu.querySelectorAll<HTMLButtonElement>('[role=menuitem]')]
  takeMenu().focus(); takeMenu().click()
  assert.equal(menu.hidden, false)
  assert.equal(takeMenu().getAttribute('aria-expanded'), 'true')
  assert.deepEqual(items().map(item => item.textContent), ['상태 갱신', '같은 시드·이 입력으로', '같은 시드·현재 입력으로', '새 시드·현재 입력으로'])
  assert.equal(doc.activeElement, items()[0])
  key(items()[0], 'ArrowDown')
  assert.equal(doc.activeElement, items()[1])
  key(items()[1], 'End')
  assert.equal(doc.activeElement, items()[3])
  key(items()[3], 'Escape')
  assert.equal(menu.hidden, true)
  assert.equal(doc.activeElement, takeMenu())
  assert.equal(takeMenu().getAttribute('aria-expanded'), 'false')
  assert.equal(top().querySelector('h2')!.textContent, '뒤', 'Escape in a menu does not clear the selection')
  takeMenu().click()
  items()[0].click()
  await until(() => requests.includes('get_take'), '상태 갱신 reads the take')

  // Typed but unsaved text, its caret, the tab and an expanded take survive a redraw from the server.
  body().querySelector<HTMLButtonElement>('[data-action="take-expand"][data-take="tb1"]')!.click()
  assert.ok(doc.getElementById('insp-take-tb1')!.querySelector('pre'))
  field().focus(); field().value = '아직 저장 안 한 글'; field().setSelectionRange(3, 3)
  await act('edit', { expected_revision: project.revision, ops: JSON.stringify([{ op: 'set', id: a.id, fields: { name: '앞 컷' } }]) })
  await until(() => titles('ref_image').includes('앞 컷 · 마지막'), 'the panel was drawn again')
  assert.equal(field().value, '아직 저장 안 한 글')
  assert.equal(doc.activeElement, field())
  assert.equal(field().selectionStart, 3)
  assert.equal(body().querySelector('[data-ptab="prompt"]')!.getAttribute('aria-selected'), 'true')
  assert.equal(body().querySelector('[data-action="take-expand"][data-take="tb1"]')!.getAttribute('aria-expanded'), 'true')
  assert.equal(doc.querySelector('form'), null)
})

test('video canvas offers to continue a REF2VA cut whose continuation frame sits on the start slot it ignores, and never writes its prompt', { timeout: 15000 }, async t => {
  const dom = new JSDOM(fs.readFileSync(path.join(pluginRoot, 'index.html'), 'utf8'), { url: 'http://localhost/' })
  t.after(() => dom.window.close())
  const doc = dom.window.document, hash = (char: string) => char.repeat(32)
  const prompt = 'subject_definitions:\nA ghost.'
  let project = domain.applyOps(domain.newProject('project', '영상'), [
    { op: 'add_node', kind: 'cut', name: '앞', tempId: 'a' },
    { op: 'add_node', kind: 'cut', name: '뒤', tempId: 'b', fields: { mode: 'REF2VA', prompt } },
    { op: 'add_node', kind: 'frame', name: '앞 마지막 프레임', ref: { source: 'library', compositeHash: hash('e') }, tempId: 'frame' },
  ], 0, randomUUID).project
  const [a, b, frame] = project.nodes
  Object.assign(project, { settings: { cutProfileId: null, upscaleProfileId: null } })
  // Older data: the last frame of the cut before was left on the start slot, which REF2VA does not use.
  frame.data.origin = { nodeId: null, takeId: 'ta', position: 'last' }
  project.edges.push({ id: 'e-stray', from: frame.id, to: b.id, port: 'start', position: 0, props: {} })
  project.takes = [{ id: 'ta', cutId: a.id, status: 'completed', resultHash: hash('f'), seed: 1 }]
  const extractions: Record<string, unknown>[] = []
  const api = {
    supports: () => false,
    storage: { get: async () => ({ value: null }), set: async () => ({}) },
    events: { on() {} },
    publish() {},
    async server(body: ServerBody) {
      if (body.op === 'list_projects') return { projects: [{ id: project.id, name: project.name, nodeCount: project.nodes.length }], nextOffset: null }
      if (body.op === 'read_canvas') return body.full ? structuredClone(project) : publication.excerpt(project, body as Excerpt)
      if (body.op === 'workflow_options') return { workflows: [], servers: [], tags: [], profiles: [], settings: {} }
      if (body.op === 'read_node') return { revision: project.revision, node: domain.nodeOf(project, body.id), preview: { inputDigest: '0'.repeat(64) }, edges: project.edges, takes: project.takes, nextEdgeCursor: null, nextTakeCursor: null }
      if (body.op === 'apply_ops') {
        const result = domain.applyOps(project, body.ops, body.expected_revision, randomUUID)
        project = result.project
        return { revision: result.revision, applied: result.applied, rejected: result.rejected, tempIds: result.tempIds }
      }
      if (body.op === 'extract_frame') {
        extractions.push(body)
        return { id: 'x1', status: 'completed', nodeIds: [], savedKeys: [], rejected: [], resultHashes: [], modeChange: null, promptChange: null, revision: project.revision }
      }
      throw new Error('Unexpected page request: ' + JSON.stringify(body))
    },
  }
  const handlers = await bootPage(dom, api)
  const act = (id: string, args: Record<string, unknown> = {}) => handlers['video-canvas.' + id](args, { signal: new AbortController().signal })
  const until = async (check: () => boolean, what: string) => { for (let index = 0; index < 400 && !check(); index++) await new Promise(resolve => setTimeout(resolve, 5)); assert.ok(check(), what) }
  const body = () => doc.getElementById('insp-body')!
  const group = (port: string) => body().querySelector('#insp-port-' + port)?.closest('.vc-port')
  const unused = () => body().querySelector<HTMLDetailsElement>('details.vc-unused')!
  const cutB = () => project.nodes.find((node: { id: string }) => node.id === b.id)
  const frameEdge = () => project.edges.find((edge: { from: string }) => edge.from === frame.id)
  const toasts = () => doc.getElementById('toasts')!.textContent!
  await act('select', { project_id: project.id, id: b.id })
  doc.getElementById('toggle-inspector')!.click()

  // The frame continues nothing in REF2VA, so the cut reads as not continued: the panel offers it among the reference images,
  // the sequence joint is the + that continues, and the canvas rail has its 잇기 chip.
  assert.ok(group('ref_image')!.querySelector('[data-action="continue-prev"]'))
  const joint = doc.querySelector('.vc-seq-join[data-join="' + b.id + '"]')!
  assert.equal(joint.classList.contains('chained'), false)
  assert.equal(joint.getAttribute('aria-label'), '앞 컷에서 잇기')
  assert.ok(doc.querySelector('.vc-link-chip.offer[data-cut="' + b.id + '"]'))
  assert.ok(!doc.querySelector('#edges .vc-edge.chain[data-to="' + b.id + '"]'), 'no chain line into the cut')
  // The stray frame shows in the 안 쓰는 연결 group, opened for it, marked as the cut before's frame.
  assert.equal(unused().open, true)
  assert.ok(unused().querySelector('[data-edge="e-stray"]'))
  assert.ok(unused().querySelector('.vc-mark'))
  // Closed by the person, it stays closed when the panel is drawn again.
  unused().querySelector('summary')!.click()
  assert.equal(unused().open, false)
  await act('edit', { expected_revision: project.revision, ops: JSON.stringify([{ op: 'set', id: a.id, fields: { name: '앞 컷' } }]) })
  await until(() => unused().querySelector('.conai-row-title')!.textContent === '앞 컷 · 마지막', 'the panel was drawn again')
  assert.equal(unused().open, false)

  // 앞 컷에서 이어가기 takes the cut before's last frame among the reference images (the server then replaces the stray link).
  group('ref_image')!.querySelector<HTMLButtonElement>('[data-action="continue-prev"]')!.click()
  await until(() => extractions.length === 1, 'the frame is extracted')
  assert.deepEqual(JSON.parse(JSON.stringify([extractions[0].take_id, extractions[0].position, extractions[0].target])), ['ta', 'last', { cut: b.id, port: 'ref_image' }])
  assert.equal(cutB().data.prompt, prompt, 'continuing writes nothing into the prompt')

  // Mode changes carry the frame along (REF2VA back puts it among the reference images) and leave the text alone.
  const mode = () => body().querySelector<HTMLSelectElement>('select[data-field="mode"]')!
  for (const next of ['I2VA', 'REF2VA']) {
    mode().value = next
    mode().dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    await until(() => cutB().data.mode === next, 'the mode is saved')
  }
  await until(() => frameEdge().port === 'ref_image', 'the continuation frame followed the mode')
  assert.equal(cutB().data.prompt, prompt, 'a mode change writes nothing into the prompt')
  // Disconnecting the frame leaves the text as it is, and no toast speaks of the prompt.
  body().querySelector<HTMLButtonElement>('[data-action="disconnect"][data-edge="' + frameEdge().id + '"]')!.click()
  await until(() => !frameEdge(), 'the frame is disconnected')
  assert.equal(cutB().data.prompt, prompt)
  assert.ok(!toasts().includes('프롬프트에'), toasts())
})

test('video canvas marks each reference in the prompt by kind, as it is sent, in the field, the card and 전송', { timeout: 15000 }, async t => {
  const dom = new JSDOM(fs.readFileSync(path.join(pluginRoot, 'index.html'), 'utf8'), { url: 'http://localhost/' })
  t.after(() => dom.window.close())
  const doc = dom.window.document, hash = (char: string) => char.repeat(32)
  const prompt = 'subject_definitions:\n@크림 is the cake.\n<Picture 1> again, @춤 moves, @노래 plays, @유령 style, @없는 thing in [Shot 1].'
  let project = domain.applyOps(domain.newProject('project', '영상'), [
    { op: 'add_node', kind: 'cut', name: '앞', tempId: 'a' },
    { op: 'add_node', kind: 'cut', name: '뒤', tempId: 'b', fields: { mode: 'REF2VA', prompt } },
    { op: 'add_node', kind: 'image', name: '크림', ref: { source: 'library', compositeHash: hash('c') }, tempId: 'cream' },
    { op: 'add_node', kind: 'video', name: '춤', ref: { source: 'library', compositeHash: hash('d') }, tempId: 'dance' },
    { op: 'add_node', kind: 'audio', name: '노래', ref: { source: 'audio', candidateId: 'song-1' }, tempId: 'song' },
    { op: 'add_node', kind: 'bundle', name: '유령', ref: { name: '유령' }, tempId: 'ghost' },
    { op: 'connect', from: 'cream', to: 'b', port: 'ref_image' },
    { op: 'connect', from: 'dance', to: 'b', port: 'ref_video' },
    { op: 'connect', from: 'song', to: 'b', port: 'ref_audio' },
    { op: 'connect', from: 'ghost', to: 'b', port: 'refmod' },
  ], 0, randomUUID).project
  const [a, b] = project.nodes
  Object.assign(project, { settings: { cutProfileId: null, upscaleProfileId: null } })
  const api = {
    supports: () => false,
    storage: { get: async () => ({ value: null }), set: async () => ({}) },
    events: { on() {} },
    publish() {},
    async server(body: ServerBody) {
      if (body.op === 'list_projects') return { projects: [{ id: project.id, name: project.name, nodeCount: project.nodes.length }], nextOffset: null }
      if (body.op === 'read_canvas') return body.full ? structuredClone(project) : publication.excerpt(project, body as Excerpt)
      if (body.op === 'workflow_options') return { workflows: [], servers: [], tags: [], profiles: [], settings: {} }
      if (body.op === 'read_node') return { revision: project.revision, node: domain.nodeOf(project, body.id), preview: { inputDigest: '0'.repeat(64) }, edges: project.edges, takes: project.takes, nextEdgeCursor: null, nextTakeCursor: null }
      if (body.op === 'apply_ops') {
        const result = domain.applyOps(project, body.ops, body.expected_revision, randomUUID)
        project = result.project
        return { revision: result.revision, applied: result.applied, rejected: result.rejected, tempIds: result.tempIds }
      }
      throw new Error('Unexpected page request: ' + JSON.stringify(body))
    },
  }
  const handlers = await bootPage(dom, api)
  const act = (id: string, args: Record<string, unknown> = {}) => handlers['video-canvas.' + id](args, { signal: new AbortController().signal })
  const until = async (check: () => boolean, what: string) => { for (let index = 0; index < 400 && !check(); index++) await new Promise(resolve => setTimeout(resolve, 5)); assert.ok(check(), what) }
  const body = () => doc.getElementById('insp-body')!
  const field = () => body().querySelector<HTMLTextAreaElement>('.vc-ink > textarea[data-field="prompt"]')!
  const mirror = () => field().parentElement!.querySelector('.vc-ink-mirror')!
  const kind = (el: Element) => el.className.match(/k-(\w+)/)![1]
  const marks = (root: Element) => [...root.querySelectorAll<HTMLElement>('mark')].map(mark => [mark.textContent, kind(mark), mark.dataset.tip])
  const mirrored = () => mirror().textContent!.replace(/\u200b$/, '') === field().value
  const cutB = () => project.nodes.find((node: { id: string }) => node.id === b.id)
  await act('select', { project_id: project.id, id: b.id })
  doc.getElementById('toggle-inspector')!.click()

  // Each reference is marked by kind with what it becomes in the request (resolvePrompt's label), a typed label with the source it names,
  // a mention that does not resolve with its error; [Shot 1] is a shot marker, not a reference.
  const label = (name: string) => domain.resolvePrompt(project, cutB()).table.find((row: { name: string }) => row.name === name)!.label
  assert.deepEqual(marks(mirror()), [
    ['@크림', 'image', label('크림') + ' · 참조 이미지 1 · 크림'],
    ['<Picture 1>', 'image', '<Picture 1> · 참조 이미지 1 · @크림'],
    ['@춤', 'video', label('춤') + ' · 참조 영상 1 · 춤'],
    ['@노래', 'audio', label('노래') + ' · 참조 오디오 1 · 노래'],
    ['@유령', 'bundle', label('유령') + ' · 번들 슬롯 1 · 유령'],
    ['@없는', 'error', '모르는 @이름이야: @없는'],
  ])
  assert.deepEqual([label('춤'), label('노래'), label('유령')], ['<Video 1>', '<Audio 1>', '<RefMod 1>'])
  assert.ok(domain.resolvePrompt(project, cutB()).errors.includes('모르는 @이름이야: @없는'))
  assert.ok(mirrored())
  assert.equal(mirror().getAttribute('aria-hidden'), 'true')
  // The row chips carry the same kind colours; the card on the canvas marks its prompt the same way.
  assert.deepEqual([...body().querySelectorAll('.vc-in .vc-label')].map(kind), ['image', 'video', 'audio', 'bundle'])
  assert.deepEqual(marks(doc.querySelector('#nodes .vc-ink[data-ink="' + b.id + '"] .vc-ink-mirror')!).map(mark => mark[1]), ['image', 'image', 'video', 'audio', 'bundle', 'error'])

  // Typing redraws the mirror from the field (nothing saved yet); a chip insert too.
  field().focus()
  field().value += ' @춤'
  field().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  assert.ok(mirrored())
  assert.deepEqual(marks(mirror()).at(-1)!.slice(0, 2), ['@춤', 'video'])
  field().setSelectionRange(field().value.length, field().value.length)
  body().querySelector<HTMLButtonElement>('.vc-tokens [data-token="노래"]')!.click()
  assert.ok(field().value.endsWith('@춤 @노래 '))
  assert.ok(mirrored(), 'the mirror follows a chip insert before the save')
  await until(() => cutB().data.prompt === field().value, 'the chip saved the prompt')

  // The caret's mention is said under the field and to the live region once, when the caret moves into it; typing says nothing.
  const line = () => doc.getElementById('insp-caret-line')!, live = () => doc.getElementById('insp-live')!
  const caretAt = (at: number, key = 'ArrowLeft') => { field().setSelectionRange(at, at); field().dispatchEvent(new dom.window.KeyboardEvent('keyup', { key, bubbles: true })) }
  caretAt(field().value.indexOf('@유령') + 2)
  assert.equal(line().textContent, '<RefMod 1> · 번들 슬롯 1 · 유령')
  assert.equal(live().textContent, '<RefMod 1> · 번들 슬롯 1 · 유령')
  live().textContent = ''
  field().dispatchEvent(new dom.window.KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))
  assert.equal(live().textContent, '', 'the same mention is not said again')
  caretAt(field().value.indexOf('@없는') + 1, 'End')
  assert.equal(line().textContent, '모르는 @이름이야: @없는')
  live().textContent = ''
  const at = field().value.indexOf('@크림') + 3
  field().value = field().value.slice(0, at) + 'x' + field().value.slice(at)
  field().setSelectionRange(at + 1, at + 1)
  field().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  field().dispatchEvent(new dom.window.KeyboardEvent('keyup', { key: 'x', bubbles: true }))
  assert.equal(line().textContent, '모르는 @이름이야: @크림x', 'the line follows typing')
  assert.equal(live().textContent, '', 'typing is not announced')
  caretAt(0, 'Home')
  assert.equal(line().textContent, '')

  // A redraw from the server while the text is typed but unsaved keeps the typed text, and the mirror with it.
  const typed = field().value
  await act('edit', { expected_revision: project.revision, ops: JSON.stringify([{ op: 'set', id: a.id, fields: { name: '앞 컷' } }]) })
  await until(() => project.nodes.find((node: { id: string }) => node.id === a.id).data.name === '앞 컷', 'the edit landed')
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(field().value, typed)
  assert.ok(mirrored(), 'the mirror is drawn from the typed text after the redraw')

  // 전송 marks the labels it sends, each naming the @name it came from; a hover shows the tip, Esc takes it away.
  body().querySelector<HTMLButtonElement>('[data-ptab="sent"]')!.click()
  const sent = body().querySelector('pre.vc-sent')!
  const sentMarks = marks(sent)
  assert.deepEqual(sentMarks.slice(0, 2), [['<Picture 1>', 'image', '@크림 · 참조 이미지 1'], ['<Picture 1>', 'image', '@크림 · 참조 이미지 1']])
  assert.ok(sentMarks.some(([text, kind, tip]) => text === '<RefMod 1>' && kind === 'bundle' && tip === '@유령 · 번들 슬롯 1'))
  const tip = doc.getElementById('vc-tip')!
  sent.querySelector('mark.k-video')!.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true }))
  assert.deepEqual([tip.hidden, tip.textContent], [false, '@춤 · 참조 영상 1'])
  doc.body.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  assert.equal(tip.hidden, true)
  assert.equal(doc.querySelector('form'), null)
})
