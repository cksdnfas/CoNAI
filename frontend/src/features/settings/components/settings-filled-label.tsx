import type { PropsWithChildren } from 'react'
import { SETTINGS_ROW_BY_ID } from '@conai/shared'
import { ChatFilledLabel as FilledLabel } from '@/features/codex-chat/chat-page-context'
import { useI18n } from '@/i18n'

/** Preserve assistant field IDs and filled markers while sharing names with search and the page sheet. */
export function ChatFilledLabel({ fieldId, settingId = fieldId, children }: PropsWithChildren<{ fieldId: string; settingId?: string }>) {
  const { t } = useI18n()
  const row = SETTINGS_ROW_BY_ID[settingId]
  const description = row ? t(row.description) : ''
  return <span data-setting-id={settingId}><FilledLabel fieldId={fieldId}>{row ? t(row.label) : children}</FilledLabel>{description ? <span className="block text-xs font-normal text-muted-foreground">{description}</span> : null}</span>
}
