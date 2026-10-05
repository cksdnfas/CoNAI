import type { CodexChatMessageRecord, CodexChatThreadRecord } from './codexChatStore'
import type { CodexChatMediaItem } from './codexChatMedia'
import { userPersonaForThread } from './chatUserProfiles'

function label(text: string) {
  return text.replace(/[\r\n]+/g, ' ').replace(/[\\[\]]/g, '\\$&')
}

/** `speakers` names group room members by profile id; other replies are `name`'s. */
export function exportChatMarkdown(thread: CodexChatThreadRecord, messages: CodexChatMessageRecord[], media: CodexChatMediaItem[], name: string, origin: string, speakers?: Map<number, string>) {
  const lines = [`# ${label(thread.title || '새 채팅')}`, '']
  if (thread.summary) lines.push('## 대화 요약', '', thread.summary, '')
  const byMessage = new Map<number, CodexChatMediaItem[]>()
  for (const item of media) byMessage.set(item.messageId, [...(byMessage.get(item.messageId) ?? []), item])
  const userName = userPersonaForThread(thread).name
  for (const message of messages) {
    const speaker = message.role === 'user' ? userName : (message.speaker_profile_id !== null && speakers?.get(message.speaker_profile_id)) || name
    lines.push(`<a id="message-${message.id}"></a>`, `## ${label(speaker)} · ${message.created_date} UTC`, '')
    const routing = message.routing
    if (routing) {
      const recipients = routing.recipients.map((id) => typeof id === 'number' ? speakers?.get(id) ?? name : id === 'user' ? userName : '방 전체')
      if (recipients.length) lines.push(`받는 사람: ${recipients.map(label).join(', ')}`, '')
      if (routing.replyTo) {
        const quote = routing.replyTo
        lines.push(`> ${label(quote.speakerName)}에게 답장 · ${quote.unavailable ? '삭제된 메시지' : `[원문](#message-${quote.messageId})`}`)
        if (!quote.unavailable) lines.push(...quote.excerpt.split('\n').map((line) => `> ${line}`))
        lines.push('')
      }
    }
    lines.push(message.display_content ?? message.content, '')
    if (message.display_content) lines.push('<details><summary>원문</summary>', '', message.content, '', '</details>', '')
    for (const file of message.attachments ?? []) lines.push(`- [${label(file.name)}](${origin}/api/files/${encodeURIComponent(file.id)}/download)`)
    for (const item of message.mediaAttachments ?? []) lines.push(`- [${label(item.name)}](${origin}/api/images/${encodeURIComponent(item.compositeHash)}/file)`)
    for (const item of byMessage.get(message.id) ?? []) lines.push(`- [${item.source === 'generated' ? '생성 이미지' : '이미지'}](${origin}/api/images/${encodeURIComponent(item.compositeHash)}/file)`)
    if (message.attachments?.length || message.mediaAttachments?.length || byMessage.has(message.id)) lines.push('')
  }
  return lines.join('\n')
}
