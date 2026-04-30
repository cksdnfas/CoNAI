import { useMemo, useRef, useState } from 'react'
import { AnchoredPopup } from '@/components/ui/anchored-popup'
import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { PromptSimilarImage, SimilarImage } from '@/types/similarity'

interface SimilarityOverlayRow {
  key: string
  label: string
  value: string
  tone?: 'default' | 'success' | 'danger'
}

interface SimilarityScoreOverlayCardProps {
  badgeValue: number
  popupBadgeLabel?: string
  rows: SimilarityOverlayRow[]
}

type Translate = ReturnType<typeof useI18n>['t']

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
  const { t } = useI18n()
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const [isAnchorHovered, setIsAnchorHovered] = useState(false)
  const [isPopupHovered, setIsPopupHovered] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)
  const isOpen = (isAnchorHovered || isPopupHovered) && !isDismissed

  const handleAnchorEnter = () => {
    setIsAnchorHovered(true)
    setIsDismissed(false)
  }


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

        <AnchoredPopup
          open={isOpen}
          anchorRef={anchorRef}
          align="start"
          side="bottom"
          className="w-[min(240px,calc(100vw-1.5rem))] p-3 text-[11px]"
          surfaceProps={{
            onMouseEnter: () => {
              setIsPopupHovered(true)
              setIsDismissed(false)
            },
            onMouseLeave: () => setIsPopupHovered(false),
            onClick: (event) => {
              event.stopPropagation()
              setIsDismissed(true)
            },
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-semibold text-foreground">{t('images.components.detail.similarity.score.overlay.score.details')}</span>
            {popupBadgeLabel ? <Badge variant="outline" className="px-2 py-0.5 tracking-normal normal-case">{popupBadgeLabel}</Badge> : null}
          </div>

          <div className="grid gap-1.5">
            {rows.map((row) => (
              <div key={row.key} className="flex items-start justify-between gap-2 leading-4">
                <span className="text-muted-foreground">{row.label}</span>
                <span className={cn(
                  'text-right text-foreground',
                  row.tone === 'success' && 'text-emerald-400',
                  row.tone === 'danger' && 'text-destructive',
                )}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </AnchoredPopup>
      </div>
    </div>
  )
}

/** Build per-component rows for image-similarity results. */
function buildSimilarImageRows(item: SimilarImage, t: Translate): SimilarityOverlayRow[] {
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
        ? t('images.components.detail.similarity.score.overlay.no.data')
        : 'distance' in score
          ? t(
              { ko: '유사 {similarity} · 거리 {distance}/{threshold} · 비중 {weight}', en: 'Similarity {similarity} · distance {distance}/{threshold} · weight {weight}' },
              { similarity: formatSimilarityValue(score.similarity), distance: score.distance ?? '—', threshold: score.threshold, weight: score.weight },
            )
          : t(
              { ko: '유사 {similarity} · 기준 {threshold} · 비중 {weight}', en: 'Similarity {similarity} · threshold {threshold} · weight {weight}' },
              { similarity: formatSimilarityValue(score.similarity), threshold: score.threshold, weight: score.weight },
            ),
    })
  }

  pushRow('perceptualHash', 'pHash', componentScores?.perceptualHash)
  pushRow('dHash', 'dHash', componentScores?.dHash)
  pushRow('aHash', 'aHash', componentScores?.aHash)
  pushRow('color', t('images.components.detail.similarity.score.overlay.color'), componentScores?.color)

  if (rows.length === 0) {
    rows.push({
      key: 'fallback',
      label: 'pHash',
      value: t(
        { ko: '유사 {similarity} · 거리 {distance}', en: 'Similarity {similarity} · distance {distance}' },
        { similarity: formatSimilarityValue(item.similarity), distance: item.hammingDistance },
      ),
    })
  }

  return rows
}

/** Render the shared score overlay for image-similarity and duplicate cards. */
export function SimilarImageScoreOverlay({ item }: { item: SimilarImage }) {
  const { t } = useI18n()
  const rows = useMemo(() => buildSimilarImageRows(item, t), [item, t])

  return (
    <SimilarityScoreOverlayCard
      badgeValue={item.similarity}
      popupBadgeLabel={item.matchType}
      rows={rows}
    />
  )
}

/** Build per-field rows for prompt-similarity results. */
function buildPromptSimilarImageRows(item: PromptSimilarImage, t: Translate): SimilarityOverlayRow[] {
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
      tone: !score.hasSource || !score.hasTarget
        ? 'default'
        : score.exact
          ? 'success'
          : !score.passed
            ? 'danger'
            : 'default',
      value: !score.hasSource || !score.hasTarget
        ? t('images.components.detail.similarity.score.overlay.one.side.has.no.text')
        : t(
            { ko: '유사 {similarity} · 기준 {threshold}', en: 'Similarity {similarity} · threshold {threshold}' },
            { similarity: formatSimilarityValue(score.similarity), threshold: score.threshold },
          ),
    }))

  if (rows.length === 0) {
    rows.push({
      key: 'fallback',
      label: t('images.components.detail.similarity.score.overlay.text'),
      tone: 'default',
      value: t(
        { ko: '유사 {similarity}', en: 'Similarity {similarity}' },
        { similarity: formatSimilarityValue(item.combinedSimilarity) },
      ),
    })
  }

  return rows
}

/** Render the shared score overlay for prompt-similarity cards. */
export function PromptSimilarImageScoreOverlay({ item }: { item: PromptSimilarImage }) {
  const { t } = useI18n()
  const rows = useMemo(() => buildPromptSimilarImageRows(item, t), [item, t])

  return (
    <SimilarityScoreOverlayCard
      badgeValue={item.combinedSimilarity}
      popupBadgeLabel={t('images.components.detail.similarity.score.overlay.text')}
      rows={rows}
    />
  )
}
