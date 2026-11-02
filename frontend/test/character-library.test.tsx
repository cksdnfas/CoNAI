import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { emptyCharacterAppearanceSections, type CharacterSetting } from '@conai/shared'
import { editReferenceDraft } from '../src/features/characters/character-reference-draft'
import { emptySettingDraft } from '../src/features/characters/character-library-shared'
import { appendPromptPiece, movePromptPiece, promptPieceTexts, removePromptPiece } from '../src/features/characters/character-prompt-pieces'

test('chip add/remove/move preserve untouched escapes, BREAK, newlines and LoRA positions', () => {
  const identity = String.raw`ganyu \(genshin impact\), 1girl, solo`
  assert.equal(removePromptPiece(identity, 2), String.raw`ganyu \(genshin impact\), 1girl`)
  const source = '<lora:miku:0.8>, aqua hair, BREAK twintails\n, (blue eyes, sparkle:1.2)'
  assert.deepEqual(promptPieceTexts(source), ['<lora:miku:0.8>', 'aqua hair', 'BREAK twintails', '(blue eyes, sparkle:1.2)'])
  assert.equal(appendPromptPiece(source, 'solo, smile'), `${source}, solo, smile`)
  const moved = movePromptPiece(source, identity, 1)
  assert.equal(moved.source, '<lora:miku:0.8>, BREAK twintails\n, (blue eyes, sparkle:1.2)')
  assert.equal(moved.destination, `${identity}, aqua hair`)
})

test('gallery category changes keep image membership and ordering coherent without changing the main reference', () => {
  const draft = {
    ...emptySettingDraft(null),
    referenceHash: 'main',
    references: [{ hash: 'first', category: 'Model sheet' }, { hash: 'second', category: null }],
    referenceCategories: ['Model sheet', 'Pose'],
  }
  const renamed = { ...draft, ...editReferenceDraft(draft, { kind: 'rename-category', name: 'Model sheet', next: 'Official art' }) }
  assert.deepEqual(renamed.references, [{ hash: 'first', category: 'Official art' }, { hash: 'second', category: null }])
  assert.deepEqual(renamed.referenceCategories, ['Official art', 'Pose'])
  assert.throws(() => editReferenceDraft(renamed, { kind: 'add-category', name: 'official ART' }))
  const removed = { ...renamed, ...editReferenceDraft(renamed, { kind: 'remove-category', name: 'Official art' }) }
  assert.deepEqual(removed.references, [{ hash: 'first', category: null }, { hash: 'second', category: null }])
  assert.equal(removed.referenceHash, 'main')
  const added = { ...removed, ...editReferenceDraft(removed, { kind: 'add', hashes: ['second', 'third', 'third'], category: 'Pose' }) }
  assert.deepEqual(added.references, [{ hash: 'first', category: null }, { hash: 'second', category: null }, { hash: 'third', category: 'Pose' }])
  assert.deepEqual(editReferenceDraft(added, { kind: 'reorder', hash: 'third', before: 'first' }).references,
    [{ hash: 'third', category: 'Pose' }, { hash: 'first', category: null }, { hash: 'second', category: null }])
  assert.throws(() => editReferenceDraft(added, { kind: 'category', hash: 'third', category: 'Missing' }))
})

