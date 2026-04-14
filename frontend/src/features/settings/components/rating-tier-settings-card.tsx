import { useState, type DragEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, Trash2 } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { Select } from '@/components/ui/select'
import type { RatingTierRecord } from '@/features/search/search-types'
import { SettingsField } from './settings-primitives'

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

  const handleToggleTier = (tierId: number) => {
    setExpandedTierState((current) => ({
      ...current,
      [tierId]: !(current[tierId] ?? false),
    }))
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <SectionHeading variant="inside" heading={heading} actions={actions} />

        {validationMessages.length > 0 ? (
          <div className="rounded-sm border border-[#ffb4ab]/40 bg-[#93000a]/10 px-3 py-2 text-sm text-[#ffb4ab]">
            <div className="font-medium">저장 전에 확인해줘</div>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
              {validationMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {ratingTiersDraft ? (
          <div className="space-y-3">
            {ratingTiersDraft.map((tier, index) => {
              const isFirst = index === 0
              const isLast = index === ratingTiersDraft.length - 1
              const isExpanded = expandedTierState[tier.id] ?? false
              const colorValue = tier.color ?? FALLBACK_TIER_COLOR

              return (
                <div
                  key={tier.id}
                  onDragOver={handleTierDragOver(tier.id)}
                  onDrop={handleTierDrop(tier.id)}
                  className={dragOverTierId === tier.id && draggedTierId !== tier.id
                    ? 'rounded-sm border border-primary bg-surface-container p-3 ring-1 ring-primary/35'
                    : 'rounded-sm border border-border bg-surface-container p-3'}
                >
                  <div className={isExpanded ? 'flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-3' : 'flex flex-wrap items-center justify-between gap-2'}>
                    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                      <button
                        type="button"
                        draggable
                        onDragStart={handleTierDragStart(tier.id)}
                        onDragEnd={handleTierDragEnd}
                        className="inline-flex cursor-grab items-center justify-center rounded-sm border border-border bg-surface-low p-1 text-muted-foreground hover:bg-surface-high hover:text-foreground"
                        title="드래그해서 순서 바꾸기"
                        aria-label="드래그해서 순서 바꾸기"
                      >
                        <GripVertical className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleTier(tier.id)}
                        className="inline-flex items-center justify-center rounded-sm border border-border bg-surface-low p-1 text-muted-foreground hover:bg-surface-high hover:text-foreground"
                        title={isExpanded ? '접기' : '펼치기'}
                        aria-label={isExpanded ? '접기' : '펼치기'}
                      >
                        <ChevronDown className={isExpanded ? 'h-4 w-4' : 'h-4 w-4 -rotate-90'} />
                      </button>
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorValue }} />
                      <span className="font-mono">#{index + 1}</span>
                      <span className="truncate">{tier.tier_name || `Tier ${index + 1}`}</span>
                      <span className="shrink-0">
                        {tier.min_score}~{isLast ? '∞' : tier.max_score ?? '—'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        onClick={() => onMoveRatingTierUp(tier.id)}
                        disabled={isFirst}
                        title="위로 이동"
                        aria-label="위로 이동"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        onClick={() => onMoveRatingTierDown(tier.id)}
                        disabled={isLast}
                        title="아래로 이동"
                        aria-label="아래로 이동"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        onClick={() => onDeleteRatingTier(tier.id)}
                        disabled={ratingTiersDraft.length <= 1}
                        title="등급 삭제"
                        aria-label="등급 삭제"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {isExpanded ? (
                    <>
                      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1.6fr)_120px_120px_132px_140px]">
                        <SettingsField label="등급 이름">
                          <Input
                            variant="settings"
                            value={tier.tier_name}
                            onChange={(event) => onPatchRatingTier(tier.id, { tier_name: event.target.value })}
                            placeholder={`Tier ${index + 1}`}
                          />
                        </SettingsField>

                        <SettingsField label="최소 점수">
                          <ScrubbableNumberInput
                            min={0}
                            step={0.1}
                            variant="settings"
                            value={tier.min_score}
                            onChange={(value) => onPatchRatingTier(tier.id, { min_score: Number(value) || 0 })}
                          />
                        </SettingsField>

                        <SettingsField label="최대 점수">
                          {isLast ? (
                            <Input variant="settings" value="∞" disabled />
                          ) : (
                            <ScrubbableNumberInput
                              min={0}
                              step={0.1}
                              variant="settings"
                              value={tier.max_score ?? ''}
                              onChange={(value) => onPatchRatingTier(tier.id, {
                                max_score: value === '' ? null : Number(value),
                              })}
                            />
                          )}
                        </SettingsField>

                        <SettingsField label="색상">
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={colorValue}
                              onChange={(event) => onPatchRatingTier(tier.id, { color: event.target.value })}
                              className="h-10 w-12 cursor-pointer rounded-sm border border-border bg-transparent p-1"
                            />
                            <Input
                              variant="settings"
                              value={colorValue}
                              onChange={(event) => onPatchRatingTier(tier.id, { color: event.target.value })}
                              placeholder={FALLBACK_TIER_COLOR}
                            />
                          </div>
                        </SettingsField>

                        <SettingsField label="피드 표시">
                          <Select
                            variant="settings"
                            value={tier.feed_visibility ?? 'show'}
                            onChange={(event) => onPatchRatingTier(tier.id, { feed_visibility: event.target.value as RatingTierRecord['feed_visibility'] })}
                          >
                            <option value="show">표시</option>
                            <option value="blur">블러</option>
                            <option value="hide">숨김</option>
                          </Select>
                        </SettingsField>
                      </div>

                      <div className="mt-3 flex items-center justify-end gap-3 text-xs text-muted-foreground">
                        <span className="font-mono">order={index + 1}</span>
                      </div>
                    </>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-sm border border-dashed border-border bg-surface-container px-4 py-6 text-sm text-muted-foreground">
            평가 등급을 불러오는 중…
          </div>
        )}
      </CardContent>
    </Card>
  )
}
