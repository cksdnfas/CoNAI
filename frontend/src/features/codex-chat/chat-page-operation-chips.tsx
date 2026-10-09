import { AppWindow, ArrowUpRight, PencilLine, Undo2 } from 'lucide-react'
import type { ChatPageOperation } from '@conai/shared'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { CodexChatToolCall } from '@/lib/api-codex-chat'
import { PAGE_ACCESS_CATALOG } from '@/features/auth/page-access-catalog'
import { SETTINGS_TAB_LABELS, type SettingsTab } from '@/features/settings/settings-tabs'
import { useChatPage } from './chat-page-context'

/** `/settings?section=chat` → "설정 › 채팅"; other tabs keep their raw value after the page name. */
function useDestinationLabel() {
  const { t } = useI18n()
  return (to: string) => {
    const [path, query = ''] = to.split('?')
    const page = PAGE_ACCESS_CATALOG.find((item) => item.path === path)
    const name = page ? t(page.labelKey) : path
    const view = new URLSearchParams(query)
    const section = view.get('section') as SettingsTab | null
    const tab = section && SETTINGS_TAB_LABELS[section] ? t(SETTINGS_TAB_LABELS[section]) : view.get('tab')
    return tab ? `${name} › ${tab}` : name
  }
}

/**
 * The page operations a reply ran (navigate, open, fill), one chip each under the reply. A draft the reader's own tab
 * still holds gets an undo icon; it is gone after a reload or on another device, where only the record remains.
 */
export function ChatPageOperationChips({ calls }: { calls: CodexChatToolCall[] }) {
  const page = useChatPage()
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const destination = useDestinationLabel()
  const operations = calls.flatMap((call) => call.status === 'completed' && call.pageOperation ? [{ id: call.id, tool: call.tool, ...call.pageOperation }] : [])
  if (!operations.length) return null
  const undo = (operation: ChatPageOperation) => {
    try { page?.undoActivity(operation.commandId) }
    catch (error) { showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '되돌리지 못했어.', en: 'Could not undo.' }), tone: 'error' }) }
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {operations.map((operation) => {
        const entry = page?.activity.find((item) => item.id === operation.commandId)
        const navigate = operation.tool === 'page_act' && operation.label.startsWith('/')
        const Icon = operation.tier === 'draft' ? PencilLine : navigate ? ArrowUpRight : AppWindow
        return (
          <span
            key={operation.id}
            className={cn('inline-flex h-6 max-w-full items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs text-muted-foreground', operation.tier === 'draft' && 'text-foreground', entry?.state === 'undone' && 'line-through opacity-60')}
          >
            <Icon className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{navigate ? destination(operation.label) : operation.label}</span>
            {operation.tier === 'draft' && entry?.undo && entry.state === 'done'
              ? <IconButton variant="ghost" size="icon-xs" className="-mr-2 size-5 rounded-full text-primary" label={t({ ko: '되돌리기', en: 'Undo' })} onClick={() => undo(operation)}><Undo2 /></IconButton>
              : null}
          </span>
        )
      })}
    </div>
  )
}
