import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import type { ChatPageCommand, ChatPageSnapshot } from '@conai/shared'
import type { CodexChatMessage, CodexChatThreadDetail } from '../src/lib/api-codex-chat'
import type { RuntimeEventEnvelope } from '../src/lib/runtime-events-types'

/** MutationCache.clear removes entries but does not destroy their browser-mode GC timers. */
function clearTestQueryClient(client: import('@tanstack/react-query').QueryClient) {
  for (const mutation of client.getMutationCache().getAll()) mutation.destroy()
  client.clear()
}

test('editor merges preserve unrelated drafts and do not misidentify their own asset changes', async () => {
  const { buildDraft, mergeProfileDraft, mergeProfileConflict, mergeOwnProfileDraft, latestProfileConflicts, profileAssetDraft, profileSettingNeedsRefresh, rebaseProfileDraft, rebaseAppearancePatch } = await import('../src/features/settings/components/chat-profile-editor')
  const { mergeBookDraft, latestBookConflicts } = await import('../src/features/settings/components/chat-lorebook-editor-page')
  type Profile = import('../src/lib/api-codex-chat').ChatProfile
  type Book = import('../src/lib/api-codex-chat').ChatLorebook
  type Applied = import('../src/lib/api-codex-chat').ChatAssetApplyResult
  type Setting = import('@conai/shared').CharacterSetting
  const base = { id: 1, revision: '1', backgroundRevision: 0, name: 'Old', tagline: 'Old tagline', style: { backgroundDim: 0, emoticonGroupIds: [1] } } as Profile
  const latest = { ...base, revision: '2', name: 'Server name' }
  const draft = { ...buildDraft(base, undefined), name: 'My name', tagline: 'My tagline' }
  const merged = mergeProfileDraft(base, latest, draft, undefined)
  assert.deepEqual(merged.conflicts, ['name'])
  const resolved = latestProfileConflicts(latest, merged.draft, merged.conflicts, undefined)
  assert.equal(resolved.name, 'Server name')
  assert.equal(resolved.tagline, 'My tagline')

  const applied = { owner: { kind: 'profile', id: 1 }, applied: { expressionGroupId: 7, expressionSlots: ['happy'], backgroundGroupId: null, profileFields: ['style.emoticonGroupIds'] } } as Applied
  const slot = { kind: 'expression' as const, hash: 'image' }
  const withAsset = { ...base, revision: '3', style: { ...base.style, emoticonGroupIds: [7, 1] } }
  const editedStyle = { ...buildDraft(base, undefined), style: { ...base.style, backgroundDim: 25 } }
  const assetDraft = profileAssetDraft(editedStyle, applied, slot, withAsset)
  const assetBase = profileAssetDraft(buildDraft(base, undefined), applied, slot, withAsset)
  const assetMerge = mergeProfileDraft(base, withAsset, assetDraft, undefined, assetBase)
  assert.deepEqual(assetMerge.conflicts, [])
  assert.equal(assetMerge.draft.style.backgroundDim, 25)
  assert.deepEqual(assetMerge.draft.style.emoticonGroupIds, [7, 1])
  const expressionMerge = mergeOwnProfileDraft(base, withAsset, editedStyle, undefined, { kind: 'expression', groupId: 7 })
  assert.deepEqual(expressionMerge.conflicts, [], 'the first expression is this editor’s own group change')
  assert.equal(expressionMerge.draft.style.backgroundDim, 25)
  assert.deepEqual(expressionMerge.draft.style.emoticonGroupIds, [7, 1])
  const ownAssetMerge = mergeOwnProfileDraft(base, withAsset, editedStyle, undefined, { kind: 'asset', result: applied, slot })
  assert.deepEqual(ownAssetMerge.conflicts, [])
  const newerAfterAsset = { ...withAsset, revision: '4', name: 'Server name' }
  const adoptedDuringSave = mergeProfileConflict(base, withAsset, newerAfterAsset, assetDraft, undefined, null)
  assert.deepEqual(adoptedDuringSave.conflicts, [], 'a save rebases against the profile adopted while it was in flight')
  assert.equal(adoptedDuringSave.draft.style.backgroundDim, 25)
  const deferredAsset = mergeOwnProfileDraft(base, null, editedStyle, undefined, { kind: 'asset', result: applied, slot })
  const expectedAsset = { id: base.id, revision: base.revision, draft: deferredAsset.expected }
  const afterDeferredAsset = mergeProfileConflict(base, base, withAsset, deferredAsset.pending, undefined, expectedAsset)
  assert.deepEqual(afterDeferredAsset.conflicts, [], 'an applied asset awaiting refresh is not an external style change')
  assert.equal(afterDeferredAsset.draft.style.backgroundDim, 25)
  assert.deepEqual(mergeProfileConflict(base, withAsset, newerAfterAsset, assetDraft, undefined, expectedAsset).conflicts, [], 'an old expected draft cannot replace an adopted base')
  const referenceApplied = { ...applied, applied: { ...applied.applied, expressionGroupId: null, profileFields: ['referenceHash'] } }
  const deferredReference = mergeOwnProfileDraft(base, null, deferredAsset.pending, undefined, { kind: 'asset', result: referenceApplied, slot: { kind: 'reference', hash: 'reference' } }, deferredAsset.expected)
  const bothAssets = { ...withAsset, referenceHash: 'reference' }
  const afterBothAssets = mergeProfileConflict(base, base, bothAssets, deferredReference.pending, undefined, { id: base.id, revision: base.revision, draft: deferredReference.expected })
  assert.deepEqual(afterBothAssets.conflicts, [], 'deferred effects accumulate in the expected base')
  assert.equal(afterBothAssets.draft.style.backgroundDim, 25)
  assert.equal(afterBothAssets.draft.referenceHash, 'reference')
  const draftWithTagline = { ...editedStyle, tagline: 'My tagline' }
  const assetWithTaglineConflict = { ...withAsset, tagline: 'Server tagline' }
  const refusedAsset = mergeOwnProfileDraft(base, assetWithTaglineConflict, draftWithTagline, undefined, { kind: 'asset', result: applied, slot })
  assert.deepEqual(refusedAsset.conflicts, ['tagline'])
  const afterRefusedAsset = mergeProfileConflict(base, base, assetWithTaglineConflict, refusedAsset.pending, undefined, { id: base.id, revision: base.revision, draft: refusedAsset.expected })
  assert.deepEqual(afterRefusedAsset.conflicts, ['tagline'], 'a refused adoption keeps only the real conflict')
  const resolvedAfterAsset = latestProfileConflicts(assetWithTaglineConflict, afterRefusedAsset.draft, afterRefusedAsset.conflicts, undefined)
  assert.equal(resolvedAfterAsset.tagline, 'Server tagline')
  assert.equal(resolvedAfterAsset.style.backgroundDim, 25)
  assert.deepEqual(resolvedAfterAsset.style.emoticonGroupIds, [7, 1])
  const externalStyle = { ...withAsset, style: { ...withAsset.style, backgroundDim: 40 } }
  assert.deepEqual(mergeProfileDraft(base, externalStyle, assetDraft, undefined, assetBase).conflicts, ['style'])
  assert.deepEqual(mergeOwnProfileDraft(base, externalStyle, editedStyle, undefined, { kind: 'expression', groupId: 7 }).conflicts, ['style'])
  const setting = { id: 11, revision: 2, appearance: 'Blue hair', referenceHash: null, avatarHash: null, avatarCrop: null, expressionGroupId: 7 } as Setting
  const linkedBase = { ...base, expressionGroupId: 1, appearance: 'Old look', referenceHash: null, avatarHash: null, avatarCrop: null, style: { ...base.style, emoticonGroupIds: [1, 8] } }
  const submittedLink = { ...buildDraft(linkedBase, undefined), style: { ...linkedBase.style, backgroundDim: 25 } }
  const linkedLatest = { ...linkedBase, revision: '4', expressionGroupId: 7, characterLink: { settingId: 11, synced: true, revision: 2, settingName: 'Look', path: [], linkedProfileCount: 1 }, appearance: 'Blue hair', avatar: null, style: { ...linkedBase.style, emoticonGroupIds: [7, 8] } }
  const settingEffect = { kind: 'setting' as const, setting, submitted: submittedLink, previousGroupId: 1 }
  const settingMerge = mergeOwnProfileDraft(linkedBase, linkedLatest, submittedLink, undefined, settingEffect)
  assert.deepEqual(settingMerge.conflicts, [])
  assert.equal(settingMerge.draft.style.backgroundDim, 25)
  assert.deepEqual(settingMerge.draft.style.emoticonGroupIds, [7, 8])
  assert.equal(settingMerge.draft.characterLink?.settingId, 11)
  assert.deepEqual(mergeOwnProfileDraft(linkedBase, { ...linkedLatest, style: { ...linkedLatest.style, backgroundDim: 40 } }, submittedLink, undefined, settingEffect).conflicts, ['style'])
  const linkDraft = { ...submittedLink, characterLink: { settingId: 11, synced: true } }
  const linkSave = mergeOwnProfileDraft(linkedBase, linkedLatest, linkDraft, undefined, { kind: 'save', submitted: linkDraft, keys: ['name', 'characterLink'], linkChanged: true })
  assert.deepEqual(linkSave.conflicts, [])
  assert.equal(linkSave.draft.style.backgroundDim, 25)
  assert.deepEqual(linkSave.draft.style.emoticonGroupIds, [7, 8])
  const fullBase = { ...linkedBase, expressionGroupId: null, style: { ...linkedBase.style, emoticonGroupIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] } }
  const fullDraft = { ...buildDraft(fullBase, undefined), style: { ...fullBase.style, backgroundDim: 25 } }
  const fullSetting = { ...setting, expressionGroupId: 11 }
  const fullLatest = { ...linkedLatest, expressionGroupId: 11, style: { ...linkedLatest.style, emoticonGroupIds: [11, 1, 2, 3, 4, 5, 6, 7, 8, 9] } }
  const fullMerge = mergeOwnProfileDraft(fullBase, fullLatest, fullDraft, undefined, { kind: 'setting', setting: fullSetting, submitted: fullDraft, previousGroupId: null })
  assert.deepEqual(fullMerge.conflicts, [])
  assert.deepEqual(fullMerge.draft.style.emoticonGroupIds, fullLatest.style.emoticonGroupIds)
  const oldSynced = { ...linkedLatest, characterLink: { ...linkedLatest.characterLink, revision: 1 } }
  assert.equal(profileSettingNeedsRefresh(oldSynced, setting), true)
  assert.equal(profileSettingNeedsRefresh(linkedLatest, setting), false)
  const stalePanel = buildDraft(base, undefined)
  const refreshed = { ...stalePanel, style: { ...stalePanel.style, backgroundDim: 40, emoticonGroupIds: [1, 8] } }
  const expressionPatch = { style: { ...stalePanel.style, emoticonGroupIds: [7, 1] } }
  const afterExpression = rebaseAppearancePatch(stalePanel, refreshed, expressionPatch)
  assert.equal(afterExpression.style.backgroundDim, 40)
  assert.deepEqual(afterExpression.style.emoticonGroupIds, [7, 1, 8])
  const duringSave = { ...draft, name: 'Edited while saving' }
  assert.equal(rebaseProfileDraft({ ...base, name: 'My name' }, draft, duringSave, undefined).name, 'Edited while saving')
  const savedDuringEdit = mergeOwnProfileDraft(base, { ...base, name: 'My name' }, duringSave, undefined, { kind: 'save', submitted: draft, keys: ['name'], linkChanged: false })
  assert.deepEqual(savedDuringEdit.conflicts, [])
  assert.equal(savedDuringEdit.draft.name, 'Edited while saving')

  const book = { id: 1, revision: '1', name: 'Book', entries: [{ id: 'a', content: 'Old' }] } as Book
  const newer = { ...book, revision: '2', entries: [{ id: 'a', content: 'Server' }] } as Book
  const editedEntries = [{ ...book.entries[0], content: 'Mine' }]
  const bookMerge = mergeBookDraft(book, newer, { name: 'My book', entries: editedEntries })
  assert.deepEqual(bookMerge.conflicts, { name: false, entries: ['a'] })
  const bookResolved = latestBookConflicts(newer, bookMerge.draft, bookMerge.conflicts)
  assert.equal(bookResolved.name, 'My book')
  assert.deepEqual(bookResolved.entries, newer.entries)
  const localAdded = [...book.entries, { ...book.entries[0], id: 'c', content: 'Mine' }]
  const remoteAdded = [...book.entries, { ...book.entries[0], id: 'd', content: 'Server' }]
  const concurrentAdds = mergeBookDraft(book, { ...book, revision: '3', entries: remoteAdded }, { name: 'My book', entries: localAdded })
  assert.deepEqual(concurrentAdds.conflicts, { name: false, entries: [] }, 'a draft addition and a proposal addition do not conflict')
  assert.deepEqual(concurrentAdds.draft.entries.map((entry) => entry.id), ['a', 'c', 'd'])
  assert.deepEqual(latestBookConflicts({ ...book, revision: '3', entries: remoteAdded }, concurrentAdds.draft, concurrentAdds.conflicts).entries.map((entry) => entry.id), ['a', 'c', 'd'])
})

