import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { DEFAULT_COMFY_MODEL_API_PATHS, getGenerationCustomDropdownLists, scanGenerationComfyUIModelDropdownLists } from '@/lib/api-image-generation-workflows'
import { cn } from '@/lib/utils'
import { PathOptionTreeSelect } from './path-option-tree-select'
import {
  buildAddedPowerLoraNodeValue,
  buildRemovedPowerLoraNodeValue,
  buildFallbackPowerLoraNodeItems,
  buildPowerLoraNodeItemsFromInputs,
  findAutoCollectedPowerLoraOptions,
  hasPowerLoraLoaderEntries,
  isPowerLoraLoaderEntryValue,
  isPowerLoraLoaderNodeValue,
  type PowerLoraLoaderEntryValue,
  type PowerLoraLoaderNodeItem,
} from './power-lora-loader-utils'

export {
  buildAddedPowerLoraNodeValue,
  buildRemovedPowerLoraNodeValue,
  buildFallbackPowerLoraNodeItems,
  buildPowerLoraNodeItemsFromInputs,
  findAutoCollectedPowerLoraOptions,
  hasPowerLoraLoaderEntries,
  isPowerLoraLoaderEntryValue,
  isPowerLoraLoaderNodeValue,
}
export type { PowerLoraLoaderEntryValue, PowerLoraLoaderNodeItem }

type PowerLoraLoaderField = {
  node_editor?: unknown
  node_items?: PowerLoraLoaderNodeItem[] | null
}

type PowerLoraLoaderInputProps = {
  field?: PowerLoraLoaderField | null
  value: unknown
  onChange: (value: Record<string, unknown>) => void
  variant?: 'default' | 'compact'
  useValueFallback?: boolean
  loraOptions?: string[]
  isRefreshingLoraOptions?: boolean
  onRefreshLoraOptions?: () => Promise<void> | void
}

