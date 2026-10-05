import assert from 'node:assert/strict'
import { test } from 'node:test'
import { markCacheBreakpoints, REFERENCE_BLOCK_START, type ChatCompletionMessage } from '../src/services/codex-chat/llmChatCompletion'

const MARK = { type: 'ephemeral' }

function marked(messages: unknown[]) {
  return messages.flatMap((message, index) => {
    const content = (message as { content: unknown }).content
    return Array.isArray(content) && content.some((part) => (part as { cache_control?: unknown }).cache_control) ? [index] : []
  })
}

test('the system prompt, the message before the reference block and the message before the last user message are marked', () => {
  const messages: ChatCompletionMessage[] = [
    { role: 'system', content: '너는 카이야.' },
    { role: 'system', content: '## 지금까지의 대화 요약\n…' },
    { role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'u2' }, { role: 'assistant', content: 'a2' },
    { role: 'user', content: `${REFERENCE_BLOCK_START}\n카이는 왼손잡이다.\n[/참고 설정]\n\nu3` }, { role: 'assistant', content: 'a3' },
    { role: 'user', content: 'u4' }, { role: 'assistant', content: 'a4' },
    { role: 'user', content: 'u5' },
  ]
  const result = markCacheBreakpoints(messages)
  // a2 (index 5) is an assistant message, so the mark moves back to u2 (4); a4 (9) likewise moves back to u4 (8).
  assert.deepEqual(marked(result), [0, 4, 8])
  assert.deepEqual(result[0], { role: 'system', content: [{ type: 'text', text: '너는 카이야.', cache_control: MARK }] })
  assert.deepEqual(result[4], { role: 'user', content: [{ type: 'text', text: 'u2', cache_control: MARK }] })
  assert.equal(result[10], messages[10], 'the latest user message is never marked')
  assert.equal(result[6], messages[6], 'the reference block itself is not marked')
})

test('marks never exceed four and multimodal content keeps its image parts', () => {
  const image = { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,AAAA' } }
  const messages: ChatCompletionMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: [{ type: 'text', text: '이거 봐' }, image] },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'u2' },
  ]
  const result = markCacheBreakpoints(messages)
  assert.ok(marked(result).length <= 4)
  // The user message's last part is an image, so it is left alone rather than marked wrongly.
  assert.equal(result[1], messages[1])
})

test('a conversation with only the latest user message marks just the system prompt', () => {
  const result = markCacheBreakpoints([{ role: 'system', content: 'sys' }, { role: 'user', content: '안녕' }])
  assert.deepEqual(marked(result), [0])
})
