import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Select } from '@/components/ui/select'
import { CodexModelSelect } from '@/features/image-generation/components/codex-model-select'
import { ClaudeModelSelect } from '@/features/settings/components/claude-model-select'
import { useI18n } from '@/i18n'
import { getClaudeModels } from '@/lib/api-agent-cli'
import { CHAT_MODEL_OPTIONS_QUERY_KEY, listChatModelOptions, type ChatEngine, type ChatModelOverride, type ChatModelOverridePatch } from '@/lib/api-codex-chat'
import { getCodexGenerationModels } from '@/lib/api-image-generation-queue'
import { ChatModelOptionItems } from './chat-model-option-items'

const CLI_MODELS_STALE_MS = 5 * 60 * 1000

/**
 * The model one chat (or one member of a room) answers with instead of its profile's: a model slot for LLM profiles,
 * the CLI's model for Claude Code and Codex. The empty choice follows the profile again (the patch sends null). Only the
 * shown engine's list is read; a CLI list the account cannot read leaves the free-text field.
 */
export function ChatModelOverrideSelect({ engine, value, profileModelLabel, onChange, disabled, 'aria-label': ariaLabel }: {
  /** The profile's engine: it decides which field the patch sets. */
  engine: ChatEngine
  value: Pick<ChatModelOverride, 'slotId' | 'model'>
  /** The profile's own model, named on the empty choice. */
  profileModelLabel: string
  /** Saves the patch; a rejection means the stored model stayed (the caller reports the error). */
  onChange: (patch: ChatModelOverridePatch) => Promise<unknown>
  disabled?: boolean
  'aria-label': string
}) {
  const { t } = useI18n()
  // The free-text fallback keeps its draft until the stored value changes, which a failed save never does; remounting
  // the field after one shows the stored model again instead of the rejected text.
  const [failedSaves, setFailedSaves] = useState(0)
  const save = (patch: ChatModelOverridePatch) => {
    onChange(patch).catch(() => setFailedSaves((count) => count + 1))
  }
  const slots = useQuery({ queryKey: CHAT_MODEL_OPTIONS_QUERY_KEY, queryFn: listChatModelOptions, staleTime: 60_000, enabled: engine === 'llm' })
  const claudeModels = useQuery({ queryKey: ['claude-models'], queryFn: getClaudeModels, staleTime: CLI_MODELS_STALE_MS, enabled: engine === 'claude' })
  const codexModels = useQuery({ queryKey: ['codex-generation-models'], queryFn: getCodexGenerationModels, staleTime: CLI_MODELS_STALE_MS, enabled: engine === 'codex' })
  const profileLabel = t({ ko: '프로필', en: 'Profile' })
  const emptyLabel = profileModelLabel ? `${profileLabel} (${profileModelLabel})` : profileLabel
  const pickModel = (model: string) => save({ chatModel: model || null })

  if (engine === 'claude') {
    return <ClaudeModelSelect key={failedSaves} variant="default" className="w-48" value={value.model ?? ''} models={claudeModels.data?.models} emptyLabel={emptyLabel} onChange={pickModel} disabled={disabled} aria-label={ariaLabel} />
  }
  if (engine === 'codex') {
    return <CodexModelSelect key={failedSaves} className="w-48" value={value.model ?? ''} models={codexModels.data?.data.models} emptyLabel={emptyLabel} onChange={pickModel} disabled={disabled} aria-label={ariaLabel} />
  }
  return (
    <Select
      className="w-48"
      value={value.slotId === null ? '' : String(value.slotId)}
      onChange={(event) => save({ chatModelSlotId: event.target.value ? Number(event.target.value) : null })}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      <option value="">{emptyLabel}</option>
      <ChatModelOptionItems models={slots.data ?? []} part="chat" />
    </Select>
  )
}
