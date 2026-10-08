import { useEffect, useState } from 'react'
import type { ClaudeModelOption } from '@conai/shared'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'

type ClaudeModelSelectProps = {
  value: string
  onChange: (value: string) => void
  models: ClaudeModelOption[] | undefined
  'aria-label'?: string
}

/** Claude Code model dropdown from the server CLI's list; a free-text field (committed on blur) while it can't list them. */
export function ClaudeModelSelect({ value, onChange, models, 'aria-label': ariaLabel }: ClaudeModelSelectProps) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => setDraft(null), [value])

  if (!models || models.length === 0) {
    return (
      <Input
        variant="settings"
        value={draft ?? value}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== null && draft.trim() !== value) onChange(draft.trim())
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        maxLength={200}
        placeholder="sonnet"
        aria-label={ariaLabel}
      />
    )
  }

  // Aliases (opus, sonnet…) follow the newest version; full IDs stay pinned.
  const aliases = models.filter((model) => !model.id.startsWith('claude-'))
  const pinned = models.filter((model) => model.id.startsWith('claude-'))
  // A value the list doesn't have (typed earlier, or dropped from the CLI) stays selected.
  const hasCustomValue = value !== '' && !models.some((model) => model.id === value)

  return (
    <Select variant="settings" value={value} onChange={(event) => onChange(event.target.value)} aria-label={ariaLabel}>
      {value === '' ? <option value="">{t({ ko: '기본값 (sonnet)', en: 'Default (sonnet)' })}</option> : null}
      {hasCustomValue ? <option value={value}>{value}</option> : null}
      {aliases.length > 0 ? (
        <optgroup label={t({ ko: '최신 버전', en: 'Latest' })}>
          {aliases.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
        </optgroup>
      ) : null}
      {pinned.length > 0 ? (
        <optgroup label={t({ ko: '고정 버전', en: 'Pinned' })}>
          {pinned.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
        </optgroup>
      ) : null}
    </Select>
  )
}

const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
type ClaudeEffort = typeof CLAUDE_EFFORTS[number]

/** The levels the picked model takes, as the CLI lists them; every level while the model isn't in the list. */
export function ClaudeEffortSelect({ value, model, models, onChange }: {
  value: string
  model: string
  models: ClaudeModelOption[] | undefined
  onChange: (value: ClaudeEffort | '') => void
}) {
  const { t } = useI18n()
  const listed = models?.find((entry) => entry.id === (model || 'sonnet'))
  const efforts = listed ? CLAUDE_EFFORTS.filter((effort) => listed.supportedEffortLevels.includes(effort)) : CLAUDE_EFFORTS
  const labels: Record<string, string> = {
    low: t({ ko: '낮음', en: 'Low' }),
    medium: t({ ko: '보통', en: 'Medium' }),
    high: t({ ko: '높음', en: 'High' }),
    xhigh: t({ ko: '매우 높음', en: 'Extra high' }),
    max: t({ ko: '최대', en: 'Max' }),
  }

  return (
    <Select variant="settings" value={value} onChange={(event) => onChange(event.target.value as ClaudeEffort | '')} aria-label={t({ ko: '추론 강도', en: 'Reasoning effort' })}>
      <option value="">{t({ ko: '기본값', en: 'Default' })}</option>
      {efforts.map((effort) => <option key={effort} value={effort}>{labels[effort]}</option>)}
      {value && !(efforts as readonly string[]).includes(value) ? <option value={value} disabled>{labels[value] ?? value} · {t({ ko: '지원 안 함', en: 'Unsupported' })}</option> : null}
    </Select>
  )
}