test('entry three-way merges preserve one-sided changes and resolve only conflicting identities', async () => {
  const { mergeLoreEntries, latestLoreEntryConflicts } = await import('../src/lib/api-codex-chat')
  type Entry = import('../src/lib/api-codex-chat').ChatLoreEntry
  const a = { id: 'a', title: 'A', content: 'base' } as Entry
  const b = { id: 'b', title: 'B', content: 'base' } as Entry
  const c = { id: 'c', title: 'C', content: 'added locally' } as Entry
  const d = { id: 'd', title: 'D', content: 'added remotely' } as Entry
  const mine = { ...a, content: 'mine' }
  const theirs = { ...a, content: 'theirs' }
  for (const changed of [[a, b, c], [b], [mine, b]]) {
    assert.deepEqual(mergeLoreEntries([a, b], [a, b], changed), { entries: changed, conflicts: [] })
    assert.deepEqual(mergeLoreEntries([a, b], changed, [a, b]), { entries: changed, conflicts: [] })
    assert.deepEqual(mergeLoreEntries([a, b], changed, changed), { entries: changed, conflicts: [] }, 'equal results are not conflicts')
  }
  const disjoint = mergeLoreEntries([a, b], [{ ...b, content: 'remote' }, d], [a, { ...b, content: 'base' }, c])
  assert.deepEqual(disjoint, { entries: [{ ...b, content: 'remote' }, c, d], conflicts: [] })
  const edits = mergeLoreEntries([a, b], [a, { ...b, content: 'remote' }, d], [mine, b, c])
  assert.deepEqual(edits, { entries: [mine, { ...b, content: 'remote' }, c, d], conflicts: [] })
  for (const [local, remote] of [[[mine], [theirs]], [[], [theirs]], [[mine], []]] as Entry[][][]) {
    const merged = mergeLoreEntries([a, b], [...remote, b, d], [...local, b, c])
    assert.deepEqual(merged.conflicts, ['a'])
    assert.deepEqual(new Map(merged.entries.map((entry) => [entry.id, entry])), new Map([...local, b, c, d].map((entry) => [entry.id, entry])))
    const resolved = latestLoreEntryConflicts(merged.entries, [...remote, b, d], merged.conflicts)
    assert.deepEqual(new Map(resolved.map((entry) => [entry.id, entry])), new Map([...remote, b, c, d].map((entry) => [entry.id, entry])))
  }
  assert.deepEqual(mergeLoreEntries([], [theirs], [mine]).conflicts, ['a'], 'different additions sharing an ID conflict')
  assert.deepEqual(mergeLoreEntries([a], [{ content: a.content, title: a.title, id: a.id } as Entry], [mine]).conflicts, [], 'object key order does not create an edit')
})

test('chat streams close on malformed lines and callback failures and retain API error details', async t => {
  const { streamChatContinue, deleteCodexChatThread, LoreDecisionsNeededError } = await import('../src/lib/api-codex-chat')
  const { ApiRequestError } = await import('../src/lib/api-request')
  for (const callbackFails of [false, true]) {
    let cancelled = false
    const callbackError = new Error('callback failed')
    t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(callbackFails ? '{"type":"delta","text":"hello"}\n' : 'invalid json\n')) },
      cancel() { cancelled = true },
    })))
    await assert.rejects(() => streamChatContinue(1, 2, () => { throw callbackError }), error => callbackFails ? error === callbackError : error instanceof SyntaxError)
    assert.equal(cancelled, true, 'the underlying response must not remain open after an event failure')
  }
  const received: unknown[] = []
  t.mock.method(globalThis, 'fetch', async () => new Response('{"type":"delta","text":"last line"}'))
  await streamChatContinue(1, 2, event => received.push(event))
  assert.deepEqual(received, [{ type: 'delta', text: 'last line' }])
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: false, error: 'Denied', code: 'forbidden', data: { reason: 'permission' } }, { status: 403 }))
  await assert.rejects(() => streamChatContinue(1, 2, () => {}), error => {
    assert.ok(error instanceof ApiRequestError)
    assert.equal(error.status, 403)
    assert.equal(error.code, 'forbidden')
    assert.deepEqual(error.data, { reason: 'permission' })
    return true
  })
  const preview = { items: [] }
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(init?.signal, undefined, 'merge requests retain their no-timeout contract')
    return Response.json({ success: false, error: 'Choose', data: { status: 'decisions', preview, missing: ['entry'] } }, { status: 409 })
  })
  await assert.rejects(() => deleteCodexChatThread(1), error => {
    assert.ok(error instanceof LoreDecisionsNeededError)
    assert.deepEqual(error.preview, preview)
    assert.deepEqual(error.missing, ['entry'])
    return true
  })
})

test('directory refresh coalesces without accepting a stale in-flight read', async () => {
  const { QueryClient, QueryObserver } = await import('@tanstack/react-query')
  const { scheduleChatDirectoryRefresh } = await import('../src/features/codex-chat/chat-query-refresh')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  let finish!: () => void
  const firstRead = new Promise<void>(resolve => { finish = resolve })
  let source = 'before'
  let reads = 0
  let cancelled = false
  const observer = new QueryObserver(client, {
    queryKey: ['codex-chat-threads'],
    queryFn: async ({ signal }) => {
      const value = source
      const first = ++reads === 1
      signal.addEventListener('abort', () => { cancelled = true })
      if (first) await firstRead
      return value
    },
  })
  const unsubscribe = observer.subscribe(() => {})
  try {
    source = 'after'
    const refreshes = [scheduleChatDirectoryRefresh(client), scheduleChatDirectoryRefresh(client), scheduleChatDirectoryRefresh(client)]
    const completedInitialRead = new Promise<void>(resolve => setTimeout(() => { finish(); resolve() }, 250))
    await Promise.all([...refreshes, completedInitialRead])
    assert.equal(reads, 2, 'one initial request and one coalesced event refresh')
    assert.equal(cancelled, false)
    assert.equal(client.getQueryData(['codex-chat-threads']), 'after')
  } finally {
    unsubscribe()
    clearTestQueryClient(client)
  }
})

