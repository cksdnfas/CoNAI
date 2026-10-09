import { CODEX_REASONING_EFFORTS } from '@conai/shared'
import { ExternalApiProvider } from '../../models/ExternalApiProvider'
import { ChatProfileStore } from '../codex-chat/chatProfiles'
import { LLM_CONNECTION_TYPES, MODEL_CONNECTION_TYPES, ModelSlotStore } from '../codex-chat/modelSlots'
import { getCodexModelSuggestions } from '../codexGenerationOptions'
import type { NodeOption, NodeOptionSource } from './node-option-sources'

/** Model rows on connections of `kinds`, labelled `model · connection`; rows of a connection that is off or gone stay visible but unpickable. */
function modelRowOptions(kinds: readonly string[]): NodeOption[] {
  const connections = new Map(ExternalApiProvider.findAll().map((provider) => [provider.provider_name, provider]))
  return ModelSlotStore.list()
    .filter((slot) => slot.providerType === null || kinds.includes(slot.providerType))
    .map((slot) => ({
      value: String(slot.id),
      label: `${slot.model} · ${slot.providerLabel}`,
      ...(slot.isDefault ? { is_default: true } : {}),
      ...(connections.get(slot.providerName)?.is_enabled ? {} : { disabled: true }),
    }))
}

/** The account's Codex models as the CLI lists them (newest first); ★ marks the CLI's configured default. */
async function codexModelOptions(): Promise<NodeOption[]> {
  const { models } = await getCodexModelSuggestions().catch(() => ({ models: [] }))
  return models.map((model) => ({ value: model.id, label: model.label || model.id, ...(model.isDefault ? { is_default: true } : {}) }))
}

const CODEX_REASONING_LABELS: Record<string, string> = {
  none: '없음', minimal: '최소', low: '낮음', medium: '보통', high: '높음', xhigh: '매우 높음', max: '최대', ultra: '울트라',
}

/** Reasoning levels any listed Codex model supports, weakest first; the empty choice keeps the model's own default. */
async function codexReasoningEffortOptions(): Promise<NodeOption[]> {
  const { models } = await getCodexModelSuggestions().catch(() => ({ models: [] }))
  const supported = new Set(models.flatMap((model) => model.supportedReasoningEfforts ?? []))
  return [
    { value: '', label: '기본' },
    ...CODEX_REASONING_EFFORTS.filter((effort) => supported.has(effort)).map((effort) => ({ value: effort, label: CODEX_REASONING_LABELS[effort] ?? effort })),
  ]
}

/** Option lists for LLM node fields (model rows, chat profiles, Codex models). */
export const LLM_NODE_OPTION_SOURCES: Record<string, NodeOptionSource> = {
  llm_model_rows: () => modelRowOptions(LLM_CONNECTION_TYPES),
  judge_model_rows: () => modelRowOptions(MODEL_CONNECTION_TYPES),
  chat_profiles: () => ChatProfileStore.list().map((profile) => ({
    value: String(profile.id),
    label: profile.isEnabled ? profile.name : `${profile.name} (꺼짐)`,
    ...(profile.isEnabled ? {} : { disabled: true }),
  })),
  codex_models: codexModelOptions,
  codex_reasoning_efforts: codexReasoningEffortOptions,
}