test('gallery drafts save both lists with the revision, merge unrelated writes and retain conflicting edits', { timeout: 10000 }, async (t) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' })
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement: h, useLayoutEffect } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { I18nProvider } = await import('../src/i18n')
  const { ConfirmProvider } = await import('../src/components/ui/confirm-dialog')
  const { SnackbarContext } = await import('../src/components/ui/snackbar-context')
  const { ImagePermissionsContext, resolveImagePermissions } = await import('../src/features/auth/use-image-permissions')
  const { characterSettingQueryKey } = await import('../src/lib/api-character-library')
  const { useCharacterSettingEditor } = await import('../src/features/characters/use-character-setting-editor')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } })
  let stored: CharacterSetting = {
    id: 7, folderId: null, name: 'Original', revision: 1, path: [], favorite: false, copyright: null, copyrightTranslated: null,
    sections: emptyCharacterAppearanceSections(), outfits: [], appearance: '', referenceHash: null, avatarHash: null, avatarCrop: null,
    references: [], referenceCategories: [], referenceCount: 0, expressionCount: 0, outfitCount: 0,
    expressionGroupId: null, candidateGroupId: null, linkedProfileCount: 0, linkedProfiles: [], createdAt: '', updatedAt: '',
  }
  client.setQueryData(characterSettingQueryKey(7), stored)
  client.setQueryData(['runtime-language-settings'], { general: { language: 'en' } })
  const writes: Array<Record<string, unknown>> = []
  const messages: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), '/api/character-library/settings/7')
    if (init?.method !== 'PATCH') return Response.json({ success: true, data: stored })
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    writes.push(body)
    if (body.revision !== stored.revision) return Response.json({ success: false, code: 'revision_conflict', error: 'Conflict' }, { status: 409 })
    stored = { ...stored, ...body, revision: stored.revision + 1 } as CharacterSetting
    return Response.json({ success: true, data: stored })
  })
  let editor!: ReturnType<typeof useCharacterSettingEditor>
  let canViewImages = true
  let settingId = 7
  let closed = 0
  function Probe() {
    const state = useCharacterSettingEditor({ target: { settingId }, onCreated: () => {}, onClose: () => { closed += 1 } })
    useLayoutEffect(() => { editor = state }, [state])
    return null
  }
  const root = createRoot(document.getElementById('root')!)
  const render = () => root.render(h(QueryClientProvider, { client },
    h(I18nProvider, null, h(ConfirmProvider, null,
      h(SnackbarContext.Provider, { value: { showSnackbar: ({ message }) => messages.push(message), closeSnackbar: () => {} } },
        h(ImagePermissionsContext.Provider, { value: resolveImagePermissions(canViewImages ? ['images.view'] : [], true) }, h(Probe)))))))
  try {
    await act(async () => { render() })
    assert.equal(editor.ready, true)
    await act(async () => {
      editor.patch(editReferenceDraft(editor.draftRef.current, { kind: 'add-category', name: 'Pose' }))
      editor.patch(editReferenceDraft(editor.draftRef.current, { kind: 'add', hashes: ['first'], category: 'Pose' }))
      editor.patch(editReferenceDraft(editor.draftRef.current, { kind: 'reference', hash: 'first' }))
    })
    assert.equal(editor.dirty, true)
    assert.deepEqual(stored.references, [])
    stored = { ...stored, name: 'Renamed elsewhere', revision: 2 }
    await act(async () => { await editor.save() })
    assert.deepEqual(writes.map((write) => write.revision), [1, 2])
    assert.deepEqual(writes[1].referenceCategories, ['Pose'])
    assert.deepEqual(writes[1].references, [{ hash: 'first', category: 'Pose' }])
    assert.equal(writes[1].referenceHash, 'first')
    assert.equal(editor.draft.name, 'Renamed elsewhere')
    assert.equal(editor.dirty, false)

    await act(async () => { editor.patch(editReferenceDraft(editor.draftRef.current, { kind: 'add', hashes: ['second'], category: 'Pose' })) })
    // A remote category deletion crosses the two whole-list fields; refuse rather than save invalid membership.
    stored = { ...stored, revision: 4, referenceCategories: [], references: [{ hash: 'first', category: null }] }
    await act(async () => { await assert.rejects(editor.save()) })
    assert.equal(writes.length, 3)
    assert.deepEqual(editor.draft.references, [{ hash: 'first', category: 'Pose' }, { hash: 'second', category: 'Pose' }])
    assert.equal(editor.dirty, true)
    assert.equal(messages.length, 1)

    canViewImages = false
    await act(async () => { render(); editor.patch({ name: 'Allowed name change' }) })
    await act(async () => { await editor.save() })
    assert.equal(writes.length, 4)
    assert.deepEqual(writes[3], { name: 'Allowed name change', revision: 4 })

    const previousEditor = editor
    await act(async () => { previousEditor.onBusyChange(true) })
    assert.equal(editor.busy, true)
    client.setQueryData(characterSettingQueryKey(8), { ...stored, id: 8, name: 'Next setting' })
    settingId = 8
    await act(async () => { render() })
    assert.equal(previousEditor.isCurrent(), false)
    assert.equal(editor.busy, false)
    await act(async () => {
      editor.onBusyChange(true)
      previousEditor.onBusyChange(false)
      previousEditor.rebase({ ...stored, name: 'Stale write' })
      previousEditor.patch({ name: 'Stale draft' })
    })
    assert.equal(editor.isBusy(), true)
    assert.equal(editor.draft.name, 'Next setting')
    await assert.rejects(previousEditor.ensureSetting())
    await act(async () => { editor.onBusyChange(false) })
    editor.closeIfDeleted([7])
    assert.equal(closed, 0)
    editor.closeIfDeleted([8])
    assert.equal(editor.deletedRef.current, true)
    assert.equal(closed, 1)
  } finally {
    await act(async () => { root.unmount() })
    client.clear()
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
