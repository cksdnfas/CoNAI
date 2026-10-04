import type { CodexChatMessageRecord, CodexChatThreadRecord } from './codexChatStore'
import type { CodexChatMediaItem } from './codexChatMedia'

function label(text: string) {
  return text.replace(/[\r\n]+/g, ' ').replace(/[\\[\]]/g, '\\$&')
}

/** `speakers` names group room members by profile id; other replies are `name`'s. */
export function exportChatMarkdown(thread: CodexChatThreadRecord, messages: CodexChatMessageRecord[], media: CodexChatMediaItem[], name: string, origin: string, speakers?: Map<number, string>) {
  const lines = [`# ${label(thread.title || '새 채팅')}`, '']
  if (thread.summary) lines.push('## 대화 요약', '', thread.summary, '')
  const byMessage = new Map<number, CodexChatMediaItem[]>()
  for (const item of media) byMessage.set(item.messageId, [...(byMessage.get(item.messageId) ?? []), item])
  for (const message of messages) {
    const speaker = message.role === 'user' ? '사용자' : (message.speaker_profile_id !== null && speakers?.get(message.speaker_profile_id)) || name
    lines.push(`## ${label(speaker)} · ${message.created_date} UTC`, '', message.content, '')
    for (const file of message.attachments ?? []) lines.push(`- [${label(file.name)}](${origin}/api/files/${encodeURIComponent(file.id)}/download)`)
    for (const item of byMessage.get(message.id) ?? []) lines.push(`- [${item.source === 'generated' ? '생성 이미지' : '이미지'}](${origin}/api/images/${encodeURIComponent(item.compositeHash)}/file)`)
    if (message.attachments?.length || byMessage.has(message.id)) lines.push('')
  }
  return lines.join('\n')
}
