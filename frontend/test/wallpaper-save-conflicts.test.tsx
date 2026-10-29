import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

test('wallpaper remount fetches a fresh revision but never adopts a changed or deleted preset as the draft base', async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
  Object.defineProperty(dom.window, 'matchMedia', { value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }) })
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement, Element: dom.window.Element,
    Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, SVGElement: dom.window.SVGElement,
    MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  }
  const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement: h, Fragment } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { MemoryRouter } = await import('react-router-dom')
  const { I18nProvider } = await import('../src/i18n')
  const { authCatalog } = await import('../src/i18n/resources/auth')
  const { settingsCatalog } = await import('../src/i18n/resources/settings')
  const { TooltipProvider } = await import('../src/components/ui/tooltip')
  const { ConfirmProvider } = await import('../src/components/ui/confirm-dialog')
  const { SnackbarContext } = await import('../src/components/ui/snackbar-context')
  const { FeaturePermissionsContext, resolveFeaturePermissions } = await import('../src/features/auth/use-feature-permissions')
  const { DEFAULT_APPEARANCE_SETTINGS } = await import('../src/lib/appearance')
  const { WallpaperEditorPage } = await import('../src/features/wallpaper/wallpaper-editor-page')
  const { PageSettingsSection } = await import('../src/features/settings/page-settings-dialog')
  const {
    cloneWallpaperPresetToDraft, createWallpaperDraftBase, saveWallpaperActivePresetId,
    saveWallpaperLayoutDraft, saveWallpaperLayoutPresets, toWallpaperLayoutPresetViewModel,
  } = await import('../src/features/wallpaper/wallpaper-layout-utils')
  const date = '2026-01-01T00:00:00.000Z'
  const preset = { id: 'one', name: 'Original', canvasPresetId: 'landscape-1080p', widgets: [], background: { kind: 'theme' as const }, createdAt: date, updatedAt: date }
  const view = toWallpaperLayoutPresetViewModel(preset)
  saveWallpaperLayoutPresets([view])
  saveWallpaperActivePresetId(preset.id)
  saveWallpaperLayoutDraft(cloneWallpaperPresetToDraft(view), createWallpaperDraftBase(view))

  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } })
  const appearance = { ...DEFAULT_APPEARANCE_SETTINGS, wallpaperLayoutPresets: [preset], wallpaperActivePresetId: preset.id }
  let server = { appearance, general: {}, pageSettingsRevisions: { appearance: 'theme-new' } }
  client.setQueryData(['app-settings'], { ...server, pageSettingsRevisions: { appearance: 'theme-old' } })
  client.setQueryData(['global-appearance-settings'], DEFAULT_APPEARANCE_SETTINGS)
  client.setQueryData(['runtime-language-settings'], { general: { language: 'ko' } })
  client.setQueryData(['auth-status'], { authenticated: true, hasCredentials: true, isAdmin: true })
  const messages: string[] = []
  const writes: Array<{ revision: string | null; body: Record<string, unknown> }> = []
  let releaseFirst!: () => void
  const firstFetch = new Promise<void>((resolve) => { releaseFirst = resolve })
  let first = true
  let sequence = 0
  const pageSnapshot = () => ({
    values: Object.fromEntries(['themeMode', 'accentPreset', 'surfacePreset', 'density', 'radiusPreset', 'glassPreset', 'shadowPreset'].map((key) => [key, server.appearance[key as keyof typeof server.appearance]])),
    revision: server.pageSettingsRevisions.appearance,
  })
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/settings' && init?.method !== 'PUT') {
      if (first) { first = false; await firstFetch }
      return Response.json({ success: true, data: server })
    }
    if (url === '/api/page-settings/appearance') {
      if (init?.method === 'PUT') {
        if (new Headers(init.headers).get('If-Match') !== server.pageSettingsRevisions.appearance) return Response.json({ success: false, error: '다른 곳에서 설정이 바뀌었어.' }, { status: 409 })
        server = { ...server, appearance: { ...server.appearance, ...JSON.parse(String(init.body)) }, pageSettingsRevisions: { appearance: `sheet-${++sequence}` } }
      }
      return Response.json({ success: true, data: pageSnapshot() })
    }
    if (url === '/api/settings/appearance' && init?.method === 'PUT') {
      const revision = new Headers(init.headers).get('If-Match')
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      writes.push({ revision, body })
      if (revision !== server.pageSettingsRevisions.appearance) return Response.json({ success: false, error: '다른 곳에서 설정이 바뀌었어.' }, { status: 409 })
      server = { ...server, appearance: { ...server.appearance, ...body }, pageSettingsRevisions: { appearance: `saved-${++sequence}` } }
      return Response.json({ success: true, data: server })
    }
    if (url === '/api/wallpaper-runtime/settings') return Response.json({ success: true, data: server.appearance })
    if (url === '/api/settings/appearance-public') return Response.json({ success: true, data: server.appearance })
    if (url === '/api/groups/hierarchy/all' || url === '/api/wallpaper-runtime/tokens' || url === '/api/graph-workflows/schedules') {
      return Response.json({ success: true, data: [] })
    }
    throw new Error(`Unexpected request: ${url}`)
  })
  const root = createRoot(document.getElementById('root')!)
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30))
  const render = async (showSheet = false) => {
    await act(async () => {
      const editor = h(FeaturePermissionsContext.Provider, { value: resolveFeaturePermissions([], true, true) },
        h(Fragment, null, h(WallpaperEditorPage), showSheet ? h('div', { 'data-test-sheet': true }, h(PageSettingsSection, { scope: 'appearance' })) : null))
      const content = h(SnackbarContext.Provider, { value: { showSnackbar: ({ message }) => messages.push(message), closeSnackbar: () => {} } }, editor)
      root.render(h(QueryClientProvider, { client }, h(I18nProvider, { catalog: { ...authCatalog, ...settingsCatalog } },
        h(MemoryRouter, null, h(TooltipProvider, null, h(ConfirmProvider, null, content))))))
      await settle()
    })
  }
  const click = async (button: HTMLButtonElement | undefined | null) => {
    assert.ok(button)
    await act(async () => { button.click(); await settle() })
  }
  const saveButton = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === '저장')
  const editName = async (value: string) => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="이름"]')
    assert.ok(input)
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      await settle()
    })
  }
  const remount = async () => {
    await act(async () => { root.render(h('div')); await settle() })
    await render()
  }
  t.after(async () => {
    try {
      releaseFirst()
      await act(async () => root.unmount())
    } finally {
      client.clear()
      dom.window.close()
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    }
  })

  await render()
  assert.ok(saveButton()?.disabled, 'cached settings cannot enable saving before the mount fetch completes')
  await act(async () => { releaseFirst(); await settle() })
  assert.equal(saveButton()?.disabled, false)
  await editName('My saved preset')
  await click(saveButton())
  assert.equal(writes[0].revision, 'theme-new')
  assert.equal((client.getQueryData(['app-settings']) as typeof server).pageSettingsRevisions.appearance, 'saved-1')
  await editName('Draft while changing the theme')
  await render(true)
  await act(async () => { await settle() })
  const themeSelect = document.querySelector<HTMLSelectElement>('[data-test-sheet] select')
  assert.ok(themeSelect, document.querySelector('[data-test-sheet]')?.textContent ?? 'missing settings section')
  await act(async () => {
    themeSelect.value = themeSelect.value === 'dark' ? 'light' : 'dark'
    themeSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    await settle()
  })
  await click([...document.querySelectorAll<HTMLButtonElement>('[data-test-sheet] button')].find((button) => button.textContent?.trim() === '저장'))
  const sheetRevision = server.pageSettingsRevisions.appearance
  assert.match(sheetRevision, /^sheet-/)
  await click(saveButton())
  assert.equal(writes.at(-1)?.revision, sheetRevision, 'the editor accepts its own checked, disjoint appearance save')
  await render(false)
  await editName('My resumed draft')
  server = {
    ...server,
    appearance: { ...server.appearance, wallpaperLayoutPresets: server.appearance.wallpaperLayoutPresets.map((item) => ({ ...item, updatedAt: '2026-12-01T00:00:00.000Z' })) },
    pageSettingsRevisions: { appearance: 'timestamp-only' },
  }
  await remount()
  const beforeResume = server.pageSettingsRevisions.appearance
  await click(saveButton())
  assert.equal(writes.at(-1)?.revision, beforeResume, 'an unchanged preset remains saveable after navigation despite a timestamp-only change')
  assert.equal(server.appearance.wallpaperLayoutPresets[0].name, 'My resumed draft')

  const beforeRemote = server.pageSettingsRevisions.appearance
  server = {
    ...server,
    appearance: { ...server.appearance, wallpaperLayoutPresets: server.appearance.wallpaperLayoutPresets.map((item) => ({ ...item, name: 'Remote change', updatedAt: '2027-01-01T00:00:00.000Z' })) },
    pageSettingsRevisions: { appearance: 'remote-change' },
  }
  await editName('My unsaved draft')
  await click(saveButton())
  assert.equal(writes.at(-1)?.revision, beforeRemote)
  assert.equal(document.querySelector<HTMLInputElement>('input[aria-label="이름"]')?.value, 'My unsaved draft')
  await remount()
  const countBeforeRetry = writes.length
  await click(saveButton())
  assert.equal(writes.length, countBeforeRetry, 'a fresh collection revision must not rebase an old draft')
  assert.equal(server.appearance.wallpaperLayoutPresets[0].name, 'Remote change')
  assert.equal(document.querySelector<HTMLInputElement>('input[aria-label="이름"]')?.value, 'My unsaved draft')
  assert.ok(messages.some((message) => message.includes('프리셋이 바뀌었어')))

  await click(document.querySelector<HTMLButtonElement>('button[aria-label="더 많은 작업"]'))
  await click([...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent?.includes('다른 이름으로 저장')))
  assert.deepEqual(server.appearance.wallpaperLayoutPresets.map((item) => item.name), ['Remote change', 'My unsaved draft'])
  const savedAsNew = server.appearance.wallpaperLayoutPresets[1].id
  await click(document.querySelector<HTMLButtonElement>('button[aria-label="더 많은 작업"]'))
  await click([...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent?.includes('라이브로 지정')))
  assert.deepEqual(writes.at(-1)?.body, { wallpaperActivePresetId: savedAsNew })
  assert.equal((client.getQueryData(['app-settings']) as typeof server).pageSettingsRevisions.appearance, server.pageSettingsRevisions.appearance)

  server = {
    ...server,
    appearance: { ...server.appearance, wallpaperLayoutPresets: server.appearance.wallpaperLayoutPresets.filter((item) => item.id !== savedAsNew), wallpaperActivePresetId: null },
    pageSettingsRevisions: { appearance: 'remote-delete' },
  }
  await editName('Draft of deleted preset')
  await click(saveButton())
  await remount()
  const countAfterDelete = writes.length
  await click(saveButton())
  assert.equal(writes.length, countAfterDelete)
  assert.equal(server.appearance.wallpaperLayoutPresets.some((item) => item.id === savedAsNew), false)
  assert.equal(document.querySelector<HTMLInputElement>('input[aria-label="이름"]')?.value, 'Draft of deleted preset')
})
