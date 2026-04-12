import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { PromptSimilarImage, SimilarImage } from '@/types/similarity'

interface SimilarityOverlayRow {
  key: string
  label: string
  value: string
  tone?: 'default' | 'danger'
}

interface SimilarityScoreOverlayCardProps {
  badgeValue: number
  popupBadgeLabel?: string
  rows: SimilarityOverlayRow[]
}

const SIMILARITY_COMPONENT_LABELS = {
  perceptualHash: 'pHash',
  dHash: 'dHash',
  aHash: 'aHash',
  color: '색상',
} as const

/** Format one score into the compact badge string already used by image similarity UI. */
function formatSimilarityValue(value?: number) {
  return typeof value === 'number' ? value.toFixed(1) : '—'
}

/** Map score bands onto the shared similarity badge palette. */
function getSimilarityBadgeClassName(similarity: number) {
  if (similarity >= 92) return 'border border-emerald-300/45 bg-emerald-500/88 text-white'
  if (similarity >= 82) return 'border border-sky-300/45 bg-sky-500/88 text-white'
  if (similarity >= 68) return 'border border-violet-300/45 bg-violet-500/88 text-white'
  if (similarity >= 52) return 'border border-amber-200/50 bg-amber-500/88 text-black'
  return 'border border-rose-300/45 bg-rose-500/88 text-white'
}

