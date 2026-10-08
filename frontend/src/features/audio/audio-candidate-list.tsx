import { useEffect, useRef } from 'react'
import { Check, CirclePause, Download, LoaderCircle, Pause, Play, RotateCcw, TriangleAlert, X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import type { AudioCandidate, AudioOrder, AudioReview } from '@/lib/api-audio'
import { cn } from '@/lib/utils'
import { useAudioPlayer } from './audio-player'
import { shortcutLabel, useAudioShortcuts } from './audio-shortcuts'
import { WaveformThumb } from './audio-waveform'

export interface AudioListRow {
  candidate: AudioCandidate
  depth: number
}

/** Edits follow their source take (indented); a take whose source is not on this page stays at the top level. */
export function arrangeCandidates(items: AudioCandidate[]): AudioListRow[] {
  const ids = new Set(items.map((item) => item.id))
  const children = new Map<string, AudioCandidate[]>()
  const roots: AudioCandidate[] = []
  for (const item of items) {
    if (item.parent_id && ids.has(item.parent_id)) {
      const list = children.get(item.parent_id) ?? []
      list.push(item)
      children.set(item.parent_id, list)
    } else {
      roots.push(item)
    }
  }
  const rows: AudioListRow[] = []
  const visit = (item: AudioCandidate, depth: number) => {
    rows.push({ candidate: item, depth })
    for (const child of [...(children.get(item.id) ?? [])].reverse()) visit(child, depth + 1)
  }
  roots.forEach((root) => visit(root, 0))
  return rows
}

const ACTIVE_JOB = new Set(['pending', 'queued', 'dispatching', 'running'])

export function activeJobCount(order: AudioOrder) {
  return order.jobs.filter((job) => ACTIVE_JOB.has(job.status)).length
}

export function formatSeconds(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${value.toFixed(2)}s`
}

function signed(value: number, digits = 1) {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(digits)}`
}

/** Second line of a row: seed and time for generated takes, the edit for edits, "업로드" for uploads. */
function useRowDetail() {
  const { t, formatDateTime } = useI18n()
  return (candidate: AudioCandidate) => {
    const when = formatDateTime(candidate.created_at, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    const edit = candidate.edit
    if (candidate.origin === 'edited' && edit) {
      const parts = [`${(edit.start ?? 0).toFixed(2)}–${edit.end !== undefined ? edit.end.toFixed(2) : '…'}s`]
      if (edit.gain_db) parts.push(`${signed(edit.gain_db)}dB`)
      if (edit.pitch_semitones) parts.push(`${t({ ko: '피치', en: 'pitch' })} ${signed(edit.pitch_semitones)}`)
      if (edit.speed && edit.speed !== 1) parts.push(`${edit.speed.toFixed(2)}×`)
      return parts.join(' · ')
    }
    const seed = candidate.provenance?.seed
    if (typeof seed === 'number') return `seed ${seed} · ${when}`
    if (candidate.origin === 'uploaded' || candidate.origin === 'imported') return `${t({ ko: '업로드', en: 'Upload' })} · ${when}`
    return when
  }
}

export function ReviewPill({ review }: { review: AudioReview }) {
  const { t } = useI18n()
  if (review === 'selected') return <span className="inline-flex items-center gap-1 text-xs font-semibold text-success"><Check className="size-3.5" />{t({ ko: '채택', en: 'Adopted' })}</span>
  if (review === 'rejected') return <span className="text-xs text-muted-foreground line-through decoration-muted-foreground/40">{t({ ko: '보류', en: 'Rejected' })}</span>
  return <span className="text-xs text-muted-foreground">{t({ ko: '미검수', en: 'Unreviewed' })}</span>
}

const ROW_GRID = 'grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 sm:grid-cols-[2rem_10rem_minmax(0,1fr)_3.5rem_4.5rem_auto]'

export function AudioCandidateRow({ row, selected, canEdit, onSelect, onPlay, onReview, onDownload }: {
  row: AudioListRow
  selected: boolean
  canEdit: boolean
  onSelect: () => void
  onPlay: () => void
  onReview: (review: AudioReview) => void
  onDownload: () => void
}) {
  const { t } = useI18n()
  const shortcuts = useAudioShortcuts()
  const player = useAudioPlayer()
  const detail = useRowDetail()
  const { candidate, depth } = row
  const ref = useRef<HTMLDivElement>(null)
  const playing = player.key === candidate.id && player.playing
  const progress = player.key === candidate.id && player.duration > 0 ? player.currentTime / player.duration : undefined
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      data-candidate-id={candidate.id}
      onClick={onSelect}
      className={cn(
        ROW_GRID,
        'group min-h-14 cursor-pointer border-b border-line py-2 pr-1 transition-colors hover:bg-fill/60',
        selected && 'bg-fill shadow-[inset_2px_0_0_var(--primary)] hover:bg-fill',
      )}
      style={depth > 0 ? { paddingLeft: `${depth * 1.5}rem` } : undefined}
    >
      <IconButton
        variant={playing ? 'secondary' : 'ghost'}
        size="icon-sm"
        className="rounded-full"
        label={`${playing ? t({ ko: '정지', en: 'Pause' }) : t({ ko: '재생', en: 'Play' })} (${shortcutLabel(shortcuts.play)})`}
        onClick={(event) => { event.stopPropagation(); onPlay() }}
      >
        {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
      </IconButton>
      <WaveformThumb candidateId={candidate.id} fileHash={candidate.file_hash} progress={progress} className="hidden sm:block" />
      <div className="min-w-0">
        <p className={cn('truncate text-sm', depth > 0 && 'text-muted-foreground', selected && 'font-semibold text-foreground')}>{candidate.name}</p>
        <p className="truncate font-mono text-2xs text-muted-foreground">{detail(candidate)}<span className="sm:hidden"> · {formatSeconds(candidate.file.duration)}</span></p>
      </div>
      <span className="hidden text-right font-mono text-xs text-muted-foreground tabular-nums sm:block">{formatSeconds(candidate.file.duration)}</span>
      <span className="hidden sm:block"><ReviewPill review={candidate.review} /></span>
      <div className={cn('flex items-center gap-0.5 transition-opacity sm:opacity-35 sm:group-hover:opacity-100', selected && 'sm:opacity-100')}>
        <span className="sm:hidden"><ReviewPill review={candidate.review} /></span>
        {canEdit ? (
          <>
            <IconButton
              variant="ghost"
              size="icon-sm"
              className={cn('hidden sm:inline-flex', candidate.review === 'selected' && 'text-success')}
              label={`${t({ ko: '채택', en: 'Adopt' })} (${shortcutLabel(shortcuts.select)})`}
              onClick={(event) => { event.stopPropagation(); onReview(candidate.review === 'selected' ? 'pending' : 'selected') }}
            ><Check /></IconButton>
            <IconButton
              variant="ghost"
              size="icon-sm"
              className={cn('hidden sm:inline-flex', candidate.review === 'rejected' && 'text-foreground')}
              label={`${t({ ko: '보류', en: 'Reject' })} (${shortcutLabel(shortcuts.reject)})`}
              onClick={(event) => { event.stopPropagation(); onReview(candidate.review === 'rejected' ? 'pending' : 'rejected') }}
            ><CirclePause /></IconButton>
          </>
        ) : null}
        <IconButton variant="ghost" size="icon-sm" className="hidden sm:inline-flex" label={t({ ko: '내보내기', en: 'Export' })} onClick={(event) => { event.stopPropagation(); onDownload() }}><Download /></IconButton>
      </div>
    </div>
  )
}

/** "생성 중 N개" (or the failed jobs of a recent order) above the takes. */
export function AudioOrderRow({ order, canEdit, onCancel, onRetry, onDismiss }: {
  order: AudioOrder
  canEdit: boolean
  onCancel: () => void
  onRetry: () => void
  onDismiss: () => void
}) {
  const { t, formatDateTime } = useI18n()
  const active = activeJobCount(order)
  const failed = order.jobs.filter((job) => job.status === 'failed')
  const waiting = order.jobs.filter((job) => job.status === 'pending' || job.status === 'queued').length
  const running = order.jobs.filter((job) => job.status === 'running' || job.status === 'dispatching').length
  const seeds = order.count > 1 ? `seed ${order.base_seed}~${order.base_seed + order.count - 1}` : `seed ${order.base_seed}`
  const meta = `${t({ ko: '주문', en: 'Order' })} #${order.id.slice(0, 4)} · ${order.seconds.toFixed(1)}${t({ ko: '초', en: 's' })} · ${seeds}`
  return (
    <div className={cn(ROW_GRID, 'min-h-14 border-b border-line py-2 pr-1')}>
      <span className="flex size-8 items-center justify-center text-muted-foreground">
        {active > 0 ? <LoaderCircle className="size-4 animate-spin" /> : <TriangleAlert className="size-4 text-destructive" />}
      </span>
      <WaveformThumb candidateId="" fileHash="" ghost className="hidden sm:block" />
      <div className="min-w-0">
        <p className="truncate text-sm">
          {active > 0 ? t({ ko: '생성 중 {count}개', en: 'Generating {count}' }, { count: active }) : t({ ko: '실패 {count}개', en: '{count} failed' }, { count: failed.length })}
        </p>
        <p className="truncate font-mono text-2xs text-muted-foreground" title={failed[0]?.failure_message ?? undefined}>
          {active === 0 && failed[0]?.failure_message ? failed[0].failure_message : `${meta} · ${formatDateTime(order.created_at, { hour: '2-digit', minute: '2-digit' })}`}
        </p>
      </div>
      <span className="hidden sm:block" />
      <span className="hidden text-xs text-muted-foreground sm:block">
        {active > 0 ? [waiting ? t({ ko: '대기 {count}', en: '{count} queued' }, { count: waiting }) : null, running ? t({ ko: '실행 {count}', en: '{count} running' }, { count: running }) : null].filter(Boolean).join(' · ') : null}
      </span>
      <div className="flex items-center gap-0.5">
        {canEdit && active === 0 && failed.length > 0 ? <IconButton variant="ghost" size="icon-sm" label={t({ ko: '실패한 것 다시 생성', en: 'Retry failed' })} onClick={onRetry}><RotateCcw /></IconButton> : null}
        {canEdit && active > 0
          ? <IconButton variant="ghost" size="icon-sm" label={t({ ko: '주문 취소', en: 'Cancel order' })} onClick={onCancel}><X /></IconButton>
          : <IconButton variant="ghost" size="icon-sm" label={t({ ko: '숨기기', en: 'Dismiss' })} onClick={onDismiss}><X /></IconButton>}
      </div>
    </div>
  )
}