test('exact chat refreshes replace pre-event snapshots without fetching inactive or nested queries', async () => {
  const { QueryClient, QueryObserver } = await import('@tanstack/react-query')
  const { refetchActiveChatQuery } = await import('../src/features/codex-chat/chat-query-refresh')
  for (const queryKey of [['codex-chat-thread', 1], ['codex-chat-media', 1], ['codex-chat-threads', 'unread']]) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
    let release!: () => void
    const first = new Promise<void>(resolve => { release = resolve })
    let server = 1
    let reads = 0
    let cancelled = false
    const observer = new QueryObserver(client, {
      queryKey,
      queryFn: async ({ signal }) => {
        const snapshot = server
        signal.addEventListener('abort', () => { cancelled = true })
        if (++reads === 1) await first
        return snapshot
      },
    })
    const unsubscribe = observer.subscribe(() => {})
    const inactiveKey = [...queryKey, 'inactive']
    client.setQueryData(inactiveKey, 'seeded without a queryFn')
    try {
      server = 0
      const refreshes = [refetchActiveChatQuery(client, queryKey), refetchActiveChatQuery(client, queryKey)]
      release()
      await Promise.all(refreshes)
      await refetchActiveChatQuery(client, inactiveKey)
      assert.equal(client.getQueryData(queryKey), 0)
      assert.equal(reads, 2, 'one pre-event read and one fresh read shared by the event burst')
      assert.equal(cancelled, false)
      assert.equal(client.getQueryState(queryKey)?.isInvalidated, false, 'tail refreshes do not invalidate loaded history')
      assert.equal(client.getQueryState(inactiveKey)?.status, 'success')
      assert.equal(client.getQueryData(inactiveKey), 'seeded without a queryFn')
    } finally {
      unsubscribe()
      clearTestQueryClient(client)
    }
  }
})

test('read acknowledgements survive pre-ack directory and badge responses', async () => {
  const { QueryClient, QueryObserver } = await import('@tanstack/react-query')
  const { applyChatReadReceipt } = await import('../src/features/codex-chat/use-chat-room-directory')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  const rooms = [{ id: 1, unread_count: 1 }]
  let release!: () => void
  const beforeAck = new Promise<void>(resolve => { release = resolve })
  client.setQueryData(['codex-chat-thread', 1], { messages: [{ id: 10 }] })
  let badgeReads = 0
  const directory = new QueryObserver(client, { queryKey: ['codex-chat-threads'], initialData: rooms, queryFn: async () => { await beforeAck; return rooms } })
  const summaries = new QueryObserver(client, { queryKey: ['codex-chat-threads', 'ids', [1]], initialData: rooms, queryFn: async () => { await beforeAck; return rooms } })
  const badge = new QueryObserver(client, { queryKey: ['codex-chat-threads', 'unread'], initialData: 1, queryFn: async () => { if (++badgeReads === 1) { await beforeAck; return 1 }; return 0 } })
  const unsubscribes = [directory, summaries, badge].map(observer => observer.subscribe(() => {}))
  try {
    void directory.refetch(); void summaries.refetch(); void badge.refetch()
    const receipt = applyChatReadReceipt(client, 1, 10)
    assert.equal(client.getQueryData<typeof rooms>(['codex-chat-threads'])?.[0].unread_count, 0)
    release()
    await receipt
    assert.equal(client.getQueryData<typeof rooms>(['codex-chat-threads'])?.[0].unread_count, 0)
    assert.equal(client.getQueryData<typeof rooms>(['codex-chat-threads', 'ids', [1]])?.[0].unread_count, 0)
    assert.equal(client.getQueryData(['codex-chat-threads', 'unread']), 0)
    assert.equal(badgeReads, 2)
    client.setQueryData(['codex-chat-thread', 1], { messages: [{ id: 11 }] })
    client.setQueryData(['codex-chat-threads'], rooms)
    await applyChatReadReceipt(client, 1, 10)
    assert.equal(client.getQueryData<typeof rooms>(['codex-chat-threads'])?.[0].unread_count, 1, 'a read acknowledgement cannot erase a newer reply')
  } finally {
    unsubscribes.forEach(unsubscribe => unsubscribe())
    clearTestQueryClient(client)
  }
})

test('chat refreshes settle offline without starting or awaiting paused requests', { timeout: 10000 }, async () => {
  const { QueryClient, QueryObserver, onlineManager } = await import('@tanstack/react-query')
  const { refetchActiveChatQuery, scheduleChatDirectoryRefresh } = await import('../src/features/codex-chat/chat-query-refresh')
  const wasOnline = onlineManager.isOnline()
  onlineManager.setOnline(false)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  let reads = 0
  const queryFn = async () => { reads++; return [] }
  const unsubscribes = [
    new QueryObserver(client, { queryKey: ['codex-chat-threads'], queryFn }).subscribe(() => {}),
    new QueryObserver(client, { queryKey: ['codex-chat-thread', 1], queryFn }).subscribe(() => {}),
  ]
  try {
    assert.equal(client.getQueryState(['codex-chat-threads'])?.fetchStatus, 'paused')
    await Promise.all([scheduleChatDirectoryRefresh(client), refetchActiveChatQuery(client, ['codex-chat-thread', 1])])
    assert.equal(reads, 0)
    assert.equal(client.getQueryState(['codex-chat-threads'])?.isInvalidated, true)
  } finally {
    unsubscribes.forEach(unsubscribe => unsubscribe())
    clearTestQueryClient(client)
    onlineManager.setOnline(wasOnline)
  }
})

test('chat draft comparisons retain JSON numeric, missing-key and array equivalence', async () => {
  const { chatDraftEqual } = await import('../src/features/codex-chat/chat-draft-equal')
  const equivalent = [[NaN, NaN], [NaN, null], [Infinity, null], [-Infinity, NaN], [-0, 0], [{ value: undefined }, {}], [[undefined], [null]], [Array(1), [null]], [{ values: [NaN, -0] }, { values: [null, 0] }]]
  for (const [left, right] of equivalent) {
    assert.equal(JSON.stringify(left), JSON.stringify(right))
    assert.equal(chatDraftEqual(left, right), true)
    assert.equal(chatDraftEqual(right, left), true)
  }
  for (const [left, right] of [[NaN, 1], [undefined, null], [{ value: null }, {}], [[null], []], [Array(1), [1]]]) assert.equal(chatDraftEqual(left, right), false)
})

test('chat notifications share directory refreshes, refetch only the new-message tail and still notify', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  class Source extends dom.window.EventTarget {
    static latest: Source
    constructor() { super(); Source.latest = this }
    close() {}
  }
  Object.defineProperty(dom.window, 'EventSource', { value: Source })
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, EventSource: Source, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement: h } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider, QueryObserver } = await import('@tanstack/react-query')
  const { MemoryRouter } = await import('react-router-dom')
  const { I18nProvider } = await import('../src/i18n')
  const { SnackbarContext } = await import('../src/components/ui/snackbar-context')
  const { CodexChatContext } = await import('../src/features/codex-chat/codex-chat-context')
  const { useChatGenerationNotifications } = await import('../src/features/runtime-events/use-chat-generation-notifications')
  const { scheduleChatDirectoryRefresh } = await import('../src/features/codex-chat/chat-query-refresh')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  client.setQueryData(['auth-status'], { authenticated: true, hasCredentials: true, accountId: 1, permissionKeys: ['chat.use'] })
  client.setQueryData(['runtime-language-settings'], { general: { language: 'en' } })
  const notices: string[] = []
  let directoryReads = 0
  let tailReads = 0
  let nestedReads = 0
  const unsubscribes = [
    new QueryObserver(client, { queryKey: ['codex-chat-threads'], initialData: [], queryFn: async () => { directoryReads++; return [] } }).subscribe(() => {}),
    new QueryObserver(client, { queryKey: ['codex-chat-thread', 1], initialData: {}, queryFn: async () => {
      assert.equal(client.getQueryState(['codex-chat-thread', 1])?.isInvalidated, false, 'new messages must take the non-invalidated tail-merge path')
      tailReads++
      return {}
    } }).subscribe(() => {}),
    new QueryObserver(client, { queryKey: ['codex-chat-thread', 1, 'attachments'], initialData: {}, queryFn: async () => { nestedReads++; return {} } }).subscribe(() => {}),
  ]
  const chat = { canUse: true, selectedThreadId: 1, listOpen: false, isPanelOpen: false, currentLiveTurn: () => null } as import('../src/features/codex-chat/codex-chat-context').CodexChatApi
  function Notifications() { useChatGenerationNotifications(); return null }
  const root = createRoot(document.getElementById('root')!)
  try {
    await act(async () => root.render(h(QueryClientProvider, { client }, h(MemoryRouter, { initialEntries: ['/settings'] },
      h(I18nProvider, null, h(SnackbarContext.Provider, { value: { showSnackbar: notice => { notices.push(notice.message) }, closeSnackbar() {} } },
        h(CodexChatContext.Provider, { value: chat }, h(Notifications))))))))
    const emit = (name: string, payload: unknown) => Source.latest.dispatchEvent(new dom.window.MessageEvent(name, { data: JSON.stringify({ name, payload }) }))
    await act(async () => {
      emit('chat.message.created', { threadId: 1, requestedByAccountId: 1 })
      emit('chat.reaction.created', { threadId: 2, requestedByAccountId: 1 })
      // The local provider's turn completion joins the same refresh as both SSE handlers.
      await scheduleChatDirectoryRefresh(client)
    })
    assert.equal(directoryReads, 1)
    assert.equal(tailReads, 1)
    assert.equal(nestedReads, 0)
    const generation = { requestedByAccountId: 1, status: 'completed', imageCount: 1, thumbnailHistoryId: null, chat: { threadId: 1, replyId: 2, threadTitle: 'Chat', characterName: 'Character' } }
    await act(async () => {
      emit('chat.generation.finished', generation)
      emit('chat.generation.finished', { ...generation, requestedByAccountId: 2 })
    })
    assert.deepEqual(notices, ['Character · 1 images ready'], 'completion notifications retain account filtering')
  } finally {
    await act(async () => root.unmount())
    unsubscribes.forEach(unsubscribe => unsubscribe())
    clearTestQueryClient(client)
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})