/** Render the shared similarity score badge + popup shell used across image/text similarity cards. */
function SimilarityScoreOverlayCard({ badgeValue, popupBadgeLabel, rows }: SimilarityScoreOverlayCardProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const [isAnchorHovered, setIsAnchorHovered] = useState(false)
  const [isPopupHovered, setIsPopupHovered] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)
  const [popupPosition, setPopupPosition] = useState<{ top: number; left: number; placement: 'top' | 'bottom'; width: number } | null>(null)
  const isOpen = (isAnchorHovered || isPopupHovered) && !isDismissed

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') {
      return
    }

    const updatePosition = () => {
      const anchor = anchorRef.current
      if (!anchor) {
        return
      }

      const rect = anchor.getBoundingClientRect()
      const viewportPadding = 12
      const popupGap = 8
      const popupWidth = Math.min(240, window.innerWidth - viewportPadding * 2)
      const estimatedPopupHeight = rows.length > 0 ? 180 : 116
      const shouldOpenAbove = rect.bottom + popupGap + estimatedPopupHeight > window.innerHeight - viewportPadding && rect.top > estimatedPopupHeight + popupGap

      let left = rect.left
      if (left + popupWidth > window.innerWidth - viewportPadding) {
        left = rect.right - popupWidth
      }
      left = Math.max(viewportPadding, left)

      setPopupPosition({
        top: shouldOpenAbove ? rect.top - popupGap : rect.bottom + popupGap,
        left,
        placement: shouldOpenAbove ? 'top' : 'bottom',
        width: popupWidth,
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [isOpen, rows.length])

  const handleAnchorEnter = () => {
    setIsAnchorHovered(true)
    setIsDismissed(false)
  }

  const popup = isOpen && popupPosition && typeof document !== 'undefined'
    ? createPortal(
      <div
        className="z-[120] rounded-sm border border-border bg-background/96 p-3 text-[11px] shadow-[0_12px_32px_rgba(0,0,0,0.34)] backdrop-blur-sm"
        style={{
          position: 'fixed',
          top: popupPosition.top,
          left: popupPosition.left,
          width: popupPosition.width,
          transform: popupPosition.placement === 'top' ? 'translateY(-100%)' : undefined,
        }}
        onMouseEnter={() => {
          setIsPopupHovered(true)
          setIsDismissed(false)
        }}
        onMouseLeave={() => setIsPopupHovered(false)}
        onClick={(event) => {
          event.stopPropagation()
          setIsDismissed(true)
        }}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="font-semibold text-foreground">세부 점수</span>
          {popupBadgeLabel ? <Badge variant="outline" className="px-2 py-0.5 tracking-normal normal-case">{popupBadgeLabel}</Badge> : null}
        </div>

        <div className="grid gap-1.5">
          {rows.map((row) => (
            <div key={row.key} className="flex items-start justify-between gap-2 leading-4">
              <span className="text-muted-foreground">{row.label}</span>
              <span className={cn('text-right text-foreground', row.tone === 'danger' && 'text-destructive')}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </div>,
      document.body,
    )
    : null

  return (
    <div className="flex justify-start">
      <div
        ref={anchorRef}
        className="relative max-w-full"
        onMouseEnter={handleAnchorEnter}
        onMouseLeave={() => setIsAnchorHovered(false)}
        onClick={(event) => event.stopPropagation()}
      >
        <Badge
          variant="secondary"
          className={cn(
            'max-w-full shadow-sm backdrop-blur-sm tracking-normal normal-case',
            getSimilarityBadgeClassName(badgeValue),
          )}
          onMouseEnter={handleAnchorEnter}
          onMouseMove={() => {
            if (isDismissed) {
              setIsDismissed(false)
            }
          }}
          onClick={(event) => event.stopPropagation()}
        >
          {formatSimilarityValue(badgeValue)}
        </Badge>

        {popup}
      </div>
    </div>
  )
}

/** Build per-component rows for image-similarity results. */
function buildSimilarImageRows(item: SimilarImage): SimilarityOverlayRow[] {
  const rows: SimilarityOverlayRow[] = []
  const componentScores = item.componentScores

  const pushRow = (
    key: string,
    label: string,
    score?: NonNullable<SimilarImage['componentScores']>[keyof NonNullable<SimilarImage['componentScores']>],
  ) => {
    if (!score || (!score.available && !score.used)) {
      return
    }

    rows.push({
      key,
      label,
      tone: score.used && !score.passed ? 'danger' : 'default',
      value: !score.available
        ? '데이터 없음'
        : 'distance' in score
          ? `유사 ${formatSimilarityValue(score.similarity)} · 거리 ${score.distance ?? '—'}/${score.threshold} · 비중 ${score.weight}`
          : `유사 ${formatSimilarityValue(score.similarity)} · 기준 ${score.threshold} · 비중 ${score.weight}`,
    })
  }

  pushRow('perceptualHash', SIMILARITY_COMPONENT_LABELS.perceptualHash, componentScores?.perceptualHash)
  pushRow('dHash', SIMILARITY_COMPONENT_LABELS.dHash, componentScores?.dHash)
  pushRow('aHash', SIMILARITY_COMPONENT_LABELS.aHash, componentScores?.aHash)
  pushRow('color', SIMILARITY_COMPONENT_LABELS.color, componentScores?.color)

  if (rows.length === 0) {
    rows.push({
      key: 'fallback',
      label: 'pHash',
      value: `유사 ${formatSimilarityValue(item.similarity)} · 거리 ${item.hammingDistance}`,
    })
  }

  return rows
}

/** Render the shared score overlay for image-similarity and duplicate cards. */
export function SimilarImageScoreOverlay({ item }: { item: SimilarImage }) {
  const rows = useMemo(() => buildSimilarImageRows(item), [item])

  return (
    <SimilarityScoreOverlayCard
      badgeValue={item.similarity}
      popupBadgeLabel={item.matchType}
      rows={rows}
    />
  )
}

/** Build per-field rows for prompt-similarity results. */
function buildPromptSimilarImageRows(item: PromptSimilarImage): SimilarityOverlayRow[] {
  const fields = [
    { key: 'positive', label: 'Positive', score: item.positive },
    { key: 'negative', label: 'Negative', score: item.negative },
    { key: 'auto', label: 'Auto', score: item.auto },
  ]

  const rows: SimilarityOverlayRow[] = fields
    .filter(({ score }) => score.hasSource || score.hasTarget)
    .map(({ key, label, score }) => ({
      key,
      label,
      tone: score.hasSource && score.hasTarget && !score.passed ? 'danger' : 'default',
      value: !score.hasSource || !score.hasTarget
        ? '한쪽 텍스트 없음'
        : `유사 ${formatSimilarityValue(score.similarity)} · 기준 ${score.threshold}${score.exact ? ' · 정확히 일치' : ''}`,
    }))

  if (rows.length === 0) {
    rows.push({
      key: 'fallback',
      label: '텍스트',
      tone: 'default',
      value: `유사 ${formatSimilarityValue(item.combinedSimilarity)}`,
    })
  }

  return rows
}

/** Render the shared score overlay for prompt-similarity cards. */
export function PromptSimilarImageScoreOverlay({ item }: { item: PromptSimilarImage }) {
  const rows = useMemo(() => buildPromptSimilarImageRows(item), [item])

  return (
    <SimilarityScoreOverlayCard
      badgeValue={item.combinedSimilarity}
      popupBadgeLabel="텍스트"
      rows={rows}
    />
  )
}
