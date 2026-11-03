import type { ChatExecutionContext } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { isPublicChatPage, type McpRequester } from '../../mcp/context'
import { FileStoreError } from '../fileStoreService'
import { BoardCallRooms } from '../posts/boardCallRooms'
import { isBoardRoom } from './chatRoomWake'

/** Retained until the room is deleted: summaries, tool outputs and engine memory can outlive the original file. */
export function hasPrivateAttachmentContext(threadId: number): boolean {
  return Boolean(getUserSettingsDb().prepare('SELECT 1 FROM chat_private_attachment_contexts WHERE thread_id = ?').get(threadId))
}

export function markPrivateAttachmentContext(threadId: number) {
  getUserSettingsDb().prepare('INSERT OR IGNORE INTO chat_private_attachment_contexts (thread_id) VALUES (?)').run(threadId)
}

export function requirePrivateAttachmentDestination(threadId: number) {
  if (isBoardRoom(threadId)) {
    throw new FileStoreError('게시판 자동화 방에는 개인 첨부를 올리거나 연결할 수 없어. 개인 파일은 일반 채팅에서 사용해줘.', 403)
  }
}

export function requirePrivateAttachmentRun(requester: McpRequester, context: ChatExecutionContext | undefined, newPrivateFiles = false) {
  if (!context) return
  if (newPrivateFiles) requirePrivateAttachmentDestination(context.threadId)
  const boardCall = BoardCallRooms.active(context.threadId)
  if ((boardCall || isPublicChatPage({ requester, chatContext: context, scopes: [] })) && (newPrivateFiles || hasPrivateAttachmentContext(context.threadId))) {
    if (boardCall) {
      const thread = getUserSettingsDb().prepare('SELECT title FROM codex_chat_threads WHERE id = ?').get(context.threadId) as { title: string } | undefined
      throw new FileStoreError(`"${thread?.title || '이 게시판 채팅'}" 방에 개인 첨부가 있거나 그 내용이 남아 있어. 채팅 목록에서 이 방을 삭제하면 다음 게시판 호출 때 새 방이 만들어져 다시 사용할 수 있어. 백업이 막히면 이 방은 "그냥 지우기"를 선택해줘.`, 403)
    }
    throw new FileStoreError('개인 첨부를 사용한 채팅은 공개 페이지에서 실행할 수 없어. 개인 첨부가 없는 별도 채팅을 사용해줘.', 403)
  }
}

/** Removing attachment metadata cannot redact model-derived prose, summaries or raw request captures safely. */
export function requireSharedChatExport(threadId: number, kind: 'backup' | 'diagnostics' = 'backup') {
  if (hasPrivateAttachmentContext(threadId)) {
    const thread = getUserSettingsDb().prepare('SELECT title FROM codex_chat_threads WHERE id = ?').get(threadId) as { title: string } | undefined
    if (kind === 'diagnostics') throw new FileStoreError(`"${thread?.title || '이 채팅'}"은 개인 첨부를 사용해서 공용 폴더에 진단을 저장할 수 없어. 진단은 이 채팅 안에서 확인해줘.`, 403)
    throw new FileStoreError(`"${thread?.title || '이 채팅'}"은 개인 첨부를 사용해서 공용 파일 보관함에 백업을 저장할 수 없어. 필요하면 대화를 다운로드한 뒤 이 채팅은 "그냥 지우기"로 삭제해줘.`, 403)
  }
}
