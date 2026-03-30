import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

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
  const nextValue = drafts
    .map((draft) => ({
      prompt: draft.prompt.trim(),
      uc: draft.uc.trim(),
      center_x: draft.centerX.trim(),
      center_y: draft.centerY.trim(),
    }))
    .filter((draft) => draft.prompt.length > 0)

  return nextValue.length > 0 ? nextValue : undefined
}

/** Render a compact reusable editor for NAI character prompt arrays inside module graph forms. */
export function NaiCharacterPromptsInput({ value, onChange }: NaiCharacterPromptsInputProps) {
  const drafts = parseNaiCharacterPromptDrafts(value)

  const updateDrafts = (nextDrafts: NaiCharacterPromptDraft[]) => {
    onChange(buildNaiCharacterPromptValue(nextDrafts))
  }

  const handleAdd = () => {
    updateDrafts([...drafts, createEmptyCharacterDraft()])
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
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-surface-container px-3 py-2.5">
        <div>
          <div className="text-sm font-medium text-foreground">Character Prompt</div>
          <div className="text-xs text-muted-foreground">각 캐릭터의 positive / negative / center 좌표를 따로 넣어줘.</div>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={handleAdd}>
          <Plus className="h-4 w-4" />
          추가
        </Button>
      </div>

      {drafts.length === 0 ? (
        <div className="rounded-sm border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
          아직 캐릭터 프롬프트가 없어.
        </div>
      ) : (
        drafts.map((draft, index) => (
          <div key={`nai-character-input-${index}`} className="space-y-3 rounded-sm border border-border bg-surface-container p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-foreground">Character {index + 1}</div>
              <Button type="button" size="sm" variant="ghost" onClick={() => handleRemove(index)}>
                <Trash2 className="h-4 w-4" />
                제거
              </Button>
            </div>

            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Character Prompt</span>
              <Textarea
                rows={4}
                value={draft.prompt}
                onChange={(event) => handleChange(index, 'prompt', event.target.value)}
                placeholder="girl, ibuki (blue archive), halo"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Character Negative Prompt</span>
              <Textarea
                rows={3}
                value={draft.uc}
                onChange={(event) => handleChange(index, 'uc', event.target.value)}
                placeholder="narrow waist, wide hips"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">Center X</span>
                <Input type="number" min={0} max={1} step={0.01} value={draft.centerX} onChange={(event) => handleChange(index, 'centerX', event.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">Center Y</span>
                <Input type="number" min={0} max={1} step={0.01} value={draft.centerY} onChange={(event) => handleChange(index, 'centerY', event.target.value)} />
              </label>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
