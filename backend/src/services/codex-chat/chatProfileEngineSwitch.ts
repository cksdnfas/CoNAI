import { logger } from '../../utils/logger'
import { ChatGroupStore } from './chatGroupStore'
import { ChatProfileError, type ChatProfileEngine } from './chatProfiles'
import { deleteClaudeMemberSession, deleteClaudeSessions } from './claudeChatSessions'
import { CodexChatService, deleteCodexRollout } from './codexChatService'
import { CodexChatStore } from './codexChatStore'
import { GroupChatService } from './groupChatService'

/**
 * The admin save of a profile's engine converts the chats using it (ChatProfileStore.update's `engineSwitch`): the
 * stores rewrite them in the save's transaction, refused while one is answering; the old engine's sessions are
 * deleted by `cleanup` once the save has committed. A session target's first turn starts a new session, which the
 * existing recap fills from the kept history; an API LLM direct chat goes on from its recent turns past the summary
 * cursor the conversion places.
 */
export function profileEngineSwitch(profileId: number) {
  type OldSession = { threadId: number; accountId: number | null; codexThreadId: string | null }
  let directs: OldSession[] = []
  let members: OldSession[] = []
  // The save is already committed: a failed deletion (a locked file) is logged and the others still go.
  const attempt = (what: string, remove: () => void) => {
    try {
      remove()
    } catch (error) {
      logger.warn(`[CodexChat] Could not delete ${what}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return {
    /** `llmTurns`: the new profile's context turns when it is an API LLM (not pi), else null. */
    engineSwitch(from: ChatProfileEngine, to: ChatProfileEngine, llmTurns: number | null) {
      const threadIds = [...CodexChatStore.directThreadIdsOfProfile(profileId), ...ChatGroupStore.roomIdsOfProfile(profileId)]
      const busy = threadIds.filter((id) => CodexChatService.isRunning(id) || GroupChatService.isRunning(id)).length
      if (busy > 0) throw new ChatProfileError(`이 프로필의 대화 ${busy}개가 답변 중이야. 끝난 뒤 다시 저장해줘.`)
      directs = CodexChatStore.switchProfileEngine(profileId, from, to, llmTurns)
      members = ChatGroupStore.switchProfileEngine(profileId, from, to)
    },
    /**
     * Best effort, after the commit. Each rollout is deleted as the chat's owner, whose Codex home holds it; a room
     * keeps its other members' sessions.
     */
    cleanup() {
      for (const { threadId, accountId, codexThreadId } of directs) {
        attempt(`Codex thread ${codexThreadId}`, () => deleteCodexRollout({ accountId, accountType: null }, codexThreadId))
        attempt(`sessions of chat ${threadId}`, () => deleteClaudeSessions(threadId))
      }
      for (const { threadId, accountId, codexThreadId } of members) {
        attempt(`Codex thread ${codexThreadId}`, () => deleteCodexRollout({ accountId, accountType: null }, codexThreadId))
        attempt(`session of profile ${profileId} in chat ${threadId}`, () => deleteClaudeMemberSession(threadId, profileId))
      }
    },
  }
}
