import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import type { Response } from 'express'
import type { CodexChatToolCall } from '../src/services/codex-chat/codexChatStore'
import type { ChatGenerationFinishedEventPayload, RuntimeEventRecord } from '../src/types/runtimeEvents'

test('chat generation: terminal results and owner-only completion events', { timeout: 60000 }, async (t) => {
  const temp = path.resolve(__dirname, '../../temp')
  fs.mkdirSync(temp, { recursive: true })
  const root = fs.mkdtempSync(path.join(temp, 'conai-generation-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  ;(await import('../src/models/ExternalApiProvider')).ExternalApiProvider.create({ provider_name: 'test', display_name: 'test', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { attachJobResults, collectCodexChatMedia, countPendingChatJobs, withGenerationOutcomes, generationOutcomeNote } = await import('../src/services/codex-chat/codexChatMedia')
  const { GenerationQueueService } = await import('../src/services/generationQueueService')
  const { publishQueueJobEvent, publishHistoryRecordEvent } = await import('../src/services/runtime-events/runtimeEventPublishers')
  const { subscribeToRuntimeEvents, getRuntimeEventCursor } = await import('../src/services/runtime-events/runtimeEventBus')
  const { RuntimeEventBroadcaster } = await import('../src/services/runtime-events/runtimeEventBroadcaster')
  t.after(async () => {
    RuntimeEventBroadcaster.shutdown()
    dbModule.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), temp)
    assert.ok(path.basename(root).startsWith('conai-generation-test-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  let db = dbModule.getUserSettingsDb()
  const profile = ChatProfileStore.create({ name: '루나', engine: 'llm', providerName: 'test', model: 'm' })
  const thread = CodexChatStore.findThreadById(CodexChatStore.createThread(1, '옥상 장면', 'llm', profile.id))!
  const call = (jobId: number, tool = 'submit_generation_job'): CodexChatToolCall => ({ id: `${tool}-${jobId}`, tool, status: 'completed', arguments: null, summary: null, historyIds: [], compositeHashes: [], jobIds: [jobId] })
  const job = (status: string, linked = true, accountId: number | null = 1) => {
    const id = Number(db.prepare('INSERT INTO generation_queue_jobs (service_type, status, request_payload, requested_by_account_id, failure_code, failure_message) VALUES (?, ?, ?, ?, ?, ?)')
      .run('novelai', status, '{}', accountId, 'execution_failed', 'secret D:\\private\\image.png\n at provider.stack ' + 'x'.repeat(500)).lastInsertRowid)
    if (linked) db.prepare('INSERT INTO chat_generation_links (job_id, thread_id, reply_id) VALUES (?, ?, ?)').run(id, thread.id, `reply-${id}`)
    return id
  }
  const reply = (jobId: number, calls = [call(jobId)]) => CodexChatStore.addMessage({ thread_id: thread.id, role: 'assistant', content: '', tool_calls: calls, status: 'completed', error: null, routing: { replyId: `reply-${jobId}`, replyTo: null, recipients: [] } })
  const history = (jobId: number, status: string, hash: string | null, accountId: number | null = 1) => Number(db.prepare('INSERT INTO api_generation_history (service_type, generation_status, composite_hash, queue_job_id, requested_by_account_id) VALUES (?, ?, ?, ?, ?)').run('novelai', status, hash, jobId, accountId).lastInsertRowid)
  const read = () => attachJobResults(CodexChatStore.listMessages(thread.id))

  await t.test('a preview event precedes queue completion and reveals chat ids only to the owner', () => {
    const id = job('running')
    const historyId = history(id, 'completed', 'early-preview')
    const listen = (accountId: number, isAdmin: boolean) => {
      const frames: string[] = []
      const res = { write: (frame: string) => frames.push(frame), end: () => {}, writableEnded: false } as unknown as Response
      return { frames, ...RuntimeEventBroadcaster.register({ res, accountId, isAdmin, topics: ['generation-history'], resumeCursor: null, revalidateAccess: () => ({ ok: true }) }) }
    }
    const owner = listen(1, false)
    const stranger = listen(2, false)
    const admin = listen(3, true)
    const events: RuntimeEventRecord[] = []
    const unsubscribe = subscribeToRuntimeEvents((event) => events.push(event))
    try {
      publishHistoryRecordEvent('history.record.status', { history_id: historyId, queue_job_id: id, service_type: 'novelai', workflow_id: null, generation_status: 'completed', composite_hash: 'early-preview', requested_by_account_id: 1 })
      const updated = events.find((event) => event.name === 'chat.generation.updated')!
      assert.equal(updated.visibility, 'owner')
      assert.deepEqual(updated.payload, { threadId: thread.id, jobId: id, historyId, compositeHash: 'early-preview' })
      assert.equal((db.prepare('SELECT status FROM generation_queue_jobs WHERE id = ?').get(id) as { status: string }).status, 'running')
      assert.ok(owner.frames.some((frame) => frame.includes('event: chat.generation.updated')))
      assert.ok(!stranger.frames.some((frame) => frame.includes('event: chat.generation.updated')))
      assert.ok(!admin.frames.some((frame) => frame.includes('event: chat.generation.updated')))
      const before = events.filter((event) => event.name === 'chat.generation.updated').length
      publishHistoryRecordEvent('history.record.status', { history_id: historyId, queue_job_id: id, service_type: 'novelai', workflow_id: null, generation_status: 'completed', composite_hash: 'early-preview', requested_by_account_id: 2 })
      assert.equal(events.filter((event) => event.name === 'chat.generation.updated').length, before)
    } finally {
      owner.close(); stranger.close(); admin.close(); unsubscribe()
      db.prepare("UPDATE generation_queue_jobs SET status = 'completed' WHERE id = ?").run(id)
    }
  })

  await t.test('chat media includes owned pending results, but not pending library lookups or foreign histories', () => {
    const hash = 'd1'.repeat(24)
    const folder = main.db.prepare('SELECT id FROM watched_folders LIMIT 1').get() as { id: number }
    main.db.prepare("INSERT INTO media_metadata (composite_hash, width, height, postprocess_status) VALUES (?, 32, 32, 'pending')").run(hash)
    main.db.prepare(`INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_type, mime_type, file_size, file_status)
      VALUES (?, ?, ?, 'image', 'image/png', 1, 'active')`).run(hash, path.join(root, 'preview.png'), folder.id)
    const id = job('running')
    const messageId = reply(id)
    const own = history(id, 'completed', hash)
    const foreign = history(id, 'completed', hash, 2)
    try {
      const messages = read().messages.filter((message) => message.id === messageId)
      const media = collectCodexChatMedia(messages)
      assert.equal(media.length, 1)
      assert.equal(media[0].historyId, own, 'prefer the owned history when multiple rows point to the same pixels')
      assert.equal(media[0].postprocessStatus, 'pending')
      const lookedUp = [{ ...messages[0], tool_calls: [{ ...call(id, 'search_images'), historyIds: [], compositeHashes: [hash] }] }]
      assert.deepEqual(collectCodexChatMedia(lookedUp), [])
      const foreignOnly = [{ ...messages[0], tool_calls: [{ ...call(id), historyIds: [foreign] }] }]
      assert.deepEqual(collectCodexChatMedia(foreignOnly), [])
      main.db.prepare("UPDATE media_metadata SET postprocess_status = 'ready' WHERE composite_hash = ?").run(hash)
      assert.equal(collectCodexChatMedia(lookedUp).length, 1)
      main.db.prepare("UPDATE image_files SET file_status = 'deleted' WHERE composite_hash = ?").run(hash)
      assert.deepEqual(collectCodexChatMedia(messages), [])
    } finally {
      main.db.prepare('DELETE FROM image_files WHERE composite_hash = ?').run(hash)
      main.db.prepare('DELETE FROM media_metadata WHERE composite_hash = ?').run(hash)
      db.prepare("UPDATE generation_queue_jobs SET status = 'completed' WHERE id = ?").run(id)
    }
  })

  await t.test('chat result hints refetch active matching queries without waiting for a polling timer', async () => {
    const { QueryClient, QueryObserver } = await import('@tanstack/react-query')
    const { refreshChatGenerationQueries, chatGenerationPollInterval } = await import('../../frontend/src/features/runtime-events/chat-generation-query-updates')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
    const keys = [['codex-chat-thread', 1], ['codex-chat-media', 1], ['codex-chat-history', 11], ['image-generation-history', 'codex-chat-job', 12], ['codex-chat-thread', 2]]
    const reads = keys.map(() => 0)
    const unsubscribe: Array<() => void> = []
    try {
      for (const [index, queryKey] of keys.entries()) {
        const options = { queryKey, queryFn: async () => ++reads[index] }
        await client.fetchQuery(options)
        unsubscribe.push(new QueryObserver(client, options).subscribe(() => {}))
      }
      await refreshChatGenerationQueries(client, { threadId: 1, historyId: 11, jobId: 12 })
      assert.deepEqual(reads, [2, 2, 2, 2, 1])
      assert.equal(chatGenerationPollInterval('degraded'), 3000)
      assert.equal(chatGenerationPollInterval('live'), 15000)
    } finally {
      unsubscribe.forEach((stop) => stop())
      client.clear()
    }
  })

  await t.test('a completion racing the first history request replaces that old request instead of waiting for a poll', async () => {
    const { QueryClient, QueryObserver } = await import('@tanstack/react-query')
    const { refreshChatGenerationQueries } = await import('../../frontend/src/features/runtime-events/chat-generation-query-updates')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    const queryKey = ['codex-chat-history', 71]
    let finishOld!: (value: string) => void
    const oldRequest = new Promise<string>((resolve) => { finishOld = resolve })
    let reads = 0
    const observer = new QueryObserver(client, { queryKey, queryFn: () => ++reads === 1 ? oldRequest : Promise.resolve('completed') })
    const unsubscribe = observer.subscribe(() => {})
    try {
      assert.equal(client.getQueryState(queryKey)?.fetchStatus, 'fetching')
      await refreshChatGenerationQueries(client, { threadId: 1, jobId: 12, historyId: 71 })
      assert.equal(client.getQueryData(queryKey), 'completed')
      finishOld('processing')
      await oldRequest
      assert.equal(client.getQueryData(queryKey), 'completed', 'the stale response must not replace the ready result')
    } finally {
      finishOld('processing')
      unsubscribe()
      client.clear()
    }
  })

  await t.test('tail polling counts older linked and legacy jobs once without counting a reply no longer shown', () => {
    const linked = job('running')
    reply(linked, [])
    const legacy = job('running', false)
    reply(legacy, [{ ...call(legacy), jobIds: undefined, output: JSON.stringify({ job_id: legacy }) }])
    const hidden = job('running')
    CodexChatStore.addMessage({ thread_id: thread.id, role: 'user', content: 'latest', tool_calls: [], status: 'completed', error: null })
    assert.equal(attachJobResults(CodexChatStore.listMessages(thread.id, { tail: 1 })).pendingJobs, 0)
    assert.equal(countPendingChatJobs(thread.id), 2)
    assert.equal(countPendingChatJobs(thread.id), read().pendingJobs)
    db.prepare("UPDATE generation_queue_jobs SET status = 'completed' WHERE id IN (?, ?, ?)").run(linked, legacy, hidden)
    assert.equal(countPendingChatJobs(thread.id), 0)
  })

  await t.test('failure without history, cancellation and no-image completion stay on the creator; pending does not overlap', () => {
    for (const status of ['failed', 'cancelled', 'completed']) {
      const id = job(status)
      const messageId = reply(id, [call(id), call(id, 'wait_generation_job')])
      const result = read()
      const calls = result.messages.find((message) => message.id === messageId)!.tool_calls
      assert.equal(result.pendingJobs, 0)
      assert.deepEqual(calls[0].pendingJobIds, [])
      assert.equal(calls[0].failedJobs?.length, 1)
      assert.equal(calls[0].failedJobs![0].status, status)
      assert.equal(calls[0].failedJobs![0].failureCode, status === 'completed' ? 'no_image' : 'execution_failed')
      assert.ok(calls[0].failedJobs![0].failureMessage.length <= 300)
      assert.ok(!JSON.stringify(calls[0].failedJobs).includes('private'))
      assert.equal(calls[1].failedJobs, undefined)
    }
    const id = job('running')
    const messageId = reply(id)
    history(id, 'failed', null)
    const running = read().messages.find((message) => message.id === messageId)!.tool_calls[0]
    assert.deepEqual(running.pendingJobIds, [id], 'failed history is not a completed image')
    assert.equal(running.failedJobs, undefined)
    db.prepare("UPDATE generation_queue_jobs SET status = 'failed' WHERE id = ?").run(id)
    const failedHistoryId = history(id, 'failed', null)
    db.prepare('UPDATE codex_chat_messages SET tool_calls = ? WHERE id = ?').run(JSON.stringify([{ ...call(id), historyIds: [failedHistoryId] }]), messageId)
    assert.deepEqual(read().messages.find((message) => message.id === messageId)!.tool_calls[0].historyIds, [], 'the failure card replaces any stored empty history thumbnail')
  })

  await t.test('completed images suppress failure cards; unlinked failures do not acquire them', () => {
    for (const status of ['completed', 'failed', 'cancelled']) {
      const id = job(status)
      const messageId = reply(id)
      const historyId = history(id, 'completed', `image-${id}`)
      const result = read().messages.find((message) => message.id === messageId)!.tool_calls[0]
      assert.deepEqual(result.historyIds, [historyId])
      assert.equal(result.failedJobs, undefined)
    }
    const id = job('failed', false)
    const messageId = reply(id)
    assert.equal(read().messages.find((message) => message.id === messageId)!.tool_calls[0].failedJobs, undefined)
  })

  await t.test('moved reply identities and synthetic calls attach once; rereads use persisted status', () => {
    const id = job('failed')
    const oldId = reply(id)
    CodexChatStore.moveGenerationLinks(thread.id, `reply-${id}`, 'regenerated')
    const newId = CodexChatStore.addMessage({ thread_id: thread.id, role: 'assistant', content: '', tool_calls: [], status: 'completed', error: null, routing: { replyId: 'regenerated', replyTo: null, recipients: [] } })
    for (let i = 0; i < 2; i++) {
      const result = read().messages
      assert.equal(result.find((message) => message.id === oldId)!.tool_calls[0].failedJobs, undefined)
      assert.deepEqual(result.find((message) => message.id === newId)!.tool_calls.flatMap((entry) => entry.failedJobs ?? []).map((entry) => entry.jobId), [id])
    }
    const stored = CodexChatStore.listMessages(thread.id)
    assert.ok(stored.every((message) => message.tool_calls.every((entry) => entry.failedJobs === undefined)))
    const outcome = withGenerationOutcomes(stored).find((message) => message.id === oldId)!.tool_calls[0].output
    assert.equal(outcome, generationOutcomeNote(id, { status: 'failed', images: 0 }))
  })

  await t.test('all terminal transitions publish linked chat information only to its owner, including replay', () => {
    const events: RuntimeEventRecord[] = []
    const unsubscribe = subscribeToRuntimeEvents((event) => events.push(event))
    const subscribe = (accountId: number | null, isAdmin = false, resumeCursor: number | null = null) => {
      const frames: string[] = []
      const res = { write: (frame: string) => frames.push(frame), end: () => {}, writableEnded: false } as unknown as Response
      const subscription = RuntimeEventBroadcaster.register({ res, accountId, isAdmin, topics: ['generation-queue'], resumeCursor, revalidateAccess: () => ({ ok: true }) })
      return { frames, ...subscription }
    }
    const cursor = getRuntimeEventCursor()
    const owner = subscribe(1)
    const stranger = subscribe(2)
    const otherAdmin = subscribe(3, true)
    try {
      for (const status of ['completed', 'failed', 'cancelled'] as const) {
        const id = job('running')
        const latest = GenerationQueueService.transitionJob(id, status)
        const finished = events.filter((event) => event.name === 'chat.generation.finished').at(-1)!
        assert.deepEqual(finished.payload, { jobId: id, requestedByAccountId: 1, status, chat: { threadId: thread.id, threadTitle: thread.title, replyId: `reply-${id}`, characterName: '루나' }, imageCount: 0, thumbnailHistoryId: null, failureCode: status === 'completed' ? 'no_image' : 'execution_failed' })
        assert.equal(finished.visibility, 'owner')
        assert.equal(finished.accountId, 1)
        const count = events.length
        publishQueueJobEvent('queue.job.status', latest, { previousStatus: status })
        assert.equal(events.length, count + 1, 'no duplicate chat completion for an unchanged state')
      }
      const before = events.filter((event) => event.name === 'chat.generation.finished').length
      GenerationQueueService.transitionJob(job('running', false), 'failed')
      GenerationQueueService.transitionJob(job('running', true, 2), 'failed')
      assert.equal(events.filter((event) => event.name === 'chat.generation.finished').length, before, 'unlinked or mismatched owners expose no chat')
      assert.ok(owner.frames.some((frame) => frame.includes('event: chat.generation.finished')))
      for (const subscriber of [stranger, otherAdmin]) {
        assert.ok(!subscriber.frames.some((frame) => frame.includes('event: chat.generation.finished')))
        assert.ok(!subscriber.frames.some((frame) => frame.includes('옥상 장면')))
        assert.ok(subscriber.frames.some((frame) => frame.includes('event: queue.job.status')), 'existing shared queue visibility remains')
      }
      const replay = subscribe(3, true, cursor)
      assert.ok(!replay.frames.some((frame) => frame.includes('event: chat.generation.finished')))
      replay.close()
      const ownReplay = subscribe(1, false, cursor)
      assert.ok(ownReplay.frames.some((frame) => frame.includes('event: chat.generation.finished')))
      ownReplay.close()
    } finally {
      unsubscribe()
      owner.close()
      stranger.close()
      otherAdmin.close()
    }
  })

  await t.test('failure cards survive closing and reopening the database', () => {
    const id = job('failed')
    const messageId = reply(id)
    const before = read().messages.find((message) => message.id === messageId)!.tool_calls[0].failedJobs
    dbModule.closeUserSettingsDb()
    dbModule.initializeUserSettingsDb()
    db = dbModule.getUserSettingsDb()
    const after = read().messages.find((message) => message.id === messageId)!.tool_calls[0].failedJobs
    assert.deepEqual(after, before)
    assert.equal(after![0].jobId, id)
  })

  await t.test('notification fields count the whole reply and use the group speaker without exposing other owners', () => {
    const events: RuntimeEventRecord[] = []
    const unsubscribe = subscribeToRuntimeEvents((event) => events.push(event))
    try {
      const first = job('running')
      const second = job('running')
      CodexChatStore.moveGenerationLinks(thread.id, `reply-${second}`, `reply-${first}`)
      const speaker = ChatProfileStore.create({ name: '카이', engine: 'llm', providerName: 'test', model: 'm' })
      CodexChatStore.addMessage({ thread_id: thread.id, role: 'assistant', speaker_profile_id: speaker.id, content: '', tool_calls: [call(first), call(second)], status: 'completed', error: null, routing: { replyId: `reply-${first}`, replyTo: null, recipients: [] } })
      const firstHistory = history(first, 'completed', 'first-image')
      GenerationQueueService.transitionJob(first, 'completed')
      const one = events.filter((event) => event.name === 'chat.generation.finished').at(-1)!.payload as ChatGenerationFinishedEventPayload
      assert.deepEqual([one.imageCount, one.thumbnailHistoryId, one.chat.characterName], [1, firstHistory, '카이'])
      const secondHistory = history(second, 'completed', 'second-image')
      history(second, 'completed', 'foreign-image', 2)
      history(second, 'failed', null)
      GenerationQueueService.transitionJob(second, 'completed')
      const two = events.filter((event) => event.name === 'chat.generation.finished').at(-1)!.payload as ChatGenerationFinishedEventPayload
      assert.equal(two.chat.replyId, one.chat.replyId)
      assert.deepEqual([two.imageCount, two.thumbnailHistoryId], [2, secondHistory])
      assert.equal(two.failureCode, null)
      const empty = job('running')
      CodexChatStore.moveGenerationLinks(thread.id, `reply-${empty}`, `reply-${first}`)
      GenerationQueueService.transitionJob(empty, 'completed')
      const noImage = events.filter((event) => event.name === 'chat.generation.finished').at(-1)!.payload as ChatGenerationFinishedEventPayload
      assert.equal(noImage.imageCount, 2)
      assert.equal(noImage.failureCode, 'no_image', 'another image in the reply does not hide this job’s empty completion')
      const early = job('running')
      db.prepare('UPDATE generation_queue_jobs SET request_payload = ? WHERE id = ?').run(JSON.stringify({ __conaiChatGrant: { context: { chatContext: { threadId: thread.id, profileId: speaker.id } } } }), early)
      GenerationQueueService.transitionJob(early, 'completed')
      const beforeMessage = events.filter((event) => event.name === 'chat.generation.finished').at(-1)!.payload as ChatGenerationFinishedEventPayload
      assert.equal(beforeMessage.chat.characterName, '카이', 'the server-issued chat grant identifies the speaker before its reply is stored')
    } finally {
      unsubscribe()
    }
  })
})
