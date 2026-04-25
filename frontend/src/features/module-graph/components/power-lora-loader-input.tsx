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
  variant?: 'default' | 'compact'
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
function PowerLoraRowToggle({
  pressed,
  onPressedChange,
  compact = false,
}: {
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
  compact?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={pressed}
      aria-label={pressed ? '로라 사용 끄기' : '로라 사용 켜기'}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border transition-colors',
        compact ? 'h-4 w-7' : 'h-6 w-10',
        pressed
          ? compact
            ? 'justify-end border-primary/55 bg-primary/25 px-[2px]'
            : 'border-primary/60 bg-primary/25 justify-end pl-1 pr-[3px]'
          : compact
            ? 'justify-start border-border/70 bg-background/60 px-[2px]'
            : 'border-border/80 bg-background/70 justify-start pr-1 pl-[3px]',
      )}
    >
      <span
        className={cn(
          compact ? 'h-3 w-3 rounded-full transition-colors' : 'h-[18px] w-[18px] rounded-full transition-colors',
          pressed ? 'bg-primary shadow-[0_0_0_1px_rgba(255,255,255,0.08)]' : 'bg-muted-foreground/65',
        )}
      />
    </button>
  )
}

/** Render rgthree Power Lora Loader values as editable LoRA rows instead of raw JSON. */
export function PowerLoraLoaderInput({ field, value, onChange, variant = 'default' }: PowerLoraLoaderInputProps) {
  const nodeValue = isPowerLoraLoaderNodeValue(value) ? value : {}
  const configuredNodeItems = field?.node_items ?? []
  const nodeItems = configuredNodeItems.length > 0
    ? configuredNodeItems.filter((item) => isPowerLoraLoaderEntryValue(nodeValue[item.key]))
    : buildFallbackNodeItems(nodeValue)

  const isCompact = variant === 'compact'

  if (nodeItems.length === 0) {
    return <div className={cn('rounded-sm border border-dashed border-border/80 text-muted-foreground', isCompact ? 'px-2 py-1.5 text-[11px]' : 'px-3 py-4 text-sm')}>노출할 lora_* 항목이 없어.</div>
  }

  return (
    <div className={cn(isCompact ? 'space-y-0.5' : 'space-y-2')}>
      {nodeItems.map((item) => {
        const entry = nodeValue[item.key] as PowerLoraLoaderEntryValue
        return (
          <div
            key={item.key}
            className={cn(
              'grid items-center rounded-sm border transition-colors',
              isCompact
                ? 'grid-cols-[auto_minmax(0,1fr)_48px] gap-2 px-2 py-1'
                : 'grid-cols-[auto_minmax(0,1fr)_88px] gap-3 px-3 py-2.5',
              entry.on === true
                ? isCompact
                  ? 'border-primary/20 bg-surface-container/25'
                  : 'border-primary/30 bg-surface-container/45'
                : isCompact
                  ? 'border-border/45 bg-background/20'
                  : 'border-border/70 bg-background/30',
            )}
          >
            <PowerLoraRowToggle
              pressed={entry.on === true}
              compact={isCompact}
              onPressedChange={(pressed) => onChange({
                ...nodeValue,
                [item.key]: {
                  ...entry,
                  on: pressed,
                },
              })}
            />

            <div className="min-w-0">
              <div className={cn('truncate font-medium text-foreground', isCompact ? 'text-[11px] leading-5' : 'text-sm')}>{item.label}</div>
            </div>

            <ScrubbableNumberInput
              step={0.05}
              value={typeof entry.strength === 'number' ? String(entry.strength) : ''}
              aria-label={`${item.label} 가중치`}
              className={cn('text-left', isCompact ? 'h-6 w-11 px-1.5 text-[11px]' : 'h-8 w-[72px] px-2')}
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
