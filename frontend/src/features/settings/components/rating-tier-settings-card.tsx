import { useState, type DragEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, Trash2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { LoadingState } from '@/components/ui/loading-state'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import type { RatingTierRecord } from '@/features/search/search-types'
import { RowGroup } from '@/components/ui/row-group'
import { SettingRow } from '@/components/ui/setting-row'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { AppearanceColorControl } from './appearance-tab-editor-shared'
import { ChatFilledLabel } from './settings-filled-label'
import { SETTINGS_CONTROL_CLASS } from './settings-rows'

interface RatingTierSettingsCardProps {
  heading: ReactNode
  actions?: ReactNode
  ratingTiersDraft: RatingTierRecord[] | null
  validationMessages: string[]
  onPatchRatingTier: (
    tierId: number,
    patch: Partial<Pick<RatingTierRecord, 'tier_name' | 'min_score' | 'max_score' | 'color' | 'feed_visibility'>>,
  ) => void
  onDeleteRatingTier: (tierId: number) => void
  onMoveRatingTierUp: (tierId: number) => void
  onMoveRatingTierDown: (tierId: number) => void
  onReorderRatingTier: (sourceTierId: number, targetTierId: number) => void
}

const FALLBACK_TIER_COLOR = '#a78bfa'

export function RatingTierSettingsCard({
  heading,
  actions,
  ratingTiersDraft,
  validationMessages,
  onPatchRatingTier,
  onDeleteRatingTier,
  onMoveRatingTierUp,
  onMoveRatingTierDown,
  onReorderRatingTier,
}: RatingTierSettingsCardProps) {
  const { t, formatNumber } = useI18n()
  const [draggedTierId, setDraggedTierId] = useState<number | null>(null)
  const [dragOverTierId, setDragOverTierId] = useState<number | null>(null)
  const [expandedTierState, setExpandedTierState] = useState<Record<number, boolean>>({})

  const handleTierDragStart = (tierId: number) => (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(tierId))
    setDraggedTierId(tierId)
    setDragOverTierId(tierId)
  }

  const handleTierDragOver = (tierId: number) => (event: DragEvent<HTMLDivElement>) => {
    if (draggedTierId == null || draggedTierId === tierId) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragOverTierId(tierId)
  }

  const handleTierDrop = (tierId: number) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (draggedTierId != null && draggedTierId !== tierId) {
      onReorderRatingTier(draggedTierId, tierId)
    }
    setDraggedTierId(null)
    setDragOverTierId(null)
  }

  const handleTierDragEnd = () => {
    setDraggedTierId(null)
    setDragOverTierId(null)
  }

  const labels = {
    name: t({ ko: '등급 이름', en: 'Tier name' }),
    min: t({ ko: '최소 점수', en: 'Minimum score' }),
    max: t({ ko: '최대 점수', en: 'Maximum score' }),
    color: t({ ko: '색상', en: 'Color' }),
    feed: t({ ko: '피드 표시', en: 'Feed visibility' }),
  }

  const handleToggleTier = (tierId: number) => {
    setExpandedTierState((current) => ({
      ...current,
      [tierId]: !(current[tierId] ?? false),
    }))
  }

  return (
    <RowGroup heading={heading} actions={actions}>
      {validationMessages.length > 0 ? (
        <div className="mb-2 rounded-sm bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground">
          <div className="font-medium">{t({ ko: '저장 전에 확인해줘', en: 'Check before saving' })}</div>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
            {validationMessages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {ratingTiersDraft ? (
        <div>
          {ratingTiersDraft.map((tier, index) => {
            const isFirst = index === 0
            const isLast = index === ratingTiersDraft.length - 1
            const isExpanded = expandedTierState[tier.id] ?? false
            const colorValue = tier.color ?? FALLBACK_TIER_COLOR
            const isDropTarget = dragOverTierId === tier.id && draggedTierId !== tier.id
            const tierLabel = tier.tier_name || t({ ko: 'Tier {index}', en: 'Tier {index}' }, { index: index + 1 })

            return (
              <div
                key={tier.id}
                onDragOver={handleTierDragOver(tier.id)}
                onDrop={handleTierDrop(tier.id)}
                className={cn('border-b border-line transition-colors last:border-b-0', isDropTarget && 'bg-primary/8')}
              >
                <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-1.5">
                  <div className="flex min-w-0 items-center gap-2 text-sm">
                    <IconButton
                      variant="ghost"
                      size="icon-xs"
                      draggable
                      onDragStart={handleTierDragStart(tier.id)}
                      onDragEnd={handleTierDragEnd}
                      className="cursor-grab text-muted-foreground"
                      label={t({ ko: '드래그해서 순서 바꾸기', en: 'Drag to reorder' })}
                    >
                      <GripVertical className="h-4 w-4" />
                    </IconButton>
                    <IconButton
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleToggleTier(tier.id)}
                      aria-expanded={isExpanded}
                      label={isExpanded ? t({ ko: '접기', en: 'Collapse' }) : t({ ko: '펼치기', en: 'Expand' })}
                    >
                      <ChevronDown className={isExpanded ? 'h-4 w-4' : 'h-4 w-4 -rotate-90'} />
                    </IconButton>
                    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorValue }} />
                    <span className="truncate font-medium text-foreground">{tierLabel}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatNumber(tier.min_score)}~{isLast ? '∞' : tier.max_score == null ? '—' : formatNumber(tier.max_score)}
                    </span>
                  </div>

                  <div className="flex items-center gap-0.5">
                    <IconButton size="icon-sm" variant="ghost" onClick={() => onMoveRatingTierUp(tier.id)} disabled={isFirst} label={t({ ko: '위로 이동', en: 'Move up' })}>
                      <ArrowUp className="h-4 w-4" />
                    </IconButton>
                    <IconButton size="icon-sm" variant="ghost" onClick={() => onMoveRatingTierDown(tier.id)} disabled={isLast} label={t({ ko: '아래로 이동', en: 'Move down' })}>
                      <ArrowDown className="h-4 w-4" />
                    </IconButton>
                    <IconButton size="icon-sm" variant="ghost" onClick={() => onDeleteRatingTier(tier.id)} disabled={ratingTiersDraft.length <= 1} label={t({ ko: '등급 삭제', en: 'Delete tier' })}>
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="border-t border-line pb-1 pl-4 sm:pl-14">
                    <SettingRow label={<ChatFilledLabel fieldId={`ratingTiers.${tier.id}.tier_name`}>{labels.name}</ChatFilledLabel>} controlClassName={SETTINGS_CONTROL_CLASS}>
                      <Input
                        variant="settings"
                        aria-label={labels.name}
                        value={tier.tier_name}
                        onChange={(event) => onPatchRatingTier(tier.id, { tier_name: event.target.value })}
                        placeholder={t({ ko: 'Tier {index}', en: 'Tier {index}' }, { index: index + 1 })}
                      />
                    </SettingRow>

                    <SettingRow label={<ChatFilledLabel fieldId={`ratingTiers.${tier.id}.min_score`}>{labels.min}</ChatFilledLabel>} controlClassName={SETTINGS_CONTROL_CLASS}>
                      <NumberStepperInput
                        min={0}
                        step={0.1}
                        variant="settings"
                        aria-label={labels.min}
                        value={tier.min_score}
                        onValueCommit={(value) => onPatchRatingTier(tier.id, { min_score: Number(value) || 0 })}
                      />
                    </SettingRow>

                    <SettingRow label={labels.max} controlClassName={SETTINGS_CONTROL_CLASS}>
                      {isLast ? (
                        <Input variant="settings" aria-label={labels.max} value="∞" disabled />
                      ) : (
                        <NumberStepperInput
                          min={0}
                          step={0.1}
                          variant="settings"
                          aria-label={labels.max}
                          value={tier.max_score ?? ''}
                          onValueCommit={(value) => onPatchRatingTier(tier.id, {
                            max_score: value === '' ? null : Number(value),
                          })}
                        />
                      )}
                    </SettingRow>

                    <SettingRow label={<ChatFilledLabel fieldId={`ratingTiers.${tier.id}.color`}>{labels.color}</ChatFilledLabel>}>
                      <AppearanceColorControl
                        ariaLabel={labels.color}
                        colorValue={colorValue}
                        textValue={colorValue}
                        placeholder={FALLBACK_TIER_COLOR}
                        onChangeColor={(value) => onPatchRatingTier(tier.id, { color: value })}
                        onChangeText={(value) => onPatchRatingTier(tier.id, { color: value })}
                      />
                    </SettingRow>

                    <SettingRow label={<ChatFilledLabel fieldId={`ratingTiers.${tier.id}.feed_visibility`}>{labels.feed}</ChatFilledLabel>} controlClassName={SETTINGS_CONTROL_CLASS}>
                      <Select
                        variant="settings"
                        aria-label={labels.feed}
                        value={tier.feed_visibility ?? 'show'}
                        onChange={(event) => onPatchRatingTier(tier.id, { feed_visibility: event.target.value as RatingTierRecord['feed_visibility'] })}
                      >
                        <option value="show">{t({ ko: '표시', en: 'Show' })}</option>
                        <option value="blur">{t({ ko: '블러', en: 'Blur' })}</option>
                        <option value="hide">{t({ ko: '숨김', en: 'Hide' })}</option>
                      </Select>
                    </SettingRow>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : (
        <LoadingState label={t({ ko: '평가 등급을 불러오는 중…', en: 'Loading rating tiers…' })} />
      )}
    </RowGroup>
  )
}
