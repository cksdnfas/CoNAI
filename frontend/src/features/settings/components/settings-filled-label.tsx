import type { PropsWithChildren } from 'react'
import { SETTINGS_ROW_BY_ID } from '@conai/shared'
import { ChatFilledLabel as FilledLabel } from '@/features/codex-chat/chat-page-context'
import { useI18n } from '@/i18n'

/**
 * Preserve assistant field IDs and filled markers while sharing names with search and the page sheet. The registry
 * description stays a search keyword and assistant hint; background for a row goes in its ⓘ (`info`).
 */
export function ChatFilledLabel({ fieldId, settingId = fieldId, children }: PropsWithChildren<{ fieldId: string; settingId?: string }>) {
  const { t } = useI18n()
  const row = SETTINGS_ROW_BY_ID[settingId]
  return <span data-setting-id={settingId}><FilledLabel fieldId={fieldId}>{row ? t(row.label) : children}</FilledLabel></span>
}
