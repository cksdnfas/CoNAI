/* eslint-disable @typescript-eslint/no-explicit-any -- the assertions read the registered page data loosely */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import type { ChatPageCommand, ChatPageSnapshot } from '@conai/shared'

/**
 * The character page's chat assistants (RefMod entries and art styles): what each hook registers goes through the same
 * provider and shared normaliser the app uses before a page reaches the backend (ChatPageProvider → capture →
 * normalizeChatPageSnapshot / normalizeChatPageActions), and the RefMod entry's form fills through real page commands.
 */
test('character page assistants: RefMod and art style registrations survive the shared page normaliser', { timeout: 20000 }, async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  class TestEventSource extends dom.window.EventTarget {
    static latest: TestEventSource
    constructor() { super(); TestEventSource.latest = this }
    close() {}
  }
  Object.defineProperty(dom.window, 'EventSource', { value: TestEventSource })
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, EventSource: TestEventSource,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Node: dom.window.Node,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  }
  const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement: h, useLayoutEffect, useRef, useState } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { MemoryRouter } = await import('react-router-dom')
  const { I18nProvider } = await import('../src/i18n')
  const { SnackbarContext } = await import('../src/components/ui/snackbar-context')
  const { ChatPageProvider, useChatPage } = await import('../src/features/codex-chat/chat-page-context')
  const { useRefModChatPage } = await import('../src/features/refmods/use-refmod-chat-page')
  const { useArtStyleChatPage } = await import('../src/features/art-styles/use-art-style-chat-page')
  const { getMiniMaxH3DirectorAssetRefs, parseMiniMaxH3DirectorTimeline } = await import('../src/features/image-generation/components/minimax-h3-director-dasiwa-utils')
  const { CHAT_PAGE_ACTION_LIMITS, chatPageActionAllowed, isPrivateChatPageKey, normalizeChatPageActions } = await import('@conai/shared')
  type RefModLibrary = import('../src/features/refmods/use-refmod-library').RefModLibrary
  type ArtStyleLibrary = import('../src/features/art-styles/use-art-style-library').ArtStyleLibrary
  type Summary = import('@conai/shared').RefModEntrySummary
  type Detail = import('@conai/shared').RefModEntryDetail

  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  client.setQueryData(['auth-status'], { authenticated: true, hasCredentials: true, accountId: 1, permissionKeys: ['page.characters.view', 'characters.view', 'characters.edit', 'generation.execute', 'images.view'] })
  client.setQueryData(['runtime-language-settings'], { general: { language: 'en' } })
  const replies = new Map<string, (answer: { ok: boolean; error?: string; page?: ChatPageSnapshot }) => void>()
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url)
    if (target.includes('/page-commands/')) {
      if (target.endsWith('/claim')) return Response.json({ success: true, data: null })
      replies.get(target.split('/page-commands/')[1])?.(JSON.parse(String(init?.body)))
      return Response.json({ success: true, data: null })
    }
    return Response.json({ success: true, data: { images: [], entries: [], total: 0 } })
  })
  const root = createRoot(document.getElementById('root')!)
  t.after(async () => {
    await act(async () => root.unmount())
    client.clear()
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })

  let page!: NonNullable<ReturnType<typeof useChatPage>>
  function Page() {
    const api = useChatPage()!
    useLayoutEffect(() => { page = api }, [api])
    return null
  }
  const mount = (location: string, key: string, screen: ReturnType<typeof h>) => act(async () => root.render(h(QueryClientProvider, { client }, h(MemoryRouter, { key, initialEntries: [location] },
    h(I18nProvider, null, h(SnackbarContext.Provider, { value: { showSnackbar() {}, closeSnackbar() {} } }, h(ChatPageProvider, null, screen, h(Page))))))))
  let sequence = 0
  /** Action commands carry the operation's label as the chat shows it; the tests name the action id instead. */
  type SentCommand = Exclude<ChatPageCommand, { type: 'action' }> | (Omit<Extract<ChatPageCommand, { type: 'action' }>, 'label'> & { label?: string })
  async function send(sent: SentCommand) {
    const command: ChatPageCommand = sent.type === 'action' ? { ...sent, label: sent.label ?? sent.actionId } : sent
    const snapshot = page.capture()!
    const commandId = `characters-command-${++sequence}`
    const answer = new Promise<{ ok: boolean; error?: string; page?: ChatPageSnapshot }>((resolve) => replies.set(commandId, resolve))
    await act(async () => TestEventSource.latest.dispatchEvent(new dom.window.MessageEvent('chat.page.command', { data: JSON.stringify({
      name: 'chat.page.command', payload: { ...command, commandId, connectionId: snapshot.connectionId, instanceId: snapshot.instanceId, threadId: 1, expiresAt: Date.now() + 10000 },
    }) })))
    let result!: Awaited<typeof answer>
    await act(async () => { result = await answer })
    return result
  }
  /** Every object key anywhere in the page data, for the protected-name check the backend repeats. */
  const keysOf = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(keysOf)
    : value && typeof value === 'object' ? Object.entries(value).flatMap(([key, item]) => [key, ...keysOf(item)]) : []
  /** The provider's registration and its normalised capture agree: no action, field or data entry was dropped. */
  const captureWhole = (path: string) => {
    const raw = page.snapshot!
    const captured = page.capture()!
    const ids = (raw.actions ?? []).map((action) => action.id)
    assert.deepEqual((captured.actions ?? []).map((action) => action.id), ids)
    assert.deepEqual(normalizeChatPageActions(path, raw.actions ?? []).map((action) => action.id), ids)
    for (const id of ids) assert.ok(chatPageActionAllowed(path, id), id)
    assert.deepEqual(captured.fields.map((field) => field.id), raw.fields.map((field) => field.id))
    assert.deepEqual(captured.data, JSON.parse(JSON.stringify(raw.data)), 'the page data reaches the chat unchanged')
    assert.deepEqual(keysOf(captured.data).filter(isPrivateChatPageKey), [])
    assert.ok(JSON.stringify(captured).length < CHAT_PAGE_ACTION_LIMITS.bytes, 'under the page size limit')
    return captured
  }

  // ---- RefMod entries -------------------------------------------------------------------------------------------
  const member = (kind: 'image' | 'video' | 'audio', index: number) => ({ index, kind, description: `${kind} member`, fileId: `file-${kind}-${index}`, fileName: `${kind}.bin`, mimeType: `${kind}/x`, mediaMode: null, trimStart: null, trimEnd: null, sourceWidth: null, sourceHeight: null, sourceDuration: null })
  const summary = (id: number, name: string, extra: Partial<Summary> = {}): Summary => ({
    id, name, conceptType: 'identity', description: `${name} bundle`, keywords: ['hero'], members: [member('image', 0), member('video', 1), member('audio', 2)],
    workflowId: 3, workflowName: 'MiniMax H3 RefMod', registered: true, issues: [], buildable: true, pending: false, lastBuiltAt: null, lastRecord: null, favorite: false, revision: 2, updatedAt: '2026-11-21T00:00:00Z', ...extra,
  })
  const entries = [
    summary(7, 'group-hero'),
    summary(8, 'group-pending', { pending: true }),
    summary(9, 'group-blocked', { buildable: false, issues: [{ code: 'director-not-exposed', severity: 'blocking' }, { code: 'description-not-exposed', severity: 'warning' }] }),
    summary(10, 'voice-only', { members: [member('audio', 0)], conceptType: 'voice' }),
  ]
  const unregisteredRows = [
    { kind: 'record' as const, key: 'record:31', recordId: 31, name: 'old-run', conceptType: 'style', description: 'Saved run', thumbs: [], kinds: ['image', 'video'] as const, createdAt: '2026-11-01T00:00:00Z' },
    { kind: 'server' as const, key: 'server:server-only', name: 'server-only', conceptType: 'generic', description: 'Server bundle', thumbs: [], kinds: ['image'] as const },
  ]
  const presence = { status: 'ok' as const, serverId: 1, serverName: 'Main ComfyUI', entries: [{ name: 'group-hero', kind: 'image', kinds: ['image'], members: [], concept: 'identity', description: '', tokens: 3, mtime: 1 }, { name: 'server-only', kind: 'image', kinds: ['image'], members: [], concept: 'generic', description: '', tokens: 1, mtime: 1 }] }
  // The entry's Director holds two of its own source copies; the ids must never reach the model.
  const entryFile = (item: string, id: string, fileName: string) => ({ __ref: 'refmod-entry-file', entryId: 7, id, fileName, mimeType: 'image/png', bytes: 1024 })
  const director = {
    mode: 'REF2VA', prompt: '', width: 1344, height: 768, duration: 5, frame_rate: 24, ref_image_size: 'match', builder_state: '',
    timeline_data: JSON.stringify({ version: 1, items: [
      { id: 'face', type: 'image', order: 0, enabled: true, prompt: 'Face', value: 'face.png' },
      { id: 'pose', type: 'image', order: 1, enabled: true, prompt: 'Pose', value: 'pose.png' },
    ] }),
    __conai_minimax_h3_director: { assets: { face: entryFile('face', 'store-file-face-1a2b3c', 'face.png'), pose: entryFile('pose', 'store-file-pose-4d5e6f', 'pose.png') } },
  }
  const fields = [
    { id: 'director', label: 'RefMod sources', type: 'node', node_editor: 'minimax_h3_director_dasiwa', node_class_type: 'MiniMaxH3Director', jsonPath: '1.inputs', default_value: director, node_visible_fields: ['mode', 'timeline_data'], node_hidden_controls: ['resolution', 'postprocess.simple', 'postprocess.model', 'postprocess.rtx'] },
    { id: 'name', label: 'RefMod name', type: 'text', jsonPath: '4.inputs.name', default_value: '' },
    { id: 'description', label: 'Description', type: 'textarea', jsonPath: '4.inputs.description', default_value: '' },
    { id: 'concept_type', label: 'Concept', type: 'select', jsonPath: '4.inputs.concept_type', options: ['generic', 'identity', 'style', 'voice'], default_value: 'generic' },
    { id: 'caption', label: 'Caption', type: 'text', jsonPath: '5.inputs.text', default_value: '' },
  ]
  const detail: Detail = { ...entries[0], form: { workflow: { id: 3, name: 'MiniMax H3 RefMod' }, fields, values: { director, name: 'group-hero', description: 'group-hero bundle', concept_type: 'identity', caption: 'old caption' }, roles: { name: 'name', description: 'description', concept: 'concept_type', director: 'director' } }, records: [{ id: 40, status: 'saved', error: null, serverId: 1, name: 'group-hero', createdAt: '2026-11-20T00:00:00Z' }], createdAt: '2026-11-01T00:00:00Z' }
  const refmodState = { values: {} as Record<string, unknown>, saves: 0, builds: [] as number[] }
  function RefModScreen({ open }: { open: boolean }) {
    const [values, setValues] = useState<Record<string, unknown>>(detail.form!.values)
    const [keywords, setKeywords] = useState(['hero'])
    const draft = { name: 'group-hero', keywords, values }
    const draftRef = useRef(draft)
    draftRef.current = draft
    useLayoutEffect(() => { refmodState.values = values }, [values])
    const editor = {
      open, entryId: open ? 7 : null, ready: open, base: open ? detail : null, latest: open ? detail : null, fields: open ? fields : [],
      activeForm: open ? detail.form : null, isNew: false, recordPreview: null,
      draft: open ? draft : { name: '', keywords: [], values: {} }, draftRef, dirty: false, busy: false, isBusy: () => false, nameValue: 'group-hero', draftError: undefined,
      setName() {}, setKeywords,
      setValue(id: string, value: unknown) { draftRef.current = { ...draftRef.current, values: { ...draftRef.current.values, [id]: value } }; setValues((old) => ({ ...old, [id]: value })) },
      save: async () => { refmodState.saves++; return detail }, remove: async () => true,
    }
    const library = {
      editor, canEdit: true, canBuild: true, loadMore: async () => {}, presence: { isPending: false, isError: false, data: presence }, presenceOk: true,
      visibleEntries: entries, total: 12, query: '', serverFilter: 'all', concept: '', sort: 'updated',
      unregisteredRows, allUnregisteredRows: unregisteredRows, unregisteredCount: unregisteredRows.length, isPending: (entry: Summary) => entry.pending, isOnServer: (name: string) => presence.entries.some((item) => item.name === name),
      search() {}, setListView() {}, refreshPresence: async () => {}, openEntry() {}, closeEntry() {}, create: async () => null, setCreating() {},
      bulk: async () => ({ updated: 1, deleted: 0 }), adopt: async () => ({ created: [], linked: 1, skipped: [] }), build: async (entry: Summary) => { refmodState.builds.push(entry.id); return true },
    }
    useRefModChatPage(library as unknown as RefModLibrary)
    return null
  }

  await mount('/characters?view=refmods', 'refmods-list', h(RefModScreen, { open: false }))
  await act(async () => page.toggle())

  await t.test('RefMod list: the registration reaches the chat whole, with every offered operation allowed on /characters', () => {
    const snapshot = captureWhole('/characters')
    assert.equal(snapshot.resourceId, 'refmods')
    const ids = snapshot.actions!.map((action) => action.id)
    for (const id of ['refmod.filter', 'refmod.load_more', 'refmod.server', 'refmod.open', 'refmod.create', 'refmod.favorite', 'refmod.adopt', 'refmod.build']) assert.ok(ids.includes(id), id)
    const data = snapshot.data as any
    assert.deepEqual(data.entries.items.map((item: any) => item.members), [{ image: 1, video: 1, audio: 1 }, { image: 1, video: 1, audio: 1 }, { image: 1, video: 1, audio: 1 }, { audio: 1 }])
    assert.deepEqual(data.entries.items.map((item: any) => [item.onServer, item.pending, item.buildBlock !== null]), [[true, false, true], [false, true, true], [false, false, true], [false, false, false]])
    assert.deepEqual(data.unregistered.items.map((item: any) => [item.key, item.kind]), [['record:31', 'record'], ['server:server-only', 'server']])
    assert.deepEqual(data.defaultServer, { status: 'ok', name: 'Main ComfyUI', names: 2 })
    const adopt = snapshot.actions!.find((action) => action.id === 'refmod.adopt')!
    assert.equal(adopt.effect, 'save')
    assert.deepEqual(adopt.schema.properties?.keys?.items?.enum, ['record:31', 'server:server-only'])
    assert.deepEqual(snapshot.actions!.find((action) => action.id === 'refmod.build')!.schema.properties?.entryId?.enum, [7, 8, 9, 10])
  })

  await mount('/characters?view=refmods&entry=7', 'refmods-list', h(RefModScreen, { open: true }))
  await t.test('open RefMod entry: its form, Director node and operations reach the chat, and no source file id does', () => {
    const snapshot = captureWhole('/characters')
    assert.equal(snapshot.resourceId, 'refmod:7')
    const ids = snapshot.actions!.map((action) => action.id)
    for (const id of ['comfy.node', 'media.attach', 'media.clear', 'refmod.draft', 'refmod.save', 'refmod.delete', 'refmod.build', 'refmod.close']) assert.ok(ids.includes(id), id)
    // A 'page' registration has no page fields: the role and plain inputs are listed in selected.inputs and filled by
    // refmod.draft; the Director is a node with its schema.
    assert.deepEqual(snapshot.fields, [])
    assert.deepEqual((snapshot.data as any).selected.inputs.map((input: any) => [input.id, input.type, input.value]), [['name', 'text', 'group-hero'], ['description', 'text', 'group-hero bundle'], ['concept_type', 'select', 'identity'], ['caption', 'text', 'old caption']])
    assert.deepEqual(Object.keys(snapshot.actions!.find((action) => action.id === 'refmod.draft')!.schema.properties?.inputs?.properties ?? {}), ['name', 'description', 'concept_type', 'caption'])
    const nodes = (snapshot.data as any).nodes
    assert.deepEqual(nodes.map((node: any) => [node.fieldId, node.editor]), [['director', 'minimax_h3_director_dasiwa']])
    assert.deepEqual(nodes[0].timelineItems.map((item: any) => [item.id, item.type, item.name]), [['face', 'image', 'face.png'], ['pose', 'image', 'pose.png']])
    assert.deepEqual((snapshot.data as any).selected.images, [{ fieldId: 'director', label: 'RefMod sources' }])
    const text = JSON.stringify(snapshot)
    for (const leaked of ['store-file-face-1a2b3c', 'store-file-pose-4d5e6f', 'refmod-entry-file', '__conai_minimax_h3_director']) assert.ok(!text.includes(leaked), `${leaked} stays in the page`)
    for (const id of ['refmod.save', 'refmod.delete', 'refmod.build']) assert.equal(snapshot.actions!.find((action) => action.id === id)!.effect, 'save', id)
    assert.equal(snapshot.actions!.find((action) => action.id === 'refmod.draft')!.effect, 'draft')
  })

  await t.test('open RefMod entry: the plain-input fill and comfy.node change the draft and keep both entry sources', async () => {
    const filled = await send({ type: 'action', actionId: 'refmod.draft', tier: 'draft', arguments: { inputs: { caption: 'new caption', concept_type: 'style' } } })
    assert.equal(filled.ok, true, filled.error)
    assert.deepEqual([refmodState.values.caption, refmodState.values.concept_type], ['new caption', 'style'])
    const refused = await send({ type: 'action', actionId: 'refmod.draft', tier: 'draft', arguments: { inputs: { caption: 'half', concept_type: 'not-a-concept' } } })
    assert.equal(refused.ok, false, 'a choice outside the options is refused')
    assert.equal(refmodState.values.caption, 'new caption', 'nothing of a refused fill applies')
    const edited = await send({ type: 'action', actionId: 'comfy.node', tier: 'draft', arguments: { fieldId: 'director', patch: { timelineItems: [{ id: 'face', prompt: 'Face, front view' }] } } })
    assert.equal(edited.ok, true, edited.error)
    const next = refmodState.values.director
    const items = parseMiniMaxH3DirectorTimeline((next as { timeline_data: string }).timeline_data).timeline.items
    assert.deepEqual(items.map((item) => [item.id, item.prompt]), [['face', 'Face, front view'], ['pose', 'Pose']])
    const refs = getMiniMaxH3DirectorAssetRefs(next)
    assert.deepEqual(Object.fromEntries(Object.entries(refs).map(([key, ref]) => [key, (ref as { id: string }).id])), { face: 'store-file-face-1a2b3c', pose: 'store-file-pose-4d5e6f' }, 'the entry-file refs still resolve')
    const draftAction = await send({ type: 'action', actionId: 'refmod.draft', tier: 'draft', arguments: { keywords: ['hero', 'Hero', 'face'] } })
    assert.equal(draftAction.ok, true, draftAction.error)
    assert.deepEqual((page.capture()!.data as any).selected.keywords, ['hero', 'face'])
    const saveWithoutReview = await send({ type: 'action', actionId: 'refmod.save', tier: 'draft', arguments: {} })
    assert.equal(saveWithoutReview.ok, false, 'a save needs its review card')
    assert.equal(refmodState.saves, 0)
  })

  // ---- Art styles -----------------------------------------------------------------------------------------------
  const style = (id: number, title: string) => ({ id, title, description: `${title} look`, badges: ['watercolor'], coverImageId: 'a'.repeat(32), imageCount: 2, favorite: id === 2, revision: 1, updatedAt: '2026-11-21T00:00:00Z' })
  const styles = [style(1, 'Soft watercolor'), style(2, 'Ink lines'), style(3, 'Cel shade')]
  const upload = { __ref: 'workflow-input-asset', id: 'asset-1', fileName: 'look.png', mimeType: 'image/png', bytes: 10 }
  const styleImages = [{ id: 'a'.repeat(32) }, { composite_hash: 'b'.repeat(48) }, upload]
  const styleState = { images: [] as unknown[] }
  function ArtStyleScreen({ open }: { open: boolean }) {
    // Tagged items: an image the style holds, a library pick and a staged upload (shown by its asset id).
    const [images, setImages] = useState<unknown[]>(styleImages)
    const draft = { title: 'Soft watercolor', description: 'Soft watercolor look', badges: ['watercolor'], keywords: ['soft'], positive: 'watercolor, soft light', negative: 'lowres', images }
    const draftRef = useRef(draft)
    draftRef.current = draft
    useLayoutEffect(() => { styleState.images = images }, [images])
    const stored = { ...styles[0], ...draft, images: [{ id: 'a'.repeat(32), name: 'a.png', mimeType: 'image/png', width: 8, height: 8 }] }
    const editor = { open, styleId: open ? 1 : null, ready: open, base: open ? stored : null, baseRef: { current: open ? stored : null }, draft, draftRef, dirty: false, busy: false, isBusy: () => false, save: async () => {}, remove: async () => {},
      patch(next: { images?: unknown[] }) { if (next.images) { draftRef.current = { ...draftRef.current, images: next.images }; setImages(next.images) } } }
    const library = {
      editor, canEdit: true, canViewImages: true, loaded: styles, total: 3, loadMore: undefined, query: '', badges: [], favoriteOnly: false, sort: 'updated',
      badgeList: [{ badge: 'watercolor', count: 3 }], setListView() {}, openStyle() {}, closeStyle() {}, create: async () => null, bulk: async () => null,
    }
    useArtStyleChatPage(library as unknown as ArtStyleLibrary)
    return null
  }
  await mount('/characters?view=styles', 'styles', h(ArtStyleScreen, { open: false }))
  await act(async () => { if (!page.enabled) page.toggle() })
  await t.test('art styles list and open style: the registration reaches the chat whole on /characters', async () => {
    const list = captureWhole('/characters')
    assert.equal(list.resourceId, 'styles')
    for (const id of ['art_style.filter', 'art_style.open', 'art_style.create', 'art_style.favorite']) assert.ok(list.actions!.some((action) => action.id === id), id)
    assert.deepEqual((list.data as any).styles.items.map((item: any) => item.id), [1, 2, 3])
    await mount('/characters?view=styles&style=1', 'styles', h(ArtStyleScreen, { open: true }))
    const open = captureWhole('/characters')
    assert.equal(open.resourceId, 'style:1')
    for (const id of ['art_style.close', 'art_style.draft', 'art_style.images', 'art_style.save', 'art_style.delete']) assert.ok(open.actions!.some((action) => action.id === id), id)
    assert.deepEqual((open.data as any).selected.images, [{ id: 'a'.repeat(32) }, { composite_hash: 'b'.repeat(48) }, { upload: 'asset-1' }])
  })

  await t.test('open art style: art_style.images takes the items as selected.images shows them and keeps the tagged draft objects', async () => {
    const [held, picked, staged] = (page.capture()!.data as any).selected.images
    const changed = await send({ type: 'action', actionId: 'art_style.images', tier: 'draft', arguments: { remove: [picked], add: [{ composite_hash: 'c'.repeat(48) }], order: [staged, held, { composite_hash: 'c'.repeat(48) }], cover: { composite_hash: 'c'.repeat(48) } } })
    assert.equal(changed.ok, true, changed.error)
    assert.deepEqual(styleState.images, [{ composite_hash: 'c'.repeat(48) }, upload, { id: 'a'.repeat(32) }], 'the staged upload keeps its whole ref')
    const removedHeld = await send({ type: 'action', actionId: 'art_style.images', tier: 'draft', arguments: { remove: [held] } })
    assert.equal(removedHeld.ok, true, removedHeld.error)
    const readded = await send({ type: 'action', actionId: 'art_style.images', tier: 'draft', arguments: { add: [held] } })
    assert.equal(readded.ok, true, 'a saved image can come back by its id')
    assert.deepEqual(styleState.images, [{ composite_hash: 'c'.repeat(48) }, upload, { id: 'a'.repeat(32) }])
    for (const add of [[{ id: 'd'.repeat(32) }], [{ upload: 'asset-2' }], [{ id: 'a'.repeat(32), composite_hash: 'c'.repeat(48) }], ['c'.repeat(48)]]) {
      const refused = await send({ type: 'action', actionId: 'art_style.images', tier: 'draft', arguments: { add } })
      assert.equal(refused.ok, false, JSON.stringify(add))
    }
    assert.equal(styleState.images.length, 3, 'nothing of a refused change applies')
  })
})

