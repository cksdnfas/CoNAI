import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Headphones, Pause, Play, RotateCcw, Save, X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
import { floatingSurfaceClassName } from '@/components/ui/floating-surface'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { SliderRow } from '@/components/ui/slider-row'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { audioCandidateFileUrl, previewAudioEdit, saveAudioEdit, setAudioReview, type AudioCandidate, type AudioEditParams } from '@/lib/api-audio'
import { getErrorMessage } from '@/lib/error-message'
import { createRandomUuid } from '@/lib/random-uuid'
import { cn } from '@/lib/utils'
import { audioPlayer, useAudioPlayer } from './audio-player'
import { drawPeaks, loadAudioWaveform } from './audio-waveform'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'

const DEFAULT_FADE_IN = 0.005
const DEFAULT_FADE_OUT = 0.01
const round3 = (value: number) => Math.round(value * 1000) / 1000

function defaultParams(duration: number): AudioEditParams {
  return { start: 0, end: round3(duration), gain_db: 0, pitch_semitones: 0, speed: 1, fade_in: DEFAULT_FADE_IN, fade_out: DEFAULT_FADE_OUT }
}

/** Same rules as the server (and the original app): trim in source time, fades in post-speed time. */
export function editProblem(params: AudioEditParams, duration: number, t: ReturnType<typeof useI18n>['t']): string | null {
  if (!(params.start >= 0) || !(params.end > params.start) || params.start >= duration || params.end > duration + 0.025) return t({ ko: '구간이 올바르지 않아.', en: 'The region is not valid.' })
  const length = (Math.min(params.end, duration) - params.start) / params.speed
  if (params.fade_in < 0 || params.fade_out < 0 || params.fade_in > 5 || params.fade_out > 5) return t({ ko: '페이드는 0~5초야.', en: 'Fades are 0–5 s.' })
  if (params.fade_in + params.fade_out > length + 1e-9) return t({ ko: '페이드가 결과 길이보다 길어.', en: 'The fades are longer than the result.' })
  return null
}

function provenanceRows(candidate: AudioCandidate, t: ReturnType<typeof useI18n>['t']): Array<[string, string, boolean?]> {
  const p = (candidate.provenance ?? {}) as Record<string, unknown>
  const rows: Array<[string, string, boolean?]> = []
  const text = typeof p.prompt === 'string' ? p.prompt : null
  if (text) rows.push([t({ ko: '프롬프트', en: 'Prompt' }), text, true])
  if (p.seed !== undefined && p.seed !== null) rows.push(['seed', String(p.seed)])
  if (typeof p.workflow_name === 'string') rows.push([t({ ko: '워크플로', en: 'Workflow' }), p.workflow_name])
  if (typeof p.server_name === 'string') rows.push([t({ ko: '서버', en: 'Server' }), p.server_name])
  if (typeof p.order_id === 'string') rows.push([t({ ko: '주문', en: 'Order' }), `#${p.order_id.slice(0, 4)}`])
  if (typeof p.original_name === 'string') rows.push([t({ ko: '원본', en: 'Source' }), p.original_name])
  return rows
}

type DragMode = { kind: 'start' | 'end' | 'move' | 'new' | 'seek'; originX: number; originStart: number; originEnd: number; anchor: number } | null