test('revision conflict errors carry the current record without a follow-up read', async (t) => {
  const api = await import('../src/lib/api-codex-chat')
  const current = { id: 4, revision: 'new', name: 'Latest', entries: [] }
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1
    return Response.json({ success: false, code: 'revision_conflict', error: 'Changed', data: current }, { status: 409 })
  })
  for (const save of [
    () => api.updateChatProfile(4, { name: 'Mine' }, 'old'),
    () => api.updateChatLorebook(4, { name: 'Mine', revision: 'old' }),
    () => api.updateOwnLorebook(4, { name: 'Mine', revision: 'old' }),
    () => api.saveThreadLorebook(4, [], 'old'),
  ]) {
    await assert.rejects(save, (error: unknown) => {
      assert.ok(api.isChatRevisionConflict(error))
      assert.deepEqual(error.current, current)
      return true
    })
  }
  assert.equal(calls, 4)
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { entries: [], revision: 'absent' })
    return Response.json({ success: false, code: 'revision_conflict', error: 'Changed', data: null }, { status: 409 })
  })
  await assert.rejects(() => api.saveThreadLorebook(4, [], 'absent'), (error: unknown) => {
    assert.ok(api.isChatRevisionConflict(error))
    assert.equal(error.current, null)
    return true
  })
})

test('settings deep links preserve legacy destinations and search never exposes shared rows to guests', async () => {
  const { resolveSettingsLocation, parseSettingsTab } = await import('../src/features/settings/settings-tabs')
  const { SETTINGS_ROWS, searchSettingsRows, settingRowHref, pageSettingRow, PAGE_SETTINGS_SCOPES } = await import('@conai/shared')
  const redirects: Record<string, string> = {
    'section=chat&view=profiles': '/characters?view=profiles',
    'section=chat&view=resources': '/chat/resources',
    'section=chat&view=routines': '/chat/resources?tab=routines',
    'section=chat&view=mine': '/settings?section=mine',
    'section=llm&view=connections': '/settings?section=llm&group=connections',
    'section=chat&view=judge': '/settings?section=llm&group=log',
    'section=llm&view=content-evaluation': '/settings?section=posts&group=topics',
    'section=posts&view=knowledge': '/settings?section=posts&group=knowledge',
    'section=llm-connections': '/settings?section=llm&group=connections',
    'section=llm&setting=chat.diagnostics.captureRaw': '/settings?section=llm&setting=chat.diagnostics.captureRaw&group=log',
  }
  for (const [query, expected] of Object.entries(redirects)) assert.equal(resolveSettingsLocation(new URLSearchParams(query)), expected, query)
  for (const [old, section] of Object.entries({ appearance: 'general', integration: 'generation', 'integration-tools': 'generation', folders: 'library', metadata: 'library', security: 'accounts', 'image-save': 'media', 'llm-connections': 'llm' })) assert.equal(parseSettingsTab(old), section)
  assert.equal(resolveSettingsLocation(new URLSearchParams('section=generation&group=nai')), null)
  assert.equal(new Set(SETTINGS_ROWS.map(row => row.id)).size, SETTINGS_ROWS.length, 'registry IDs are unique')
  const allPermissions = [...new Set(SETTINGS_ROWS.map(row => row.permission))]
  assert.ok(searchSettingsRows('', { isAdmin: false, permissionKeys: allPermissions }).every(row => row.scope === 'mine'))
  assert.deepEqual(searchSettingsRows('NovelAI', { isAdmin: false, permissionKeys: allPermissions }), [])
  const advanced = searchSettingsRows('원문 기록', { isAdmin: true, permissionKeys: allPermissions })[0]
  assert.equal(advanced.id, 'chat.diagnostics.captureRaw')
  assert.equal(advanced.advanced, true)
  assert.equal(settingRowHref(advanced), '/settings?section=llm&group=log&setting=chat.diagnostics.captureRaw')
  assert.equal(pageSettingRow('general', PAGE_SETTINGS_SCOPES.general.fields[0]).label.ko, '갤러리 기능 사용')
})