test('RefMod build block reasons: named empty inputs, plain names, a name already on the server', async () => {
  const { refModBuildBlockReason } = await import('../src/features/refmods/refmod-shared')
  const t = ((text: { ko: string }, vars: Record<string, string> = {}) => text.ko.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '')) as any
  const member = { index: 0, kind: 'image', description: '', fileId: 'file-1' } as any
  const entry = (extra: Record<string, unknown> = {}) => ({ name: 'hero', workflowId: 3, buildable: true, issues: [], members: [member], pending: false, ...extra }) as any
  const presence = { status: 'ok', serverId: 1, serverName: 'Main', entries: [{ name: 'Taken' }] } as any
  const empty = { code: 'required-input-empty', severity: 'blocking', fields: [{ id: 'video_vae', label: 'Video VAE' }, { id: 'audio_vae', label: 'Audio VAE' }] }
  assert.equal(refModBuildBlockReason(t, entry({ buildable: false, issues: [empty] }), presence), '‘Video VAE’, ‘Audio VAE’ 입력을 채워줘')
  // An unsaved window is saved before the build; the server checks its inputs again then.
  assert.equal(refModBuildBlockReason(t, entry({ buildable: false, issues: [empty] }), presence, true), null)
  assert.match(refModBuildBlockReason(t, entry({ name: 'sub/hero', buildable: false, issues: [{ code: 'name-not-plain', severity: 'blocking' }] }), presence)!, /파일 이름 하나가 아니야/)
  assert.match(refModBuildBlockReason(t, entry({ name: 'sub/hero' }), presence, true)!, /파일 이름 하나가 아니야/, 'a draft name is checked too')
  assert.match(refModBuildBlockReason(t, entry({ name: 'taken' }), presence)!, /이미 있어/, 'case-insensitive, as the server refuses it')
  assert.equal(refModBuildBlockReason(t, entry(), presence), null)
  assert.equal(refModBuildBlockReason(t, entry({ name: 'taken' }), { status: 'unavailable', serverId: 1, serverName: 'Main' } as any), null, 'an unreadable server does not block')
})
