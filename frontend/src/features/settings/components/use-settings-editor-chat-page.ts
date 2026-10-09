import type { ChatPageAction, ChatPageData, ChatPageField, ChatPageValue } from '@conai/shared'
import { useI18n } from '@/i18n'
import { useChatPageRegistration, type WorkflowUndo } from '@/features/codex-chat/chat-page-context'
import { pageAction } from '@/features/codex-chat/page-action-helpers'

/** The side panel stays usable beside a settings editor the chat is filling. */
export const CHAT_DOCK_INSET = 'var(--chat-dock-width, 0px)'

/**
 * Registers an open settings editor (lorebook, generation preset, judge preset, block, tool preset) with a connected
 * chat. The chat fills the registered fields right away (draft); saving is a review card (`resource.save`).
 */
export function useSettingsEditorChatPage({ open, title, resourceId, fields, data, dirty, apply, actions, applyAction, save }: {
  open: boolean
  title: string
  resourceId: string
  fields: ChatPageField[]
  data: Record<string, ChatPageData>
  dirty: boolean
  apply: (patch: Record<string, ChatPageValue>) => void
  actions?: ChatPageAction[]
  applyAction?: (id: string, args: Record<string, ChatPageData>) => WorkflowUndo | void
  /** Left out: the chat can read and fill the editor but never asks to save it. */
  save?: () => Promise<unknown>
}) {
  const { t } = useI18n()
  useChatPageRegistration(open ? {
    kind: 'settings', title, resourceId, priority: 20, dirty, fields, data,
    actions: [
      ...(actions ?? []),
      ...(save ? [pageAction('resource.save', t({ ko: '저장', en: 'Save' }), t({ ko: '편집기의 지금 내용을 저장해.', en: 'Save the editor as it is now.' }), undefined, 'save')] : []),
    ],
    apply,
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (id === 'resource.save' && save) { await save(); return }
      if (!applyAction) throw new Error('이 편집기에 없는 작업이야.')
      return applyAction(id, args)
    },
  } : null)
}
