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
  const dbModule = await import('../src/database/userSettingsDb')
  dbModule.initializeUserSettingsDb()
  ;(await import('../src/models/ExternalApiProvider')).ExternalApiProvider.create({ provider_name: 'test', display_name: 'test', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { attachJobResults, withGenerationOutcomes, generationOutcomeNote } = await import('../src/services/codex-chat/codexChatMedia')
  const { GenerationQueueService } = await import('../src/services/generationQueueService')
  const { publishQueueJobEvent } = await import('../src/services/runtime-events/runtimeEventPublishers')
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
