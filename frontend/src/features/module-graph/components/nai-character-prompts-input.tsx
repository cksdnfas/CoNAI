import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { NaiCharacterPositionBoard } from '@/features/image-generation/components/nai-character-position-board'
import { WildcardInlinePickerField } from '@/features/image-generation/components/wildcard-inline-picker-field'
import { useI18n } from '@/i18n'
import {
  NAI_CHARACTER_GRID_X_OPTIONS,
  NAI_CHARACTER_GRID_Y_OPTIONS,
  normalizeNaiCharacterPromptDrafts,
} from '@/features/image-generation/image-generation-shared'
import { EmptyState } from '@/components/ui/empty-state'
import { useSerializedDrafts } from './use-serialized-drafts'

type NaiCharacterPromptDraft = {
  prompt: string
  uc: string
  centerX: string
  centerY: string
}

type NaiCharacterPromptsInputProps = {
  value: unknown
  onChange: (value: unknown) => void
}

function createEmptyCharacterDraft(): NaiCharacterPromptDraft {
  return {
    prompt: '',
    uc: '',
    centerX: '0.5',
    centerY: '0.5',
  }
}

/** Detect the dedicated NAI character prompt port so module UIs can render a form instead of raw JSON. */
export function isNaiCharacterPromptPort(portKey: string, dataType: string) {
  return dataType === 'json' && portKey === 'characters'
}

/** Normalize unknown JSON-ish values into editable NAI character prompt rows. */
function parseNaiCharacterPromptDrafts(value: unknown): NaiCharacterPromptDraft[] {
  if (!value) {
    return []
  }

  let source: unknown = value

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return []
    }

    try {
      source = JSON.parse(trimmed)
    } catch {
      return []
    }
  }

  if (!Array.isArray(source)) {
    return []
  }

  return source.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return createEmptyCharacterDraft()
    }

    const rawEntry = entry as Record<string, unknown>
    return {
      prompt: typeof rawEntry.prompt === 'string' ? rawEntry.prompt : '',
      uc: typeof rawEntry.uc === 'string' ? rawEntry.uc : '',
      centerX:
        typeof rawEntry.center_x === 'number'
          ? String(rawEntry.center_x)
          : typeof rawEntry.center_x === 'string'
            ? rawEntry.center_x
            : typeof rawEntry.centerX === 'number'
              ? String(rawEntry.centerX)
              : typeof rawEntry.centerX === 'string'
                ? rawEntry.centerX
                : '0.5',
      centerY:
        typeof rawEntry.center_y === 'number'
          ? String(rawEntry.center_y)
          : typeof rawEntry.center_y === 'string'
            ? rawEntry.center_y
            : typeof rawEntry.centerY === 'number'
              ? String(rawEntry.centerY)
              : typeof rawEntry.centerY === 'string'
                ? rawEntry.centerY
                : '0.5',
    }
  })
}

/** Convert editable rows back into the runtime JSON shape expected by NAI metadata preprocessing. */
function buildNaiCharacterPromptValue(drafts: NaiCharacterPromptDraft[]) {
  const nextValue = normalizeNaiCharacterPromptDrafts(drafts)
    .map((draft) => ({
      prompt: draft.prompt.trim(),
      uc: draft.uc.trim(),
      center_x: draft.centerX.trim(),
      center_y: draft.centerY.trim(),
    }))

  return nextValue.length > 0 ? nextValue : undefined
}

/** Render a compact reusable editor for NAI character prompt arrays inside module graph forms. */
export function NaiCharacterPromptsInput({ value, onChange }: NaiCharacterPromptsInputProps) {
  const { t } = useI18n()
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [drafts, updateDrafts] = useSerializedDrafts(
    value,
    parseNaiCharacterPromptDrafts,
    (nextDrafts: NaiCharacterPromptDraft[]) => buildNaiCharacterPromptValue(normalizeNaiCharacterPromptDrafts(nextDrafts)),
    onChange,
  )

  const handleAdd = () => {
    const nextDrafts = [...drafts, createEmptyCharacterDraft()]
    updateDrafts(nextDrafts)
    setSelectedIndex(nextDrafts.length - 1)
  }

  const handleChange = (index: number, field: keyof NaiCharacterPromptDraft, fieldValue: string) => {
    updateDrafts(drafts.map((draft, draftIndex) => (
      draftIndex === index
        ? {
            ...draft,
            [field]: fieldValue,
          }
        : draft
    )))
  }

  const handleRemove = (index: number) => {
    updateDrafts(drafts.filter((_, draftIndex) => draftIndex !== index))
    setSelectedIndex((current) => {
      if (current === null) {
        return null
      }
      if (current === index) {
        return null
      }
      return current > index ? current - 1 : current
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm bg-surface-low px-3 py-2.5">
        <div className="text-sm font-medium text-foreground">{t({ ko: 'Character Prompt', en: 'Character Prompt' })}</div>
        <Button type="button" size="sm" variant="secondary" onClick={handleAdd}>
          <Plus className="h-4 w-4" />
          {t({ ko: '추가', en: 'Add' })}
        </Button>
      </div>

      {drafts.length > 0 ? (
        <NaiCharacterPositionBoard
          characters={drafts.map((draft, index) => ({
            label: `Character ${index + 1}`,
            centerX: draft.centerX,
            centerY: draft.centerY,
          }))}
          selectedIndex={selectedIndex}
          onSelectIndex={setSelectedIndex}
          onPositionChange={(index, centerX, centerY) => {
            handleChange(index, 'centerX', centerX)
            handleChange(index, 'centerY', centerY)
          }}
        />
      ) : null}

      {drafts.length === 0 ? (
        <EmptyState size="compact" title={t({ ko: '캐릭터 없음', en: 'No characters' })} />
      ) : (
        drafts.map((draft, index) => (
          <div
            key={`nai-character-input-${index}`}
            className={index === selectedIndex
              ? 'space-y-3 rounded-sm bg-primary/12 p-3'
              : 'space-y-3 rounded-sm bg-surface-low p-3'}
            onClick={() => setSelectedIndex(index)}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-foreground">Character {index + 1}</div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={(event) => {
                  event.stopPropagation()
                  handleRemove(index)
                }}
              >
                <Trash2 className="h-4 w-4" />
                {t({ ko: '제거', en: 'Remove' })}
              </Button>
            </div>

            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Prompt</span>
              <WildcardInlinePickerField
                tool="nai"
                multiline
                rows={4}
                value={draft.prompt}
                onChange={(nextValue) => handleChange(index, 'prompt', nextValue)}
                placeholder=""
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">{t({ ko: '네거티브 프롬프트', en: 'Negative Prompt' })}</span>
              <WildcardInlinePickerField
                tool="nai"
                multiline
                rows={3}
                autocompletePromptType="negative"
                value={draft.uc}
                onChange={(nextValue) => handleChange(index, 'uc', nextValue)}
                placeholder=""
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">X</span>
                <Select value={draft.centerX} onChange={(event) => handleChange(index, 'centerX', event.target.value)}>
                  {NAI_CHARACTER_GRID_X_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">Y</span>
                <Select value={draft.centerY} onChange={(event) => handleChange(index, 'centerY', event.target.value)}>
                  {NAI_CHARACTER_GRID_Y_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
              </label>
            </div>
          </div>
        ))
      )}
    </div>
  )
}



