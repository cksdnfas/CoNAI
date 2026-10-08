import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Headphones, Pause, Play, RotateCcw, Save, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { audioCandidateFileUrl, previewAudioEdit, saveAudioEdit, setAudioReview, type AudioCandidate, type AudioEditParams } from '@/lib/api-audio'
import { getErrorMessage } from '@/lib/error-message'
import { createRandomUuid } from '@/lib/random-uuid'
import { cn } from '@/lib/utils'
import { audioPlayer, useAudioPlayer } from './audio-player'
import { computePeaks, drawPeaks, loadAudioBuffer } from './audio-waveform'

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

type DragMode = { kind: 'start' | 'end' | 'move' | 'new'; originX: number; originStart: number; originEnd: number } | null

/** The right-hand editor: region on the waveform, gain/pitch/speed/fades, region play, server preview, save as a new take. */
export function AudioEditorPanel({ candidate, canEdit, onClose, onSaved, className }: {
  candidate: AudioCandidate
  canEdit: boolean
  onClose: () => void
  onSaved: (created: AudioCandidate) => void
  className?: string
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const player = useAudioPlayer()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  const [duration, setDuration] = useState<number>(candidate.file.duration ?? 0)
  const [params, setParams] = useState<AudioEditParams>(() => defaultParams(candidate.file.duration ?? 0))
  const [notes, setNotes] = useState(candidate.notes)
  const [drag, setDrag] = useState<DragMode>(null)
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null)
  const previewUrl = useRef<string | null>(null)
  const regionKey = `region:${candidate.id}`
  const previewKey = `preview:${candidate.id}`

  // A new take resets the editor; the memo follows the server copy.
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setPeaks(null)
    setNotes(candidate.notes)
    setParams(defaultParams(candidate.file.duration ?? 0))
    loadAudioBuffer(audioCandidateFileUrl(candidate.id), controller.signal).then((buffer) => {
      if (cancelled) return
      setDuration(buffer.duration)
      setPeaks(computePeaks(buffer, 1600))
      setParams((current) => (current.end === 0 || current.end > buffer.duration ? { ...current, end: round3(buffer.duration) } : current))
    }).catch(() => undefined)
    return () => { cancelled = true; controller.abort() }
  }, [candidate.id, candidate.notes, candidate.file.duration])

  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current) }, [])

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
    if (!rect || duration <= 0) return 0
    return Math.min(duration, Math.max(0, ((clientX - rect.left) / rect.width) * duration))
  }
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const startX = (params.start / duration) * rect.width
    const endX = (params.end / duration) * rect.width
    const kind = Math.abs(x - startX) <= 8 ? 'start' : Math.abs(x - endX) <= 8 ? 'end' : x > startX && x < endX ? 'move' : 'new'
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ kind, originX: event.clientX, originStart: params.start, originEnd: params.end })
    if (kind === 'new') {
      const at = round3(timeAt(event.clientX))
      set({ start: at, end: round3(Math.min(duration, at + 0.01)) })
    }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return
    const at = timeAt(event.clientX)
    const rect = event.currentTarget.getBoundingClientRect()
    const delta = ((event.clientX - drag.originX) / rect.width) * duration
    if (drag.kind === 'start') set({ start: round3(Math.min(at, params.end - 0.01)) })
    else if (drag.kind === 'end') set({ end: round3(Math.max(at, params.start + 0.01)) })
    else if (drag.kind === 'move') {
      const span = drag.originEnd - drag.originStart
      const start = Math.min(duration - span, Math.max(0, drag.originStart + delta))
      set({ start: round3(start), end: round3(start + span) })
    } else {
      const anchor = drag.originStart
      set({ start: round3(Math.min(anchor, at)), end: round3(Math.max(anchor + 0.01, at)) })
    }
  }

  const playRegion = () => {
    if (playing) { audioPlayer.pause(); return }
    audioPlayer.play(regionKey, { src: audioCandidateFileUrl(candidate.id), start: params.start, end: params.end, rate: params.speed })
  }
  const playPreview = async () => {
    if (problem) return
    setBusy('preview')
    try {
      const blob = await previewAudioEdit(candidate.id, params)
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
      previewUrl.current = URL.createObjectURL(blob)
      audioPlayer.play(previewKey, { src: previewUrl.current, start: 0 })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '실패했어.', en: 'Failed.' })), tone: 'error' })
    } finally {
      setBusy(null)
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
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-bold">{candidate.name}</h2>
        <IconButton variant="ghost" size="icon-sm" label={t({ ko: '닫기', en: 'Close' })} onClick={onClose}><X /></IconButton>
      </div>

      <div
        className="relative h-24 cursor-crosshair touch-none select-none rounded-sm bg-foreground/[0.03]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
      >
        <canvas ref={canvasRef} aria-hidden className="absolute inset-0 block size-full border-0 border-primary text-foreground/45" />
        <div className="absolute inset-y-0 border-x-2 border-primary bg-primary/12" style={{ left: `${left}%`, right: `${right}%` }} />
        {playhead !== null && duration > 0 ? <div className="pointer-events-none absolute inset-y-0 w-px bg-foreground" style={{ left: `${(playhead / duration) * 100}%` }} /> : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">{t({ ko: '시작', en: 'Start' })}
          <Input className="font-mono" type="number" step="0.001" min={0} value={number(params.start)} onChange={(event) => set({ start: Number(event.target.value) })} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">{t({ ko: '끝', en: 'End' })}
          <Input className="font-mono" type="number" step="0.001" min={0} value={number(params.end)} onChange={(event) => set({ end: Number(event.target.value) })} />
        </label>
      </div>

      <div className="space-y-2">
        {([
          ['gain_db', t({ ko: '음량', en: 'Gain' }), -60, 24, 0.5, `${params.gain_db > 0 ? '+' : ''}${params.gain_db.toFixed(1)}dB`],
          ['pitch_semitones', t({ ko: '피치', en: 'Pitch' }), -24, 24, 0.5, `${params.pitch_semitones > 0 ? '+' : ''}${params.pitch_semitones.toFixed(1)}`],
          ['speed', t({ ko: '속도', en: 'Speed' }), 0.25, 4, 0.05, `${params.speed.toFixed(2)}×`],
        ] as const).map(([key, label, min, max, step, readout]) => (
          <div key={key} className="grid grid-cols-[3.5rem_1fr_4rem] items-center gap-3 text-xs text-muted-foreground">
            <span>{label}</span>
            <Slider aria-label={label} min={min} max={max} step={step} value={[params[key]]} onValueChange={([value]) => set({ [key]: value } as Partial<AudioEditParams>)} />
            <span className="text-right font-mono text-foreground">{readout}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">{t({ ko: '페이드 인', en: 'Fade in' })}
          <Input className="font-mono" type="number" step="0.005" min={0} max={5} value={params.fade_in} onChange={(event) => set({ fade_in: Number(event.target.value) })} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">{t({ ko: '페이드 아웃', en: 'Fade out' })}
          <Input className="font-mono" type="number" step="0.005" min={0} max={5} value={params.fade_out} onChange={(event) => set({ fade_out: Number(event.target.value) })} />
        </label>
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">{t({ ko: '결과 길이', en: 'Result' })}
          <span className="flex h-9 items-center font-mono text-sm text-foreground">{length > 0 ? `${length.toFixed(2)}s` : '—'}</span>
        </div>
      </div>
      {problem ? <p className="text-xs text-destructive">{problem}</p> : null}

      <div className="flex items-center gap-1">
        <IconButton variant="secondary" size="icon-sm" label={t({ ko: '구간 재생', en: 'Play region' })} onClick={playRegion}>{playing && player.key === regionKey ? <Pause /> : <Play />}</IconButton>
        {canEdit ? <IconButton variant="secondary" size="icon-sm" label={t({ ko: '편집 미리듣기', en: 'Preview edit' })} disabled={Boolean(problem) || busy !== null} onClick={() => void playPreview()}><Headphones /></IconButton> : null}
        <IconButton variant="ghost" size="icon-sm" label={t({ ko: '되돌리기', en: 'Reset' })} disabled={!changed} onClick={() => setParams(defaultParams(duration))}><RotateCcw /></IconButton>
        <span className="flex-1" />
        {canEdit ? (
          <Button size="sm" disabled={Boolean(problem) || !changed || busy !== null} onClick={() => void save()}>
            <Save />{t({ ko: '편집본 저장', en: 'Save edit' })}
          </Button>
        ) : null}
      </div>

      <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1.5 border-t border-line pt-3 text-xs">
        {provenanceRows(candidate, t).map(([label, value, prose]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={cn('min-w-0', prose ? 'break-words' : 'truncate font-mono')}>{value}</dd>
          </div>
        ))}
      </dl>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">{t({ ko: '메모', en: 'Memo' })}
        <Textarea rows={3} value={notes} disabled={!canEdit} onChange={(event) => setNotes(event.target.value)} onBlur={() => void saveNotes()} />
      </label>
    </div>
  )
}