test('room directory pages keep cursor order, off-page drafts and independent cached summaries', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement: h, useCallback, useEffect, useState } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { patchChatRoomLists, useChatRoomPages, usePagedChatDraftRetention } = await import('../src/features/codex-chat/use-chat-room-directory')
  const { scheduleChatDirectoryRefresh } = await import('../src/features/codex-chat/chat-query-refresh')
  const { useRuntimeEventQueryBridge } = await import('../src/features/runtime-events/use-runtime-event-query-bridge')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const requests: URL[] = []
  let changed = false
  const room = (id: number, title: string) => ({ id, title, kind: 'direct', updated_date: new Date(Date.UTC(2026, 9, id === 6 ? 21 : 20) - id * 1000).toISOString() })
  client.setQueryData(['codex-chat-threads'], [room(6, 'Startup-only room')])
  assert.equal(patchChatRoomLists(client, 6, { running: true }), true, 'the startup list is a fallback only before page caches exist')
  const fetchMock = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(String(input), 'http://localhost')
    requests.push(url)
    const targeted = url.searchParams.has('ids')
    const cursor = url.searchParams.get('cursor')
    const data = targeted ? [room(90, 'Off-page draft')]
      : url.searchParams.get('query') === 'rare' ? [room(7, 'Rare match')]
        : url.searchParams.get('archive') === 'archived' ? [room(8, 'Archived room')]
          : cursor === 'last-page' ? [room(4, 'Fourth room'), room(5, 'Fifth room')]
            : cursor === 'next-page' ? [room(2, 'Stale duplicate'), room(3, changed ? 'Updated room' : 'Next room')]
              : changed ? [room(6, 'New room'), room(1, 'First room')]
                : [room(1, 'First room'), room(2, 'Latest duplicate')]
    const browsing = !targeted && !url.searchParams.has('query') && url.searchParams.get('archive') === 'active'
    const more = browsing && cursor !== 'last-page'
    return new Response(JSON.stringify({ success: true, data, pagination: { total: browsing ? changed ? 6 : 5 : data.length, has_more: more, next_cursor: more ? cursor === 'next-page' ? 'last-page' : 'next-page' : null }, has_automation: false, has_archived_chats: true, has_archived_automation: false }), { headers: { 'Content-Type': 'application/json' } })
  })
  const root = createRoot(document.getElementById('root')!)
  t.after(async () => {
    await act(async () => root.unmount())
    clearTestQueryClient(client)
    fetchMock.mock.restore()
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  let directory!: ReturnType<typeof useChatRoomPages>
  let bridge!: ReturnType<typeof useRuntimeEventQueryBridge>
  let search!: (value: string) => void
  let archive!: () => void
  let retained: number[] = []
  function Directory() {
    const [query, setQuery] = useState('')
    const [view, setView] = useState<'active' | 'archived'>('active')
    const page = useChatRoomPages({ archive: view, pinnedFirst: true, query, limit: 2 })
    const keep = useCallback((ids: number[]) => { retained = ids }, [])
    const currentDrafts = useCallback(() => ({ 90: 'keep me', 91: 'deleted room' }), [])
    const retainDrafts = usePagedChatDraftRetention(currentDrafts, keep)
    useEffect(() => {
      search = setQuery
      archive = () => { setQuery(''); setView('archived') }
      directory = page
      if (page.data) retainDrafts(page.rooms.map((room) => room.id))
    }, [retainDrafts, page])
    return null
  }
  function BridgeCapture() {
    const value = useRuntimeEventQueryBridge()
    useEffect(() => { bridge = value }, [value])
    return null
  }
  await act(async () => { root.render(h(QueryClientProvider, { client }, h(Directory), h(BridgeCapture))); await new Promise(resolve => setTimeout(resolve, 30)) })
  await act(async () => { await directory.refetch(); await new Promise(resolve => setTimeout(resolve, 30)) })
  assert.deepEqual(directory.rooms.map((room) => room.id), [1, 2])
  assert.equal(directory.hasNextPage, true)
  assert.ok(retained.includes(90), 'a draft outside the page is retained when its targeted lookup succeeds')
  assert.ok(!retained.includes(91), 'only a confirmed missing room loses its draft')
  await act(async () => { await directory.fetchNextPage(); await new Promise(resolve => setTimeout(resolve, 20)) })
  assert.deepEqual(directory.rooms.map((room) => room.id), [1, 2, 3])
  assert.equal(directory.rooms[1].title, 'Latest duplicate')
  assert.equal(directory.hasNextPage, true)
  assert.ok(requests.some((url) => url.searchParams.get('cursor') === 'next-page'))
  client.setQueryData(['codex-chat-threads', 'unread'], 17)
  await act(async () => {
    patchChatRoomLists(client, 2, { pinned: 1 })
    await new Promise(resolve => setTimeout(resolve, 20))
  })
  assert.equal(directory.rooms.find((room) => room.id === 2)?.pinned, 1)
  assert.equal(client.getQueryData(['codex-chat-threads', 'unread']), 17, 'summary updates do not treat the aggregate badge as a room array')
  await act(async () => { await directory.fetchNextPage(); await new Promise(resolve => setTimeout(resolve, 30)) })
  await act(async () => { await directory.refetch(); await new Promise(resolve => setTimeout(resolve, 20)) })
  assert.equal(directory.data?.pages.length, 2, 'the refetched cursor window is bounded')
  assert.deepEqual(directory.rooms.map((room) => room.id), [1, 2, 3, 4, 5], 'the current first page survives cursor-window eviction')
  const beforeLocalSend = requests.length
  await act(async () => {
    patchChatRoomLists(client, 5, { updated_date: '2026-10-22T00:00:00.000Z', preview: { text: 'Just sent', role: 'user', media: false, files: false }, running: true })
    assert.equal(client.getQueryData<{ pages: Array<{ data: Array<{ id: number }> }> }>(['codex-chat-threads', 'pages', { archive: 'active', pinnedFirst: true, query: '', limit: 2 }])?.pages[0].data[0].id, 5)
    await new Promise(resolve => setTimeout(resolve, 20))
  })
  assert.equal(directory.rooms[0].id, 5, 'a sent room moves ahead of the independent head without changing cursor boundaries')
  assert.equal(directory.rooms[0].preview?.text, 'Just sent')
  assert.equal(new Set(directory.rooms.map((room) => room.id)).size, directory.rooms.length)
  assert.equal(requests.length, beforeLocalSend, 'local activity feedback does not fetch')
  client.setQueryData(['codex-chat-threads', 'ids', [6]], [room(6, 'Selected off-page room')])
  client.setQueryData(['codex-chat-threads', 'parents', [6]], [room(6, 'Off-page parent')])
  assert.equal(patchChatRoomLists(client, 6, { running: true }), false, 'startup/summary-only rooms still need the send-time directory refresh once page caches exist')
  assert.equal(client.getQueryData<Array<{ running: boolean }>>(['codex-chat-threads', 'ids', [6]])?.[0].running, true, 'summary caches are still patched')
  const beforeRefresh = requests.length
  changed = true
  await act(async () => {
    await Promise.all([scheduleChatDirectoryRefresh(client), scheduleChatDirectoryRefresh(client), scheduleChatDirectoryRefresh(client)])
    await new Promise(resolve => setTimeout(resolve, 20))
  })
  assert.equal(requests.slice(beforeRefresh).filter((url) => url.searchParams.has('limit')).length, 3, 'an event refreshes two cursor pages plus the independent head, not all browsed pages')
  assert.equal(directory.rooms[0].id, 6, 'new rooms outside the retained cursor window still appear')
  assert.equal(directory.rooms.find((room) => room.id === 3)?.title, 'Updated room')
  client.setQueryData(['codex-chat-threads', 'ids', [3, 90]], [room(3, 'Updated room'), room(90, 'Off-page draft')])
  await act(async () => { patchChatRoomLists(client, 3, null); await new Promise(resolve => setTimeout(resolve, 20)) })
  assert.ok(!directory.rooms.some((room) => room.id === 3), 'deletion removes a room from every cursor page')
  assert.deepEqual(client.getQueryData<Array<{ id: number }>>(['codex-chat-threads', 'ids', [3, 90]])?.map((room) => room.id), [90])
  await act(async () => { patchChatRoomLists(client, 6, null); await new Promise(resolve => setTimeout(resolve, 20)) })
  assert.ok(!directory.rooms.some((room) => room.id === 6), 'deletion also updates the independent head')
  await act(async () => { search('rare'); await new Promise(resolve => setTimeout(resolve, 20)) })
  await act(async () => { await directory.refetch(); await new Promise(resolve => setTimeout(resolve, 20)) })
  assert.deepEqual(directory.rooms.map((room) => room.id), [7], 'search has its own SQL cursor chain')
  await act(async () => { archive(); await new Promise(resolve => setTimeout(resolve, 20)) })
  await act(async () => { await directory.refetch(); await new Promise(resolve => setTimeout(resolve, 20)) })
  assert.deepEqual(directory.rooms.map((room) => room.id), [8])
  assert.ok(requests.every((url) => url.searchParams.has('ids') || url.searchParams.get('limit') === '2'), 'no interaction fetches the complete directory')

  const staleKey = ['codex-chat-thread', 920] as const
  client.setQueryData(staleKey, { thread: { id: 920, title: 'Old title' }, messages: [{ id: 1 }] })
  await client.invalidateQueries({ queryKey: staleKey, refetchType: 'none' })
  const updatedAt = client.getQueryState(staleKey)!.dataUpdatedAt
  await act(async () => {
    bridge.applyEnvelope({ name: 'chat.thread.updated', payload: { threadId: 920, title: 'New title', requestedByAccountId: 1 } } as RuntimeEventEnvelope)
  })
  assert.equal(client.getQueryState(staleKey)?.isInvalidated, true, 'a title event must not clear a pending transcript refresh')
  assert.equal(client.getQueryState(staleKey)?.dataUpdatedAt, updatedAt)
  assert.equal(client.getQueryData<{ thread: { title: string } }>(staleKey)?.thread.title, 'Old title')
})

test('cursor pages merge without gaps, duplicates or stale-revision resurrection', async () => {
  const { mergeThreadTail, mergeThreadBefore } = await import('../src/lib/api-codex-chat')
  const detail = (ids: number[], count: number, revision = 0, more = true): CodexChatThreadDetail => ({
    thread: { id: 1, context_revision: revision } as CodexChatThreadDetail['thread'],
    messages: ids.map(id => ({ id } as CodexChatMessage)), media: {}, pendingJobs: 0, running: null,
    messagesFrom: more ? ids[0] : undefined, messageCount: count, hasMoreBefore: more,
  })
  const loaded = detail([81, 82, 83, 84], 84)
  const refreshed = mergeThreadTail(loaded, detail([83, 84, 85], 85))!
  assert.deepEqual(refreshed.messages.map(message => message.id), [81, 82, 83, 84, 85])
  assert.equal(refreshed.hasMoreBefore, true)
  assert.equal(mergeThreadTail(loaded, detail([87, 88], 88)), null)
  assert.equal(mergeThreadTail(loaded, detail([83, 84], 84, 1)), null)
  const earlier = detail([79, 80], 85)
  const merged = mergeThreadBefore(refreshed, earlier, 81)!
  assert.deepEqual(merged.messages.map(message => message.id), [79, 80, 81, 82, 83, 84, 85])
  assert.equal(mergeThreadBefore(merged, earlier, 81), null)
  assert.equal(mergeThreadBefore(refreshed, detail([79, 80], 85, 1), 81), null)
  const all = mergeThreadBefore(detail([3, 4], 4), detail([1, 2], 4, 0, false), 3)!
  assert.equal(all.hasMoreBefore, false)
  assert.equal(all.messagesFrom, undefined)
  const recent = detail(Array.from({ length: 80 }, (_, index) => 921 + index), 1000)
  const next = detail(Array.from({ length: 40 }, (_, index) => 963 + index), 1002)
  const routine = mergeThreadTail(recent, next)!
  assert.equal(routine.messages.length, 80, 'new replies must not grow the undemanded cached history')
  assert.equal(routine.messages[0].id, 923)
  const expanded = mergeThreadBefore(recent, detail([919, 920], 1000), 921)!
  assert.equal(mergeThreadTail(expanded, next)!.messages.length, 84, 'explicitly loaded history remains restorable')
})

