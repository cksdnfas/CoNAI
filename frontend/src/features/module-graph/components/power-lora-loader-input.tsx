import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { cn } from '@/lib/utils'
import type { ModuleUiFieldDefinition } from '@/lib/api'

type PowerLoraLoaderEntryValue = {
  on?: boolean
  lora?: string
  strength?: number
}

type PowerLoraLoaderNodeItem = {
  key: string
  label: string
  lora?: string
}

type PowerLoraLoaderInputProps = {
  field?: Pick<ModuleUiFieldDefinition, 'node_items'> | null
  value: unknown
  onChange: (value: Record<string, unknown>) => void
}

function isPowerLoraLoaderEntryValue(value: unknown): value is PowerLoraLoaderEntryValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>
  return typeof record.lora === 'string'
    && typeof record.on === 'boolean'
    && typeof record.strength === 'number'
}

function isPowerLoraLoaderNodeValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hasPowerLoraLoaderEntries(value: unknown) {
  return isPowerLoraLoaderNodeValue(value) && Object.values(value).some(isPowerLoraLoaderEntryValue)
}

function buildFallbackNodeItems(nodeValue: Record<string, unknown>): PowerLoraLoaderNodeItem[] {
  return Object.entries(nodeValue)
    .filter((entry): entry is [string, PowerLoraLoaderEntryValue] => isPowerLoraLoaderEntryValue(entry[1]))
    .map(([key, entry]) => ({
      key,
      label: entry.lora || key,
      lora: entry.lora,
    }))
}

/** Render one compact switch-style toggle for a Power Lora Loader row. */
function PowerLoraRowToggle({ pressed, onPressedChange }: { pressed: boolean; onPressedChange: (pressed: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={pressed}
      aria-label={pressed ? '로라 사용 끄기' : '로라 사용 켜기'}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors',
        pressed
          ? 'border-primary/60 bg-primary/25 justify-end pl-1 pr-[3px]'
          : 'border-border/80 bg-background/70 justify-start pr-1 pl-[3px]',
      )}
    >
      <span
        className={cn(
          'h-[18px] w-[18px] rounded-full transition-colors',
          pressed ? 'bg-primary shadow-[0_0_0_1px_rgba(255,255,255,0.08)]' : 'bg-muted-foreground/65',
        )}
      />
    </button>
  )
}

/** Render rgthree Power Lora Loader values as editable LoRA rows instead of raw JSON. */
export function PowerLoraLoaderInput({ field, value, onChange }: PowerLoraLoaderInputProps) {
  const nodeValue = isPowerLoraLoaderNodeValue(value) ? value : {}
  const configuredNodeItems = field?.node_items ?? []
  const nodeItems = configuredNodeItems.length > 0
    ? configuredNodeItems.filter((item) => isPowerLoraLoaderEntryValue(nodeValue[item.key]))
    : buildFallbackNodeItems(nodeValue)

  if (nodeItems.length === 0) {
    return <div className="rounded-sm border border-dashed border-border/80 px-3 py-4 text-sm text-muted-foreground">노출할 lora_* 항목이 없어.</div>
  }

  return (
    <div className="space-y-2">
      {nodeItems.map((item) => {
        const entry = nodeValue[item.key] as PowerLoraLoaderEntryValue
        return (
          <div
            key={item.key}
            className={cn(
              'grid grid-cols-[auto_minmax(0,1fr)_88px] items-center gap-3 rounded-sm border px-3 py-2.5 transition-colors',
              entry.on === true
                ? 'border-primary/30 bg-surface-container/45'
                : 'border-border/70 bg-background/30',
            )}
          >
            <PowerLoraRowToggle
              pressed={entry.on === true}
              onPressedChange={(pressed) => onChange({
                ...nodeValue,
                [item.key]: {
                  ...entry,
                  on: pressed,
                },
              })}
            />

            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{item.label}</div>
            </div>

            <ScrubbableNumberInput
              step={0.05}
              value={typeof entry.strength === 'number' ? String(entry.strength) : ''}
              aria-label={`${item.label} 가중치`}
              className="h-8 w-[72px] px-2 text-left"
              onChange={(nextValue) => {
                const parsedStrength = Number(nextValue)
                onChange({
                  ...nodeValue,
                  [item.key]: {
                    ...entry,
                    strength: Number.isFinite(parsedStrength) ? parsedStrength : (entry.strength ?? 1),
                  },
                })
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

export function isPowerLoraLoaderUiField(field?: ModuleUiFieldDefinition | null): field is ModuleUiFieldDefinition & { node_editor: 'power_lora_loader_rgthree' } {
  return field?.node_editor === 'power_lora_loader_rgthree'
}