function buildVisiblePowerLoraNodeItems(field: PowerLoraLoaderField | null | undefined, nodeValue: Record<string, unknown>, useValueFallback: boolean) {
  const configuredNodeItems = field?.node_items ?? []
  const fallbackNodeItems = buildFallbackPowerLoraNodeItems(nodeValue)

  if (configuredNodeItems.length === 0) {
    return useValueFallback || fallbackNodeItems.length > 0 ? fallbackNodeItems : []
  }

  const configuredItems = configuredNodeItems.filter((item) => isPowerLoraLoaderEntryValue(nodeValue[item.key]))
  const configuredKeys = new Set(configuredItems.map((item) => item.key))
  const addedItems = fallbackNodeItems.filter((item) => !configuredKeys.has(item.key))
  return [...configuredItems, ...addedItems]
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
  const { t } = useI18n()

  return (
    <button
      type="button"
      role="switch"
      aria-checked={pressed}
      aria-label={pressed ? t('image-generation.components.power.lora.loader.input.disable.lora') : t('image-generation.components.power.lora.loader.input.enable.lora')}
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
export function PowerLoraLoaderInput({
  field,
  value,
  onChange,
  variant = 'default',
  useValueFallback = true,
  loraOptions,
  isRefreshingLoraOptions = false,
  onRefreshLoraOptions,
}: PowerLoraLoaderInputProps) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const nodeValue = isPowerLoraLoaderNodeValue(value) ? value : {}
  const nodeItems = buildVisiblePowerLoraNodeItems(field, nodeValue, useValueFallback)
  const isCompact = variant === 'compact'
  const [isRefreshingFallbackLoraOptions, setIsRefreshingFallbackLoraOptions] = useState(false)
  const shouldUseFallbackLoraOptions = loraOptions === undefined
  const fallbackDropdownListsQuery = useQuery({
    queryKey: ['image-generation-custom-dropdown-lists'],
    queryFn: () => getGenerationCustomDropdownLists(),
    enabled: shouldUseFallbackLoraOptions,
  })
  const resolvedLoraOptions = useMemo(
    () => loraOptions ?? findAutoCollectedPowerLoraOptions(fallbackDropdownListsQuery.data ?? []),
    [fallbackDropdownListsQuery.data, loraOptions],
  )
  const isRefreshingResolvedLoraOptions = isRefreshingLoraOptions || isRefreshingFallbackLoraOptions

  const handleRefreshLoraOptions = async () => {
    if (isRefreshingResolvedLoraOptions) {
      return
    }

    if (onRefreshLoraOptions) {
      await onRefreshLoraOptions()
      return
    }

    try {
      setIsRefreshingFallbackLoraOptions(true)
      const response = await scanGenerationComfyUIModelDropdownLists({ apiPaths: DEFAULT_COMFY_MODEL_API_PATHS })
      await queryClient.invalidateQueries({ queryKey: ['image-generation-custom-dropdown-lists'] })
      await fallbackDropdownListsQuery.refetch()
      showSnackbar({ message: response.data.message || t({ ko: '자동수집 목록을 갱신했어.', en: 'Refreshed the auto-collect list.' }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '자동수집 목록 생성에 실패했어.', en: 'Failed to create the auto-collect list.' }), tone: 'error' })
    } finally {
      setIsRefreshingFallbackLoraOptions(false)
    }
  }

  const handleAddLora = (loraPath: string) => {
    if (loraPath) {
      onChange(buildAddedPowerLoraNodeValue(nodeValue, loraPath))
    }
  }

  const handleRemoveLora = (itemKey: string) => {
    onChange(buildRemovedPowerLoraNodeValue(nodeValue, itemKey))
  }

  const addLoraControl = (
    <PathOptionTreeSelect
      value=""
      options={resolvedLoraOptions}
      modelPreviewFolder="loras"
      placeholder={fallbackDropdownListsQuery.isLoading ? t({ ko: 'LoRA 목록 불러오는 중', en: 'Loading LoRA list' }) : t({ ko: 'LoRA 추가', en: 'Add LoRA' })}
      refreshLabel={t({ ko: 'LoRA 자동수집 새로고침', en: 'Refresh LoRA auto collect' })}
      isRefreshing={isRefreshingResolvedLoraOptions}
      onRefresh={handleRefreshLoraOptions}
      onChange={handleAddLora}
    />
  )

  if (nodeItems.length === 0) {
    return (
      <div className={cn(isCompact ? 'space-y-1' : 'space-y-2')}>
        <div className={cn('rounded-sm border border-dashed border-border/80 text-muted-foreground', isCompact ? 'px-2 py-1.5 text-[11px]' : 'px-3 py-4 text-sm')}>{t('image-generation.components.power.lora.loader.input.no.lora.fields.to.expose')}</div>
        {addLoraControl}
      </div>
    )
  }

  return (
    <div className={cn(isCompact ? 'space-y-0.5' : 'space-y-2')}>
      {addLoraControl}
      {nodeItems.map((item) => {
        const entry = nodeValue[item.key] as PowerLoraLoaderEntryValue
        return (
          <div
            key={item.key}
            className={cn(
              'grid items-center rounded-sm border transition-colors',
              isCompact
                ? 'grid-cols-[auto_minmax(0,1fr)_48px_auto] gap-2 px-2 py-1'
                : 'grid-cols-[auto_minmax(0,1fr)_88px_auto] gap-3 px-3 py-2.5',
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
              aria-label={t('image-generation.components.power.lora.loader.input.value.weight', { label: item.label })}
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

            <button
              type="button"
              aria-label={t('image-generation.components.power.lora.loader.input.delete.lora', { label: item.label })}
              title={t('image-generation.components.power.lora.loader.input.delete.lora', { label: item.label })}
              onClick={() => handleRemoveLora(item.key)}
              className={cn(
                'inline-flex shrink-0 items-center justify-center rounded-sm border border-transparent text-muted-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive',
                isCompact ? 'h-6 w-6' : 'h-8 w-8',
              )}
            >
              <Trash2 className={cn(isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function isPowerLoraLoaderUiField<T extends { node_editor?: unknown }>(field?: T | null): field is T & { node_editor: 'power_lora_loader_rgthree' } {
  return field?.node_editor === 'power_lora_loader_rgthree'
}