test('event and polling reads preserve prepended pages and newer local history', { timeout: 10000 }, async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement: h, useLayoutEffect } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { useChatThreadData } = await import('../src/features/codex-chat/use-chat-thread-data')
  const { refetchActiveChatQuery } = await import('../src/features/codex-chat/chat-query-refresh')
  const { notifyManager } = await import('@tanstack/react-query')
  const deferred = <T,>() => {
    let resolve!: (value: T) => void
    const promise = new Promise<T>(done => { resolve = done })
    return { promise, resolve }
  }
  try {
    for (const mode of ['tail', 'pending', 'running', 'invalidated', 'edited-tail', 'edited-pending', 'edited-running', 'edited-invalidated'] as const) await t.test(mode, async () => {
      const strategy = mode.replace('edited-', '')
      const edited = mode.startsWith('edited-')
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
      const key = ['codex-chat-thread', 1] as const
      const detail = (ids: number[], count: number, more: boolean): CodexChatThreadDetail => ({
        thread: { id: 1, context_revision: 0 } as CodexChatThreadDetail['thread'],
        messages: ids.map(id => ({ id } as CodexChatMessage)), media: {}, pendingJobs: 0, running: null,
        messagesFrom: more ? ids[0] : undefined, messageCount: count, hasMoreBefore: more,
      })
      const initial = detail([10, 11, 12], 6, true)
      if (strategy === 'pending') initial.pendingJobs = 1
      if (strategy === 'running') initial.running = { text: 'old', toolCalls: [] }
      client.setQueryData(key, initial)
      client.setQueryData(['codex-chat-threads'], [])
      const firstStarted = deferred<void>()
      const followupStarted = deferred<void>()
      const olderStarted = deferred<void>()
      const firstRead = deferred<void>()
      const followupRead = deferred<void>()
      const olderRead = deferred<void>()
      let reads = 0
      const fetchMock = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input), 'http://localhost')
        assert.match(url.pathname, /^\/api\/codex-chat\/threads\/1(?:\/running)?$/)
        if (url.searchParams.has('before')) {
          assert.equal(url.searchParams.get('before'), '10')
          olderStarted.resolve()
          await olderRead.promise
          const page = detail([1, 2, 3], 7, false)
          page.media = { older: { mimeType: 'image/png', width: 1, height: 1 } }
          return Response.json({ success: true, data: page })
        }
        const first = ++reads === 1
        if (first) { firstStarted.resolve(); await firstRead.promise }
        else { followupStarted.resolve(); await followupRead.promise }
        if (init?.signal?.aborted) throw init.signal.reason
        const data = strategy === 'running'
          ? { running: { text: 'current', toolCalls: [] }, latestMessageId: 12 }
          : first ? initial : detail([10, 11, 12, 13], 7, true)
        return Response.json({ success: true, data })
      })
      let data!: ReturnType<typeof useChatThreadData>
      const selection = { selectedThreadId: 1, settleSelection() {}, keepDrafts() {} }
      function Reader() {
        const current = useChatThreadData(selection, 1)
        useLayoutEffect(() => { data = current }, [current])
        return null
      }
      const root = createRoot(document.getElementById('root')!)
      try {
        await act(async () => root.render(h(QueryClientProvider, { client }, h(Reader))))
        if (strategy === 'invalidated') await client.invalidateQueries({ queryKey: key, refetchType: 'none' })
        let original!: ReturnType<typeof data.threadQuery.refetch>
        await act(async () => { original = data.threadQuery.refetch(); await firstStarted.promise })
        let refresh!: Promise<void>
        let earlier!: Promise<number | null>
        await act(async () => {
          refresh = refetchActiveChatQuery(client, key)
          earlier = data.loadEarlier() // cancels the first read, releasing the queued event refresh
          await Promise.all([followupStarted.promise, olderStarted.promise])
        })
        await act(async () => { olderRead.resolve(); await earlier })
        assert.deepEqual(client.getQueryData<CodexChatThreadDetail>(key)?.messages.map(message => message.id), [1, 2, 3, 10, 11, 12])
        if (edited) await act(async () => {
          client.setQueryData<CodexChatThreadDetail>(key, current => ({
            ...current!, thread: { ...current!.thread, context_revision: 1 },
            messages: [{ id: 1, content: 'Locally edited; later messages deleted' } as CodexChatMessage],
            messageCount: 1, hasMoreBefore: false, messagesFrom: undefined, running: null,
          }))
        })
        await act(async () => { followupRead.resolve(); await refresh })
        const final = client.getQueryData<CodexChatThreadDetail>(key)!
        assert.deepEqual(final.messages.map(message => message.id), edited ? [1] : strategy === 'running' ? [1, 2, 3, 10, 11, 12] : [1, 2, 3, 10, 11, 12, 13])
        if (edited) {
          assert.equal(final.thread.context_revision, 1)
          assert.equal(final.messages[0].content, 'Locally edited; later messages deleted')
        }
        assert.equal(final.historyLoaded, true)
        assert.equal(final.media.older.mimeType, 'image/png')
        if (strategy === 'running' && !edited) assert.equal(final.running?.text, 'current')
        firstRead.resolve()
        await original
      } finally {
        firstRead.resolve(); followupRead.resolve(); olderRead.resolve()
        await act(async () => {
          root.unmount()
          clearTestQueryClient(client)
          // Drain notifications on their own scheduler before removing the jsdom window.
          await new Promise<void>(resolve => notifyManager.schedule(resolve))
        })
        fetchMock.mock.restore()
      }
    })
  } finally {
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})

test('transcript prepending preserves scroll and an unloaded message focus restores through older pages', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement: h, useCallback, useLayoutEffect, useState } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useChatTranscriptWindow } = await import('../src/features/codex-chat/use-chat-transcript-window')
  const root = createRoot(document.getElementById('root')!)
  t.after(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  const messages = Array.from({ length: 240 }, (_, index) => ({ id: index + 1 } as CodexChatMessage))
  let transcript!: ReturnType<typeof useChatTranscriptWindow>
  let focus!: (value: { messageId: number; nonce: number } | null) => void
  let requests = 0
  let scrolledTo: string | null = null
  dom.window.HTMLElement.prototype.scrollIntoView = function () { scrolledTo = this.getAttribute('data-message-id') }
  function Transcript() {
    const [first, setFirst] = useState(160)
    const [messageFocus, setFocus] = useState<{ messageId: number; nonce: number } | null>(null)
    const loadEarlier = useCallback(async () => { requests++; setFirst(current => Math.max(0, current - 80)); return Math.max(1, first - 79) }, [first])
    const clearMessageFocus = useCallback(() => setFocus(null), [])
    const result = useChatTranscriptWindow({
      activeThreadId: 1001, messages: messages.slice(first), isTranscript: true, messageFocus, clearMessageFocus,
      serverReplyLength: 0, hasMoreBefore: first > 0, loadEarlier, loadingEarlier: false, earlierError: null,
    })
    useLayoutEffect(() => { transcript = result; focus = setFocus })
    const ref = useCallback((node: HTMLDivElement | null) => {
      result.scrollRef.current = node
      if (node) {
        Object.defineProperty(node, 'scrollHeight', { configurable: true, get: () => node.children.length * 10 })
        Object.defineProperty(node, 'clientHeight', { configurable: true, value: 100 })
      }
    }, [result.scrollRef])
    return h('div', { ref }, ...result.visibleMessages.map(message => h('div', { key: message.id, 'data-message-id': message.id }, String(message.id))))
  }
  await act(async () => root.render(h(Transcript)))
  const node = transcript.scrollRef.current!
  node.scrollTop = 250
  await act(async () => { await transcript.showEarlierMessages() })
  assert.equal(requests, 1)
  assert.equal(transcript.visibleMessages[0].id, 81)
  assert.equal(node.scrollTop, 1050)
  await act(async () => focus({ messageId: 20, nonce: 1 }))
  assert.equal(requests, 2)
  assert.equal(scrolledTo, '20')
  assert.equal(transcript.flashMessageId, 20)
})

