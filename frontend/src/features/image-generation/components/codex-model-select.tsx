import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import type { CodexModelOption } from '@/lib/api-image-generation-queue'

type CodexModelSelectProps = {
  value: string
  onChange: (value: string) => void
  models: CodexModelOption[] | undefined
  variant?: 'default' | 'settings'
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

/** Codex agent model dropdown; falls back to a free-text field (committed on blur) while the server can't list models. */
export function CodexModelSelect({ value, onChange, models, variant = 'default', disabled, className, 'aria-label': ariaLabel }: CodexModelSelectProps) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => setDraft(null), [value])
  const defaultModel = models?.find((model) => model.isDefault)
  const defaultLabel = defaultModel
    ? t({ ko: `기본값 (${defaultModel.label})`, en: `Default (${defaultModel.label})` })
    : t({ ko: '기본값', en: 'Default' })

  if (!models || models.length === 0) {
    return (
      <Input
        variant={variant}
        value={draft ?? value}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== null && draft.trim() !== value) onChange(draft.trim())
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        maxLength={200}
        placeholder={defaultLabel}
        disabled={disabled}
        aria-label={ariaLabel}
        className={className}
      />
    )
  }

  // 목록에 없는 기존 값(직접 입력했거나 목록에서 빠진 모델)도 선택된 채로 남긴다.
  const hasCustomValue = value !== '' && !models.some((model) => model.id === value)

  return (
    <Select variant={variant} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} aria-label={ariaLabel} className={className}>
      <option value="">{defaultLabel}</option>
      {models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
      {hasCustomValue ? <option value={value}>{value}</option> : null}
    </Select>
  )
}
