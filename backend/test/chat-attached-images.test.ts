import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { StoredFileEntry } from '@conai/shared'
import { attachedImageKey, attachedImagesOf, chatContentWithAttachments } from '../src/services/codex-chat/chatAttachments'
import { contextContentText } from '../src/services/codex-chat/chatContextDiagnostics'
import { profileSeesImages } from '../src/services/codex-chat/chatProfiles'
import { redactChatRequestBody } from '../src/services/codex-chat/chatRequestCaptures'
import { codexTurnInput } from '../src/services/codex-chat/codexChatService'
import type { CodexChatMessageRecord } from '../src/services/codex-chat/codexChatStore'
import { appendUserDirective, toCompletionMessages } from '../src/services/codex-chat/llmChatContext'

const HASH = 'a'.repeat(48)
const media = [{ compositeHash: HASH, name: 'cat.png', mimeType: 'image/png' }]
const imageFile = { id: 'b'.repeat(32), name: 'dog.jpg', size: 10, mimeType: 'image/jpeg' } as StoredFileEntry
const URL_A = 'data:image/jpeg;base64,AAAA'
const URL_B = 'data:image/jpeg;base64,BBBB'

test('Codex profiles always see images; LLM and Claude follow the switch', () => {
  assert.equal(profileSeesImages({ engine: 'codex', visionEnabled: false }), true)
  assert.equal(profileSeesImages({ engine: 'llm', visionEnabled: false }), false)
  assert.equal(profileSeesImages({ engine: 'claude', visionEnabled: true }), true)
})

test('attached images go with the message as images, never as a view_images pointer', () => {
  const shown = new Map([[attachedImageKey('media', HASH), URL_A], [attachedImageKey('file', imageFile.id), URL_B]])
  const text = chatContentWithAttachments('이거 분석좀', [imageFile], media, undefined, shown)
  assert.match(text, /included with this message as images/)
  assert.doesNotMatch(text, /view_images|metadata only/)
  assert.deepEqual(attachedImagesOf({ attachments: [imageFile], mediaAttachments: media }, shown), [URL_A, URL_B])

  // A model that cannot see is told so plainly instead of being sent to a tool it does not have.
  const blind = chatContentWithAttachments('이거 분석좀', [], media, undefined, null)
  assert.match(blind, /cannot see images/)
  assert.doesNotMatch(blind, /view_images/)
  // Beyond the shown few: a reference it can open itself.
  assert.match(chatContentWithAttachments('', [], media, undefined, new Map()), /view_images with composite_hashes/)
})

test('an LLM user turn with attached images is text plus image parts, and the directive joins it', () => {
  const message = { id: 3, role: 'user', content: '이거 분석좀', tool_calls: [], mediaAttachments: media, attachments: [] } as unknown as CodexChatMessageRecord
  const [turn] = toCompletionMessages(message, undefined, undefined, undefined, new Map([[attachedImageKey('media', HASH), URL_A]]))
  assert.ok(Array.isArray(turn.content))
  assert.deepEqual(turn.content.slice(1), [{ type: 'image_url', image_url: { url: URL_A } }])
  assert.equal(typeof toCompletionMessages(message)[0].content, 'string')

  const withDirective = appendUserDirective([turn], '짧게 답해.')
  assert.equal(withDirective.length, 1)
  const parts = withDirective[0].content as Array<{ type: string; text?: string }>
  assert.match(parts[parts.length - 1].text ?? '', /짧게 답해/)
  // Estimates and captures never carry the base64.
  assert.doesNotMatch(contextContentText(turn.content), /AAAA/)
  assert.doesNotMatch(redactChatRequestBody({ messages: [turn] }), /AAAA/)
})

test('a Codex turn carries the attached images as image inputs', () => {
  assert.deepEqual(codexTurnInput('hi', [URL_A]), [{ type: 'text', text: 'hi', text_elements: [] }, { type: 'image', url: URL_A }])
  assert.deepEqual(codexTurnInput('hi', []), [{ type: 'text', text: 'hi', text_elements: [] }])
})
