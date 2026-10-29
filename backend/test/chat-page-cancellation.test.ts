import './support/testTemp'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatPageCommandEvent, ChatPageSnapshot } from '@conai/shared'
import { chatPageReplySignal, claimChatPageCommand, resolveChatPageCommand, runChatPageCommand } from '../src/services/codex-chat/chatPageBridge'
import { registerChatReply } from '../src/services/codex-chat/chatReplyRegistry'
import { subscribeToRuntimeEvents } from '../src/services/runtime-events/runtimeEventBus'

test('stopping a reply revokes pending page commands by id', async () => {
  const requester = { accountId: null, accountType: null }
  const page: ChatPageSnapshot = { instanceId: 'screen', connectionId: 'connection', path: '/chat', title: 'Chat', kind: 'page', resourceId: null, fields: [] }
  const events: ChatPageCommandEvent[] = []
  const unsubscribe = subscribeToRuntimeEvents((event) => {
    if (event.name === 'chat.page.command') events.push(event.payload as ChatPageCommandEvent)
  })
  const controller = new AbortController()
  const chatContext = { threadId: 1, profileId: 7, kind: 'direct' as const, replyId: 'reply-1' }
  const unregister = registerChatReply(chatContext, controller.signal, () => ({ replyTo: null, recipients: ['user'] }))
  try {
    const context = { requester, chatContext, scopes: ['read' as const], source: 'llm-chat' as const }
    const command = runChatPageCommand(requester, page, 1, { type: 'fields', changes: [] }, { commandId: 'pending', signal: chatPageReplySignal(context) })
    controller.abort()
    await assert.rejects(command, { name: 'AbortError' })
    assert.deepEqual(events.map((event) => [event.type, event.commandId]), [['fields', 'pending'], ['cancel', 'pending']])
    assert.equal(events[0].requiresClaim, true)
    assert.throws(() => chatPageReplySignal(context), /interrupted/)
    assert.throws(() => claimChatPageCommand(requester, 'pending', page.connectionId), { status: 404 })
    assert.throws(() => resolveChatPageCommand(requester, 'pending', { ok: true, page }), { status: 404 })

    const next = runChatPageCommand(requester, page, 1, { type: 'capture' }, { commandId: 'next' })
    assert.throws(() => claimChatPageCommand(requester, 'next', 'other'), { status: 404 })
    claimChatPageCommand(requester, 'next', page.connectionId)
    assert.throws(() => claimChatPageCommand(requester, 'next', page.connectionId), { status: 404 })
    resolveChatPageCommand(requester, 'next', { ok: false, error: 'stopped' })
    await assert.rejects(next, /stopped/)
  } finally { unregister(); unsubscribe() }
})