/** The right-hand editor: region on the waveform, gain/pitch/speed/fades, region play, server preview, save as a new take. */
export function AudioEditorPanel({ candidate, canEdit, onClose, onSaved, className, showHeader = true }: {
  candidate: AudioCandidate
  /** Off inside the narrow-screen sheet, which has its own title and close. */
  showHeader?: boolean
  canEdit: boolean
  onClose: () => void
  onSaved: (created: AudioCandidate) => void
  className?: string
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const player = useAudioPlayer()
  const auth = useAuthStatusQuery()
  const scope = JSON.stringify([auth.data?.accountId, auth.data?.hasCredentials, auth.data?.permissionKeys])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  const [duration, setDuration] = useState<number>(candidate.file.duration ?? 0)
  const [params, setParams] = useState<AudioEditParams>(() => defaultParams(candidate.file.duration ?? 0))
  const [notes, setNotes] = useState(candidate.notes)
  const drag = useRef<DragMode>(null)
  const [selectRegion, setSelectRegion] = useState(false)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null)
  const previewUrl = useRef<string | null>(null)
  const previewRequest = useRef<AbortController | null>(null)
  const regionKey = `region:${candidate.id}`
  const previewKey = `preview:${candidate.id}`

  // A new take resets the editor; the memo follows the server copy.
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setPeaks(null)
    setDuration(candidate.file.duration ?? 0)
    setParams(defaultParams(candidate.file.duration ?? 0))
    loadAudioWaveform(candidate.id, candidate.file_hash, { scope, signal: controller.signal }).then((waveform) => {
      if (cancelled) return
      setDuration(waveform.duration)
      setPeaks(waveform.editorPeaks)
      setParams((current) => (current.end === 0 || current.end > waveform.duration ? { ...current, end: round3(waveform.duration) } : current))
    }).catch(() => undefined)
    return () => { cancelled = true; controller.abort() }
  }, [candidate.id, candidate.file_hash, candidate.file.duration, scope])

  useEffect(() => { setNotes(candidate.notes) }, [candidate.id, candidate.notes])

  useEffect(() => () => {
    previewRequest.current?.abort()
    if (audioPlayer.state.key === regionKey || audioPlayer.state.key === previewKey) audioPlayer.stop()
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
  }, [previewKey, regionKey])

  const playing = player.playing && (player.key === regionKey || player.key === previewKey || player.key === candidate.id)
  const playhead = player.key === regionKey || player.key === candidate.id ? player.currentTime : null

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const render = () => drawPeaks(canvas, peaks, { bar: 2, gap: 1 })
    render()
    const observer = new ResizeObserver(render)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [peaks])

  const length = duration > 0 ? (Math.min(params.end, duration) - params.start) / params.speed : 0
  const problem = duration > 0 ? editProblem(params, duration, t) : null
  const changed = useMemo(() => {
    const base = defaultParams(duration)
    return (Object.keys(base) as Array<keyof AudioEditParams>).some((key) => Math.abs(base[key] - params[key]) > 1e-6)
  }, [params, duration])
  const set = (patch: Partial<AudioEditParams>) => setParams((current) => ({ ...current, ...patch }))

  const timeAt = (clientX: number) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || duration <= 0) return 0
    return Math.min(duration, Math.max(0, ((clientX - rect.left) / rect.width) * duration))
  }
  const seekTo = (seconds: number) => {
    const at = Math.max(0, Math.min(duration, seconds))
    if (audioPlayer.state.key === candidate.id && audioPlayer.state.playing) audioPlayer.seek(at)
    else audioPlayer.play(candidate.id, { start: at })
  }
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (duration <= 0 || event.button !== 0 || !event.isPrimary) return
    event.preventDefault()
    event.currentTarget.focus()
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const startX = (params.start / duration) * rect.width
    const endX = (params.end / duration) * rect.width
    const selecting = selectRegion || event.shiftKey
    const startDistance = Math.abs(x - startX)
    const endDistance = Math.abs(x - endX)
    const kind = startDistance <= 12 && startDistance <= endDistance ? 'start' : endDistance <= 12 ? 'end' : !selecting ? 'seek' : !event.shiftKey && x > startX && x < endX ? 'move' : 'new'
    event.currentTarget.setPointerCapture(event.pointerId)
    const anchor = timeAt(event.clientX)
    drag.current = { kind, originX: event.clientX, originStart: params.start, originEnd: params.end, anchor }
    if (kind === 'seek') seekTo(anchor)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const at = timeAt(event.clientX)
    setHoverTime(at)
    const activeDrag = drag.current
    if (!activeDrag) return
    if (activeDrag.kind === 'seek') { seekTo(at); return }
    if (Math.abs(event.clientX - activeDrag.originX) < 3) return
    const rect = event.currentTarget.getBoundingClientRect()
    const delta = ((event.clientX - activeDrag.originX) / rect.width) * duration
    const minSpan = Math.min(0.01, duration)
    if (activeDrag.kind === 'start') set({ start: round3(Math.max(0, Math.min(at, activeDrag.originEnd - minSpan))) })
    else if (activeDrag.kind === 'end') set({ end: round3(Math.min(duration, Math.max(at, activeDrag.originStart + minSpan))) })
    else if (activeDrag.kind === 'move') {
      const span = activeDrag.originEnd - activeDrag.originStart
      const start = Math.min(duration - span, Math.max(0, activeDrag.originStart + delta))
      set({ start: round3(start), end: round3(start + span) })
    } else {
      const start = Math.min(activeDrag.anchor, at, duration - minSpan)
      set({ start: round3(start), end: round3(Math.min(duration, Math.max(start + minSpan, activeDrag.anchor, at))) })
    }
  }

  const playRegion = () => {
    if (problem || duration <= 0) return
    audioPlayer.play(regionKey, { src: audioCandidateFileUrl(candidate.id), start: params.start, end: params.end, rate: params.speed })
  }
  const togglePlayback = () => {
    if (playing) { audioPlayer.pause(); return }
    if ((player.key === candidate.id || player.key === previewKey) && player.currentTime < player.duration) audioPlayer.resume()
    else if (player.key === regionKey && player.currentTime >= params.start && player.currentTime < params.end) {
      audioPlayer.play(regionKey, { src: audioCandidateFileUrl(candidate.id), start: player.currentTime, end: params.end, rate: params.speed })
    } else if (player.key === regionKey) playRegion()
    else audioPlayer.play(candidate.id, { start: 0 })
  }
  const playPreview = async () => {
    if (problem) return
    previewRequest.current?.abort()
    const controller = new AbortController()
    previewRequest.current = controller
    setBusy('preview')
    try {
      const blob = await previewAudioEdit(candidate.id, params, controller.signal)
      if (controller.signal.aborted) return
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
      previewUrl.current = URL.createObjectURL(blob)
      audioPlayer.play(previewKey, { src: previewUrl.current, start: 0 })
    } catch (error) {
      if (!controller.signal.aborted) showSnackbar({ message: getErrorMessage(error, t({ ko: '실패했어.', en: 'Failed.' })), tone: 'error' })
    } finally {
      if (previewRequest.current === controller) {
        previewRequest.current = null
        if (!controller.signal.aborted) setBusy(null)
      }
    }
  }
  const save = async () => {
    if (problem || !changed) return
    setBusy('save')
    try {
      const created = await saveAudioEdit(candidate.id, params, createRandomUuid())
      showSnackbar({ message: t({ ko: '편집본을 저장했어.', en: 'Saved the edit.' }) })
      onSaved(created)
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '실패했어.', en: 'Failed.' })), tone: 'error' })
    } finally {
      setBusy(null)
    }
  }
  const saveNotes = async () => {
    if (notes === candidate.notes || !canEdit) return
    try {
      await setAudioReview(candidate.id, { notes })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '실패했어.', en: 'Failed.' })), tone: 'error' })
    }
  }

  const left = duration > 0 ? (params.start / duration) * 100 : 0
  const right = duration > 0 ? 100 - (params.end / duration) * 100 : 0
  const number = (value: number, digits = 3) => (Number.isFinite(value) ? value.toFixed(digits) : '')

  return (
    <div className={cn('flex min-w-0 flex-col gap-4', className)}>
      {showHeader ? (
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-bold">{candidate.name}</h2>
          <IconButton variant="ghost" size="icon-sm" label={t({ ko: '닫기', en: 'Close' })} onClick={onClose}><X /></IconButton>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="xs" variant={selectRegion ? 'ghost' : 'secondary'} aria-pressed={!selectRegion} onClick={() => setSelectRegion(false)}>{t({ ko: '재생 탐색', en: 'Seek' })}</Button>
        <Button size="xs" variant={selectRegion ? 'secondary' : 'ghost'} aria-pressed={selectRegion} onClick={() => setSelectRegion(true)}>{t({ ko: '구간 선택', en: 'Select region' })}</Button>
        <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">{number(playhead ?? 0, 2)} / {number(duration, 2)}s</span>
      </div>
      <div
        role="slider"
        tabIndex={0}
        aria-label={t({ ko: '오디오 재생 위치', en: 'Audio playback position' })}
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={Math.min(duration, playhead ?? 0)}
        aria-valuetext={`${number(playhead ?? 0, 2)} / ${number(duration, 2)}s`}
        aria-disabled={duration <= 0}
        className={cn('relative h-24 overflow-hidden touch-none select-none rounded-sm bg-foreground/[0.03] outline-none focus-visible:ring-2 focus-visible:ring-ring', selectRegion ? 'cursor-crosshair' : 'cursor-pointer')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
        onPointerCancel={() => { drag.current = null }}
        onLostPointerCapture={() => { drag.current = null }}
        onPointerLeave={() => setHoverTime(null)}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey || duration <= 0) return
          const step = event.shiftKey ? 5 : 1
          const at = playhead ?? 0
          if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (!event.repeat) togglePlayback(); return }
          const next = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? at - step : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? at + step : event.key === 'Home' ? 0 : event.key === 'End' ? duration : null
          if (next === null) return
          event.preventDefault()
          event.stopPropagation()
          seekTo(next)
        }}
      >
        <canvas ref={canvasRef} aria-hidden className="absolute inset-0 block size-full border-0 border-primary text-foreground/45" />
        <div className={cn('pointer-events-none absolute inset-y-0 border-x-2 border-primary bg-primary/12', selectRegion && 'border-x-4')} style={{ left: `${left}%`, right: `${right}%` }} />
        {playhead !== null && duration > 0 ? <div className="pointer-events-none absolute inset-y-0 w-px bg-foreground" style={{ left: `${(playhead / duration) * 100}%` }} /> : null}
        {hoverTime !== null && duration > 0 ? <div className="pointer-events-none absolute inset-y-0 border-l border-foreground/40" style={{ left: `${(hoverTime / duration) * 100}%` }}><span className={cn(floatingSurfaceClassName, 'absolute top-1 px-1 font-mono text-2xs text-foreground', hoverTime > duration / 2 ? 'right-1' : 'left-1')}>{number(hoverTime, 2)}s</span></div> : null}
        {duration > 0 ? ([['start', left], ['end', 100 - right]] as const).map(([edge, position]) => (
          <span key={edge} aria-hidden className="absolute inset-y-0 w-6 -translate-x-1/2 cursor-ew-resize" style={{ left: `${position}%` }}>
            <span className="absolute top-1/2 left-1/2 h-6 w-1.5 -translate-1/2 rounded-full bg-primary" />
          </span>
        )) : null}
      </div>
      <p className="-mt-2 text-2xs text-muted-foreground">{selectRegion ? t({ ko: '양 끝을 드래그해 구간 조절 · 안쪽 드래그로 이동 · Shift+드래그로 새 구간', en: 'Drag edges to trim · Drag inside to move · Shift+drag for a new region' }) : t({ ko: '클릭·드래그로 해당 위치 재생 · 양 끝 손잡이로 구간 조절 · Shift+드래그로 구간 선택 · 파형에 포커스: Space 재생/정지, ← → 1초 이동 (Shift: 5초)', en: 'Click or drag to seek and play · Drag edge handles to trim · Shift+drag to select · Waveform focused: Space play/pause, ← → 1 s (Shift: 5 s)' })}</p>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t({ ko: '시작', en: 'Start' })} className="min-w-0">
          <Input mono className="min-w-0" type="number" step="0.001" min={0} value={number(params.start)} onChange={(event) => set({ start: Number(event.target.value) })} />
        </Field>
        <Field label={t({ ko: '끝', en: 'End' })} className="min-w-0">
          <Input mono className="min-w-0" type="number" step="0.001" min={0} value={number(params.end)} onChange={(event) => set({ end: Number(event.target.value) })} />
        </Field>
      </div>

      <div className="space-y-2">
        {([
          ['gain_db', t({ ko: '음량', en: 'Gain' }), -60, 24, 0.5, `${params.gain_db > 0 ? '+' : ''}${params.gain_db.toFixed(1)}dB`],
          ['pitch_semitones', t({ ko: '피치', en: 'Pitch' }), -24, 24, 0.5, `${params.pitch_semitones > 0 ? '+' : ''}${params.pitch_semitones.toFixed(1)}`],
          ['speed', t({ ko: '속도', en: 'Speed' }), 0.25, 4, 0.05, `${params.speed.toFixed(2)}×`],
        ] as const).map(([key, label, min, max, step, readout]) => (
          <SliderRow key={key} label={label} min={min} max={max} step={step} value={params[key]} readout={readout} onChange={(value) => set({ [key]: value } as Partial<AudioEditParams>)} />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t({ ko: '페이드 인', en: 'Fade in' })} className="min-w-0">
          <Input mono className="min-w-0" type="number" step="0.005" min={0} max={5} value={params.fade_in} onChange={(event) => set({ fade_in: Number(event.target.value) })} />
        </Field>
        <Field label={t({ ko: '페이드 아웃', en: 'Fade out' })} className="min-w-0">
          <Input mono className="min-w-0" type="number" step="0.005" min={0} max={5} value={params.fade_out} onChange={(event) => set({ fade_out: Number(event.target.value) })} />
        </Field>
      </div>
      {problem ? <p className="text-xs text-destructive">{problem}</p> : null}

      <div className="flex items-center gap-1">
        <IconButton variant="secondary" size="icon-sm" disabled={duration <= 0} label={playing ? t({ ko: '일시정지', en: 'Pause' }) : t({ ko: '재생', en: 'Play' })} onClick={togglePlayback}>{playing ? <Pause /> : <Play />}</IconButton>
        <Button variant="ghost" size="xs" disabled={duration <= 0 || Boolean(problem)} onClick={playRegion}>{t({ ko: '구간 재생', en: 'Play region' })}</Button>
        {canEdit ? <IconButton variant="secondary" size="icon-sm" label={t({ ko: '편집 미리듣기', en: 'Preview edit' })} disabled={Boolean(problem) || busy !== null} onClick={() => void playPreview()}><Headphones /></IconButton> : null}
        <IconButton variant="ghost" size="icon-sm" label={t({ ko: '되돌리기', en: 'Reset' })} disabled={!changed} onClick={() => setParams(defaultParams(duration))}><RotateCcw /></IconButton>
        <span className="flex-1" />
        <Tip content={t({ ko: '결과 길이', en: 'Result length' })}>
          <span className="font-mono text-xs text-muted-foreground" tabIndex={0}>{length > 0 ? `${length.toFixed(2)}s` : '—'}</span>
        </Tip>
        {canEdit ? (
          <Button size="sm" disabled={Boolean(problem) || !changed || busy !== null} onClick={() => void save()}>
            <Save />{t({ ko: '편집본 저장', en: 'Save edit' })}
          </Button>
        ) : null}
      </div>

      <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-line pt-3 text-xs">
        {provenanceRows(candidate, t).map(([label, value, prose]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={cn('min-w-0', prose ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'truncate font-mono')}>{value}</dd>
          </div>
        ))}
      </dl>

      <Field label={t({ ko: '메모', en: 'Memo' })}>
        <Textarea className="min-w-0 max-w-full resize-y" rows={3} value={notes} disabled={!canEdit} onChange={(event) => setNotes(event.target.value)} onBlur={() => void saveNotes()} />
      </Field>
    </div>
  )
}