test('streamed deltas publish once per frame, final text wins, and unmount cancels pending frames', { timeout: 10000 }, async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  dom.window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId }
  dom.window.cancelAnimationFrame = id => { frames.delete(id) }
  const { act, createElement: h, useLayoutEffect } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { I18nProvider } = await import('../src/i18n')
  const { SnackbarContext } = await import('../src/components/ui/snackbar-context')
  const { CodexChatProvider } = await import('../src/features/codex-chat/codex-chat-provider')
  const { useCodexChat, useCodexChatLiveTurn, codexChatThreadQueryKey } = await import('../src/features/codex-chat/codex-chat-context')
  const { CHAT_STATUS_QUERY_KEY } = await import('../src/lib/api-codex-chat')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  client.setQueryData(['auth-status'], { authenticated: true, hasCredentials: true, accountId: 1, permissionKeys: ['chat.use'] })
  client.setQueryData(['runtime-language-settings'], { general: { language: 'en' } })
  client.setQueryData(CHAT_STATUS_QUERY_KEY, { canUse: true })
  client.setQueryData(codexChatThreadQueryKey(1), { thread: { id: 1, kind: 'direct', flag_ids: '[]' }, messages: [], media: {}, running: null })
  const root = createRoot(document.getElementById('root')!)
  let mounted = true
  t.after(async () => {
    if (mounted) await act(async () => root.unmount())
    clearTestQueryClient(client)
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  let api!: NonNullable<ReturnType<typeof useCodexChat>>
  const texts: Array<string | null> = []
  function Reader() {
    const chat = useCodexChat()!
    const live = useCodexChatLiveTurn()
    useLayoutEffect(() => { api = chat; texts.push(live?.text ?? null) }, [chat, live])
    return null
  }
  let output!: ReadableStreamDefaultController<Uint8Array>
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.match(String(url), /\/threads\/1\/messages$/)
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        output = controller
        init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true })
      },
    }), { status: 200 })
  })
  await act(async () => root.render(h(QueryClientProvider, { client }, h(I18nProvider, null,
    h(SnackbarContext.Provider, { value: { showSnackbar() {}, closeSnackbar() {} } }, h(CodexChatProvider, null, h(Reader)))))))
  const tick = () => new Promise<void>(resolve => setImmediate(resolve))
  const sendEvents = (events: unknown[]) => output.enqueue(new TextEncoder().encode(events.map(event => JSON.stringify(event)).join('\n') + '\n'))
  let sending!: Promise<void>
  await act(async () => { sending = api.send(1, 'hello'); await tick() })
  const before = texts.length
  await act(async () => { sendEvents(Array.from({ length: 100 }, () => ({ type: 'delta', text: 'a' }))); await tick() })
  assert.equal(texts.length, before)
  assert.equal(frames.size, 1)
  await act(async () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(0) } })
  assert.equal(texts.length, before + 1)
  assert.equal(texts.at(-1), 'a'.repeat(100))
  await act(async () => {
    sendEvents([{ type: 'delta', text: 'discarded by final' }, { type: 'done', message: { id: 2, content: 'final', display_content: 'translated final', tool_calls: [] } }])
    await tick()
  })
  assert.equal(texts.at(-1), 'translated final')
  assert.equal(frames.size, 0)
  const { QueryObserver } = await import('@tanstack/react-query')
  let releaseDirectory!: () => void
  const directoryResponse = new Promise<void>(resolve => { releaseDirectory = resolve })
  const directory = new QueryObserver(client, { queryKey: ['codex-chat-threads'], initialData: [], queryFn: async () => { await directoryResponse; return [] } })
  const stopDirectory = directory.subscribe(() => {})
  const directoryRead = directory.refetch()
  await act(async () => { output.close(); await sending })
  assert.equal(texts.at(-1), null)
  assert.equal(client.getQueryState(['codex-chat-threads'])?.fetchStatus, 'fetching', 'reply settlement does not await the directory coalescer or its pending read')
  assert.equal(client.getQueryState(codexChatThreadQueryKey(1))?.status, 'success', 'an inactive seeded thread without a queryFn is not refetched')
  stopDirectory()
  releaseDirectory()
  await directoryRead
  client.setQueryData<CodexChatThreadDetail>(codexChatThreadQueryKey(1), current => current ? { ...current, thread: { ...current.thread, kind: 'group' } } : current)
  await act(async () => { sending = api.send(1, 'group hello'); await tick() })
  assert.equal(api.currentLiveTurn()?.userText, 'group hello')
  await act(async () => {
    sendEvents([{ type: 'user', message: { id: 3, role: 'user', content: 'group hello', tool_calls: [] } }])
    await tick()
  })
  assert.equal(client.getQueryData<CodexChatThreadDetail>(codexChatThreadQueryKey(1))?.messages.at(-1)?.content, 'group hello')
  assert.equal(api.currentLiveTurn()?.userText, '', 'the stored group message replaces the live bubble without waiting for a frame')
  assert.equal(frames.size, 0)
  await act(async () => { output.close(); await sending })
  await act(async () => { sending = api.send(1, 'again'); await tick(); sendEvents([{ type: 'delta', text: 'pending' }]); await tick() })
  assert.equal(frames.size, 1)
  await act(async () => { root.unmount(); mounted = false; await sending })
  assert.equal(frames.size, 0)
})

