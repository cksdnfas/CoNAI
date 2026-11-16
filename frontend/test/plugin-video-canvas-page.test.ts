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
const section = <T>(data: Record<string, unknown>, name: string) => (data[name] as { data: T }).data

test('video canvas publishes page-action outcomes when return values are discarded and locks double-click runs', { timeout: 15000 }, async t => {
  const root = fileURLToPath(new URL('../../plugins/video-canvas', import.meta.url))
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), { url: 'http://localhost/' })
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
        return body.full ? structuredClone(current) : publication.excerpt(current, body)
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
  const modules = ['util', 'state', 'toast', 'menu', 'session', 'viewport', 'nodes', 'dialogs', 'workflow', 'settings', 'actions', 'inspector', 'sequence', 'home', 'links', 'canvas', 'dispatch']
  const link = (source: string) => source.split('\n').flatMap(line => {
    const imported = /^import \{(.+)\} from '\.\/(\w+)\.mjs'$/.exec(line)
    if (!imported) return line.startsWith('import ') ? [] : [line]
    return modules.includes(imported[2]) ? [`const {${imported[1]}} = __m.${imported[2]};`] : []
  }).join('\n')
  const bundle = modules.map(name => {
    const source = fs.readFileSync(path.join(root, `${name}.mjs`), 'utf8')
    const exported = [...source.matchAll(/^export (?:async )?(?:function|const|let|class) (\w+|\$)/gm)].map(match => match[1])
    return `__m.${name} = (() => {\n${link(source).replace(/^export /gm, '')}\nreturn { ${exported.join(', ')} }\n})()`
  }).join('\n')
  const source = link(fs.readFileSync(path.join(root, 'main.js'), 'utf8'))
  await vm.runInContext(`(async () => { const __m = {};\n${bundle}\n${source}\n })()`, sandbox)
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
  dom.window.document.querySelector<HTMLButtonElement>('[data-action="propose"]')!.click()
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
  data = await act('run_cut', { cut_id: cut.id, expected_revision: project.revision, action: 'upscale', take_id: 'take-one' })
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