test('page commands preserve draft undo, screen identity and reviewed saves', { timeout: 15000 }, async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  class TestEventSource extends dom.window.EventTarget {
    static latest: TestEventSource
    constructor() { super(); TestEventSource.latest = this }
    close() {}
  }
  Object.defineProperty(dom.window, 'EventSource', { value: TestEventSource })
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, EventSource: TestEventSource, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act, createElement: h, useEffect, useLayoutEffect, useState } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { MemoryRouter, useLocation, useNavigate } = await import('react-router-dom')
  const { I18nProvider } = await import('../src/i18n')
  const { SnackbarContext } = await import('../src/components/ui/snackbar-context')
  const { ChatPageProvider, useChatPage, useChatPageRegistration } = await import('../src/features/codex-chat/chat-page-context')
  const { pageAction, pageObject, pageText } = await import('../src/features/codex-chat/page-action-helpers')
  const { useChatDraftTransaction } = await import('../src/features/codex-chat/use-chat-draft-transaction')
  const { useSpriteChatPage, useSpriteNormalizeChatPage } = await import('../src/features/sprite/use-sprite-chat-page')
  const { defaultExtractForm, DEFAULT_OUTPUT, DEFAULT_SAVE } = await import('../src/features/sprite/sprite-options')
  const { buildChatPageChanges } = await import('@conai/shared')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  client.setQueryData(['auth-status'], { authenticated: true, hasCredentials: true, accountId: 1, permissionKeys: ['page.settings.view'] })
  client.setQueryData(['runtime-language-settings'], { general: { language: 'en' } })
  const root = createRoot(document.getElementById('root')!)
  t.after(async () => {
    await act(async () => root.unmount())
    clearTestQueryClient(client)
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  let page!: NonNullable<ReturnType<typeof useChatPage>>
  let edit!: (value: string) => void
  let select!: (value: string) => void
  let currentValue = ''
  let saves = 0
  let pendingDraft: Promise<void> | undefined
  let editData!: (value: { text: string | number | null }) => void
  function Editor() {
    const api = useChatPage()!
    const [value, setValue] = useState('original')
    const [resource, setResource] = useState('one')
    const [payload, setPayload] = useState<{ text: string | number | null }>({ text: 'original data' })
    useLayoutEffect(() => { editData = setPayload }, [])
    const commit = useChatDraftTransaction(value, setValue)
    useLayoutEffect(() => { page = api; edit = setValue; select = setResource; currentValue = value }, [api, value])
    useChatPageRegistration({
      kind: 'settings', title: 'Editor', resourceId: resource, fields: [{ id: 'name', label: 'Name', type: 'text', value }],
      data: { payload },
      actions: [pageAction('profile.draft', 'Draft', '', pageObject({ value: pageText() }, ['value'])), pageAction('profile.save', 'Save', '', undefined, 'save')],
      apply: patch => setValue(String(patch.name)),
      applyAction: async (id, args, assertCurrent) => {
        if (id === 'profile.save') { saves++; return }
        if (pendingDraft) await pendingDraft
        assertCurrent()
        return commit(String(args.value))
      },
    })
    return null
  }
  await act(async () => root.render(h(QueryClientProvider, { client }, h(MemoryRouter, { initialEntries: ['/settings'] },
    h(I18nProvider, null, h(SnackbarContext.Provider, { value: { showSnackbar() {}, closeSnackbar() {} } }, h(ChatPageProvider, null, h(Editor))))))))
  await act(async () => page.toggle())
  await t.test('NaN-bearing registration does not render-loop or change equivalent revisions', async () => {
    await act(async () => editData({ text: NaN }))
    const revision = page.snapshot?.revision
    assert.ok(revision)
    await act(async () => editData({ text: NaN }))
    assert.equal(page.snapshot?.revision, revision)
    await act(async () => editData({ text: null }))
    assert.equal(page.snapshot?.revision, revision, 'NaN and null had the same JSON registration key')
    await act(async () => editData({ text: 7 }))
    assert.notEqual(page.snapshot?.revision, revision)
    await act(async () => editData({ text: 'original data' }))
  })
  await t.test('data-only edits change page revisions while equivalent re-renders retain them', async () => {
    const before = page.capture()!
    await act(async () => editData({ text: 'changed data' }))
    const changed = page.capture()!
    assert.equal(changed.instanceId, before.instanceId)
    assert.notEqual(changed.revision, before.revision, 'direct-tier revision checks must detect data-only edits')
    assert.deepEqual(changed.data?.payload, { text: 'changed data' })
    await act(async () => editData({ text: 'changed data' }))
    assert.equal(page.capture()!.revision, changed.revision)
  })
  await t.test('navigation includes unrestricted pages without granting restricted destinations', () => {
    const destinations = page.capture()?.actions?.find(action => action.id === 'page.navigate')?.schema.properties?.to?.enum ?? []
    assert.ok(destinations.includes('/access'))
    assert.ok(destinations.includes('/extensions'))
    assert.ok(!destinations.includes('/chat'))
    assert.equal(new Set(destinations).size, destinations.length)
  })
  let sequence = 0
  const replies = new Map<string, (answer: { ok: boolean; error?: string; page?: ChatPageSnapshot }) => void>()
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const id = String(url).split('/page-commands/')[1]
    assert.ok(id && replies.has(id), `unexpected request: ${String(url)}`)
    replies.get(id)!(JSON.parse(String(init?.body)))
    return Response.json({ success: true, data: null })
  })
  async function send(command: ChatPageCommand) {
    const snapshot = page.capture()!
    const commandId = `command-${++sequence}`
    const answer = new Promise<{ ok: boolean; error?: string; page?: ChatPageSnapshot }>(resolve => replies.set(commandId, resolve))
    await act(async () => TestEventSource.latest.dispatchEvent(new dom.window.MessageEvent('chat.page.command', { data: JSON.stringify({
      name: 'chat.page.command', payload: { ...command, commandId, connectionId: snapshot.connectionId, instanceId: snapshot.instanceId, threadId: 1, expiresAt: Date.now() + 10000 },
    }) })))
    return { commandId, answer }
  }
  await t.test('field edits can be undone after their normal re-registration, but manual edits cannot be overwritten', async () => {
    const changes = buildChatPageChanges(page.capture()!, [{ fieldId: 'name', value: 'filled' }])
    const command = await send({ type: 'fields', changes })
    await act(async () => assert.equal((await command.answer).ok, true))
    assert.equal(currentValue, 'filled')
    await act(async () => page.undoActivity(command.commandId))
    assert.equal(currentValue, 'original')
    const second = await send({ type: 'fields', changes })
    await act(async () => assert.equal((await second.answer).ok, true))
    await act(async () => edit('manual'))
    assert.throws(() => page.undoActivity(second.commandId), /입력값/)
    assert.equal(currentValue, 'manual')
  })
  await t.test('a draft undo is bound to its editor even if another resource has the same values', async () => {
    const command = await send({ type: 'action', actionId: 'profile.draft', tier: 'draft', arguments: { value: 'filled' } })
    await act(async () => assert.equal((await command.answer).ok, true))
    await act(async () => select('two'))
    assert.throws(() => page.undoActivity(command.commandId), /페이지|화면/)
    assert.equal(currentValue, 'filled')
  })
  await t.test('draft transactions protect subsequent manual edits on the same screen', async () => {
    const command = await send({ type: 'action', actionId: 'profile.draft', tier: 'draft', arguments: { value: 'draft action' } })
    await act(async () => assert.equal((await command.answer).ok, true))
    await act(async () => edit('manual after action'))
    assert.throws(() => page.undoActivity(command.commandId), /입력이 바뀌어서/)
    assert.equal(currentValue, 'manual after action')
  })
  await t.test('an asynchronous draft cannot overwrite input changed while it was waiting', async () => {
    let release!: () => void
    pendingDraft = new Promise<void>(resolve => { release = resolve })
    const command = await send({ type: 'action', actionId: 'profile.draft', tier: 'draft', arguments: { value: 'stale' } })
    await act(async () => edit('newer manual edit'))
    let answer!: Awaited<typeof command.answer>
    await act(async () => { release(); answer = await command.answer })
    pendingDraft = undefined
    assert.equal(answer.ok, false)
    assert.equal(currentValue, 'newer manual edit')
  })
  await t.test('a model command cannot execute a save without the review flow', async () => {
    const command = await send({ type: 'action', actionId: 'profile.save', tier: 'draft', arguments: {} })
    await act(async () => assert.equal((await command.answer).ok, false))
    assert.equal(saves, 0)
  })
  await t.test('sprite extract undo survives video selection and URL changes without previewing a stale selection', async () => {
    client.setQueryData(['auth-status'], { authenticated: true, hasCredentials: true, accountId: 1, permissionKeys: ['page.sprite.view', 'images.edit'] })
    const first = 'a'.repeat(32), second = 'b'.repeat(32)
    let selectVideo!: (hash: string) => void
    let videoList: string[] = []
    let startTime = 0
    const previews: Array<string | null> = []
    function SpriteEditor() {
      const api = useChatPage()!
      const navigate = useNavigate()
      const location = useLocation()
      const [videos, setVideos] = useState<string[]>([])
      const [selected, setSelected] = useState<string | null>(null)
      const [form, setForm] = useState(defaultExtractForm())
      const [output, setOutput] = useState(DEFAULT_OUTPUT)
      const [save, setSave] = useState(DEFAULT_SAVE)
      const changeVideos = (next: string[]) => { setVideos(next); if (!next.includes(selected ?? '')) setSelected(next[0] ?? null) }
      useLayoutEffect(() => { page = api; selectVideo = setSelected; videoList = videos; startTime = form.startTime }, [api, videos, form])
      useEffect(() => {
        const params = new URLSearchParams(location.search)
        if (params.get('video') === selected) return
        if (selected) params.set('video', selected)
        else params.delete('video')
        navigate({ search: params.toString() }, { replace: true })
      }, [location.search, navigate, selected])
      useSpriteChatPage({
        active: true, videoHash: selected, videos, setVideos: changeVideos, maxVideos: 500, selectVideo: setSelected,
        info: null, form, setForm, output, setOutput, save, setSave, build: null, statuses: new Map(),
        batchRunning: false, zipReady: false, canPreview: Boolean(selected), canRunAll: false,
        preview: async () => { previews.push(selected) }, runAll: async () => {}, stopBatch: async () => {}, downloadZip: () => {},
      })
      return null
    }
    await act(async () => root.render(h(QueryClientProvider, { client }, h(MemoryRouter, { key: 'sprite-extract', initialEntries: ['/sprite'] },
      h(I18nProvider, null, h(SnackbarContext.Provider, { value: { showSnackbar() {}, closeSnackbar() {} } }, h(ChatPageProvider, null, h(SpriteEditor))))))))
    await act(async () => page.toggle())
    const instance = page.capture()!.instanceId
    const add = await send({ type: 'action', actionId: 'sprite.add_videos', tier: 'draft', arguments: { hashes: [first, second] } })
    await act(async () => assert.equal((await add.answer).ok, true))
    assert.equal(page.capture()!.instanceId, instance)
    await act(async () => selectVideo(second))
    assert.equal(page.capture()!.instanceId, instance)
    await act(async () => page.undoActivity(add.commandId))
    assert.deepEqual(videoList, [])
    assert.equal(page.capture()!.instanceId, instance)

    const again = await send({ type: 'action', actionId: 'sprite.add_videos', tier: 'draft', arguments: { hashes: [first, second] } })
    await act(async () => assert.equal((await again.answer).ok, true))
    const remove = await send({ type: 'action', actionId: 'sprite.remove_videos', tier: 'draft', arguments: { hashes: [first] } })
    await act(async () => assert.equal((await remove.answer).ok, true))
    assert.deepEqual(videoList, [second])
    await act(async () => page.undoActivity(remove.commandId))
    assert.deepEqual(videoList, [first, second])
    assert.equal(page.capture()!.instanceId, instance)

    const changes = buildChatPageChanges(page.capture()!, [{ fieldId: 'startTime', value: 4 }])
    const fields = await send({ type: 'fields', changes })
    await act(async () => assert.equal((await fields.answer).ok, true))
    await act(async () => selectVideo(first))
    await act(async () => page.undoActivity(fields.commandId))
    assert.equal(startTime, 0)
    const stalePreview = await send({ type: 'action', actionId: 'sprite.preview', tier: 'draft', arguments: { hash: second } })
    await act(async () => assert.equal((await stalePreview.answer).ok, false))
    assert.deepEqual(previews, [])
    const preview = await send({ type: 'action', actionId: 'sprite.preview', tier: 'draft', arguments: { hash: first } })
    await act(async () => assert.equal((await preview.answer).ok, true))
    assert.deepEqual(previews, [first])
  })
  await t.test('sprite sheet preparation cannot overwrite a changed sheet outside the snapshot', async () => {
    const sheetOptions = { columns: 1, rows: 1, frameCount: 1, inputSpacing: 0, outputColumns: 1, readOrder: 'row_major' as const, customAnchorX: 0, customAnchorY: 1 }
    const initial = Array.from({ length: 41 }, (_, index) => ({ hash: index.toString(16).padStart(32, '0'), name: String(index), width: 8, height: 8, options: sheetOptions }))
    const added = { ...initial[0], hash: 'f'.repeat(32) }
    let changeLast!: () => void
    let release!: (value: typeof initial) => void
    let visibleSheets = initial
    function NormalizeEditor() {
      const api = useChatPage()!
      const [sheets, setSheets] = useState(initial)
      const [selected, setSelected] = useState<string | null>(initial[0].hash)
      const [options, setOptions] = useState({ mode: 'per_sheet' as const, alphaThreshold: 20, padding: 2, outputSpacing: 0, anchorPolicy: 'bottom_center' as const, outputFormat: 'png' as const, outputQuality: 90 })
      useLayoutEffect(() => {
        page = api
        visibleSheets = sheets
        changeLast = () => setSheets((current) => current.map((sheet, index) => index === 40 ? { ...sheet, options: { ...sheet.options, columns: 2 } } : sheet))
      }, [api, sheets])
      useSpriteNormalizeChatPage({
        active: true, sheets, setSheets, selected, setSelected, prepareSheets: () => new Promise((resolve) => { release = resolve }),
        options, setOptions, problems: [], running: false, canRun: false, canSave: false, run: async () => {}, savedHashes: [], failures: [],
      })
      return null
    }
    await act(async () => root.render(h(QueryClientProvider, { client }, h(MemoryRouter, { key: 'sprite-normalize', initialEntries: ['/sprite?tab=normalize'] },
      h(I18nProvider, null, h(SnackbarContext.Provider, { value: { showSnackbar() {}, closeSnackbar() {} } }, h(ChatPageProvider, null, h(NormalizeEditor))))))))
    await act(async () => page.toggle())
    const revision = page.capture()!.revision
    const command = await send({ type: 'action', actionId: 'sprite.add_sheets', tier: 'draft', arguments: { hashes: [added.hash] } })
    await act(async () => changeLast())
    assert.equal(page.capture()!.revision, revision)
    let answer!: Awaited<typeof command.answer>
    await act(async () => { release([added]); answer = await command.answer })
    assert.equal(answer.ok, false)
    assert.equal(visibleSheets.length, 41)
    assert.equal(visibleSheets[40].options.columns, 2)
  })
})
