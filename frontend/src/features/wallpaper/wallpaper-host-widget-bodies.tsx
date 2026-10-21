import { useEffect, useRef, useState } from 'react'
import { Music, Play } from 'lucide-react'
import { useI18n } from '@/i18n'
import { ApiRequestError } from '@/lib/api-request'
import { runWallpaperQuickRun } from '@/lib/api-wallpaper-runtime'
import { cn } from '@/lib/utils'
import type { WallpaperWidgetInstance } from './wallpaper-types'
import { readWallpaperHostAudio, useWallpaperHostState, WALLPAPER_AUDIO_BINS, type WallpaperHostSystemInfo, type WallpaperHostTrack } from './wallpaper-host-bridge'
import { getWallpaperWidgetErrorKind, WallpaperWidgetErrorNote, WallpaperWidgetNote } from './wallpaper-widget-note'
import { runWallpaperFrameLoop } from './wallpaper-playback'
import { useWallpaperComfyStats, useWallpaperDataEnvironment } from './wallpaper-widget-data'

/** Map display bars onto the spectrum, giving low frequencies more bars (they carry most of the energy). */
function sampleBars(levels: Float32Array, count: number, out: Float32Array) {
  for (let bar = 0; bar < count; bar += 1) {
    const from = Math.floor(Math.pow(bar / count, 1.6) * WALLPAPER_AUDIO_BINS)
    const to = Math.max(from + 1, Math.floor(Math.pow((bar + 1) / count, 1.6) * WALLPAPER_AUDIO_BINS))
    let peak = 0
    for (let index = from; index < to && index < WALLPAPER_AUDIO_BINS; index += 1) peak = Math.max(peak, levels[index])
    out[bar] = peak
  }
}

/** Editor preview without a host: a calm synthetic spectrum. */
function demoLevels(time: number, out: Float32Array) {
  for (let index = 0; index < out.length; index += 1) {
    const position = index / out.length
    out[index] = Math.max(0, (0.55 - position * 0.4) * (0.6 + 0.4 * Math.sin(time / 380 + index * 0.55)) + 0.12 * Math.sin(time / 170 + index * 1.7))
  }
}

/** System audio and now playing come only from a desktop host package. */
function useWallpaperHostHint() {
  const { t } = useI18n()
  return t({ ko: 'Lively나 Wallpaper Engine 패키지로 열면 보여.', en: 'Shown when opened from the Lively or Wallpaper Engine package.' })
}

/** Backing pixels per CSS pixel: the stage scale (read from the rendered size) times the screen density, capped. */
function readCanvasPixelRatio(canvas: HTMLCanvasElement) {
  const stageScale = canvas.clientWidth > 0 ? canvas.getBoundingClientRect().width / canvas.clientWidth : 1
  return Math.max(1, Math.min(4, stageScale * (window.devicePixelRatio || 1)))
}

export function WallpaperAudioVisualizerBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'audio-visualizer' }> }) {
  const { mode } = useWallpaperDataEnvironment()
  const { host } = useWallpaperHostState()
  const hostHint = useWallpaperHostHint()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const { shape, barCount, sensitivity, smoothing, color } = widget.settings

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return undefined
    const count = Math.max(8, Math.min(64, Math.round(barCount)))
    const target = new Float32Array(count)
    const shown = new Float32Array(count)
    const demo = new Float32Array(WALLPAPER_AUDIO_BINS)
    const gain = Math.max(0.5, Math.min(3, sensitivity / 100))
    const fall = Math.max(0, Math.min(0.9, smoothing / 100))
    let paint = color ?? ''
    let paintCheckedAt = 0
    let pixelRatio = 1

    return runWallpaperFrameLoop((now) => {
      // Drawing stays in CSS px; the backing store follows stage zoom and screen density so 4K hosts stay sharp.
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (width <= 0 || height <= 0) return
      // The accent can change with the theme or the background, the stage scale with the window; re-read them
      // about once a second.
      if (now - paintCheckedAt > 1000) {
        if (!color) paint = getComputedStyle(canvas).color
        pixelRatio = readCanvasPixelRatio(canvas)
        paintCheckedAt = now
      }
      const backingWidth = Math.round(width * pixelRatio)
      const backingHeight = Math.round(height * pixelRatio)
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth
        canvas.height = backingHeight
      }
      context.setTransform(backingWidth / width, 0, 0, backingHeight / height, 0, 0)
      const audio = readWallpaperHostAudio()
      if (audio.fresh) sampleBars(audio.levels, count, target)
      else if (mode === 'editor') {
        demoLevels(now, demo)
        sampleBars(demo, count, target)
      } else target.fill(0)
      for (let index = 0; index < count; index += 1) {
        const value = Math.min(1, target[index] * gain)
        shown[index] = value > shown[index] ? value : shown[index] * fall + value * (1 - fall)
      }

      context.clearRect(0, 0, width, height)
      context.fillStyle = paint
      context.strokeStyle = paint
      const gap = Math.max(1, Math.round(width / count / 5))
      const barWidth = Math.max(1, width / count - gap)
      const minimum = 2
      switch (shape) {
        case 'mirror':
          for (let index = 0; index < count; index += 1) {
            const bar = Math.max(minimum, shown[index] * height)
            context.fillRect(index * (barWidth + gap) + gap / 2, (height - bar) / 2, barWidth, bar)
          }
          break
        case 'wave': {
          context.lineWidth = Math.max(2, height / 40)
          context.lineJoin = 'round'
          context.beginPath()
          for (let index = 0; index < count; index += 1) {
            const x = (index / (count - 1)) * width
            const y = height - minimum - shown[index] * (height - minimum * 2)
            if (index === 0) context.moveTo(x, y)
            else {
              const previousX = ((index - 1) / (count - 1)) * width
              const previousY = height - minimum - shown[index - 1] * (height - minimum * 2)
              context.quadraticCurveTo(previousX, previousY, (previousX + x) / 2, (previousY + y) / 2)
            }
          }
          context.stroke()
          context.lineTo(width, height)
          context.lineTo(0, height)
          context.closePath()
          context.globalAlpha = 0.18
          context.fill()
          context.globalAlpha = 1
          break
        }
        case 'circle': {
          const radius = Math.min(width, height) * 0.28
          const reach = Math.min(width, height) / 2 - radius
          const thickness = Math.max(1.5, (Math.PI * 2 * radius) / count - 2)
          context.lineWidth = thickness
          context.lineCap = 'round'
          for (let index = 0; index < count; index += 1) {
            const angle = (index / count) * Math.PI * 2 - Math.PI / 2
            const length = Math.max(minimum, shown[index] * reach)
            context.beginPath()
            context.moveTo(width / 2 + Math.cos(angle) * radius, height / 2 + Math.sin(angle) * radius)
            context.lineTo(width / 2 + Math.cos(angle) * (radius + length), height / 2 + Math.sin(angle) * (radius + length))
            context.stroke()
          }
          break
        }
        default:
          for (let index = 0; index < count; index += 1) {
            const bar = Math.max(minimum, shown[index] * height)
            context.fillRect(index * (barWidth + gap) + gap / 2, height - bar, barWidth, bar)
          }
      }
    }, 100)
  }, [barCount, color, mode, sensitivity, shape, smoothing])

  return (
    <div className="relative h-full w-full">
      <canvas ref={canvasRef} aria-hidden="true" className="block h-full w-full text-primary" style={color ? { color } : undefined} />
      {/* Outside a host the live page has no audio; say why instead of flat bars. */}
      {mode === 'runtime' && host === null ? <div className="absolute inset-0"><WallpaperWidgetNote>{hostHint}</WallpaperWidgetNote></div> : null}
    </div>
  )
}

const SAMPLE_TRACK: WallpaperHostTrack = { title: 'Midnight Signal', artist: 'CoNAI', album: '', thumbnail: null }

export function WallpaperNowPlayingBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'now-playing' }> }) {
  const { t } = useI18n()
  const { mode } = useWallpaperDataEnvironment()
  const { host, track: hostTrack } = useWallpaperHostState()
  const hostHint = useWallpaperHostHint()
  const track = hostTrack ?? (mode === 'editor' ? SAMPLE_TRACK : null)
  const { layout, showArt, hideWhenIdle } = widget.settings

  if (!track) {
    // The marker hides the whole widget frame (index.css), not just this body, so no empty card is left behind.
    if (hideWhenIdle) return <span data-wallpaper-hide-frame="" hidden />
    return <WallpaperWidgetNote>{host === null ? hostHint : t({ ko: '재생 중인 곡이 없어.', en: 'Nothing is playing.' })}</WallpaperWidgetNote>
  }

  const art = showArt ? (
    <div className={cn('shrink-0 overflow-hidden rounded-lg', layout === 'stack' ? 'aspect-square w-full max-w-[min(100%,60cqh)]' : 'aspect-square h-full max-h-[96cqh]')} style={{ background: 'color-mix(in srgb,var(--primary) 28%,transparent)' }}>
      {track.thumbnail ? (
        <img src={track.thumbnail} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="flex h-full w-full items-center justify-center"><Music className="size-[40%] opacity-70" /></div>
      )}
    </div>
  ) : null

  return (
    <div
      className={cn('flex h-full min-w-0', layout === 'stack' ? 'flex-col items-start justify-end' : 'items-center')}
      // Row: three text lines share the height. Stack: the art takes most of it, so lean on the width.
      style={{ fontSize: layout === 'stack' ? 'clamp(12px, min(7cqh, 6cqw), 30px)' : 'clamp(12px, min(17cqh, 5cqw), 32px)', gap: layout === 'stack' ? '0.5em' : '0.8em' }}
    >
      {art}
      <div className="min-w-0 flex-1 self-stretch">
        <div className="flex h-full min-w-0 flex-col justify-center">
          <div className="truncate font-semibold" style={{ fontSize: '1.15em' }}>{track.title || t({ ko: '알 수 없는 곡', en: 'Unknown track' })}</div>
          {track.artist ? <div className="truncate opacity-70">{track.artist}</div> : null}
          {track.album ? <div className="truncate opacity-50" style={{ fontSize: '0.8em' }}>{track.album}</div> : null}
        </div>
      </div>
    </div>
  )
}

interface Meter {
  key: string
  label: string
  /** 0-1 */
  ratio: number
  detail: string
}

function MeterList({ meters, display }: { meters: Meter[]; display: 'bars' | 'rings' }) {
  const count = Math.max(1, meters.length)
  if (display === 'rings') {
    // Rings share the width in one row and take the height left after the label (and network) line.
    return (
      <div
        className="flex h-full flex-wrap items-center justify-around overflow-hidden [align-content:safe_center]"
        style={{ gap: '0.75em', fontSize: 'clamp(11px, min(7cqh, 3.2cqw), 20px)' }}
      >
        {meters.map((meter) => (
          <div key={meter.key} className="flex min-w-0 flex-col items-center" style={{ gap: '0.25em' }}>
            <svg viewBox="0 0 36 36" style={{ width: `min(calc(100cqh - 3.5em), ${(84 / count).toFixed(1)}cqw)`, height: 'auto' }} aria-hidden="true">
              <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="3.5" />
              <circle
                cx="18"
                cy="18"
                r="15"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray={`${(Math.max(0, Math.min(1, meter.ratio)) * 94.25).toFixed(2)} 94.25`}
                transform="rotate(-90 18 18)"
                className="transition duration-700"
                style={{ transitionProperty: 'stroke-dasharray' }}
              />
              <text x="18" y="21" textAnchor="middle" fontSize="9" className="fill-current font-semibold tabular-nums">{Math.round(meter.ratio * 100)}</text>
            </svg>
            <div className="max-w-[8em] truncate opacity-70" style={{ fontSize: '0.85em' }}>{meter.label}</div>
          </div>
        ))}
      </div>
    )
  }
  // A bar row is about 2.9em with its gap (3.2 leaves room for the network line); later rows clip first.
  return (
    <div
      className="flex h-full flex-col overflow-hidden [justify-content:safe_center]"
      style={{ gap: '0.7em', fontSize: `clamp(11px, min(${(100 / (count * 3.2)).toFixed(2)}cqh, 3.4cqw), 22px)` }}
    >
      {meters.map((meter) => (
        <div key={meter.key} className="min-w-0 shrink-0">
          <div className="flex items-baseline justify-between" style={{ gap: '0.5em' }}>
            <span className="truncate opacity-75">{meter.label}</span>
            <span className="shrink-0 tabular-nums opacity-60">{meter.detail}</span>
          </div>
          <div className="h-[0.4em] overflow-hidden rounded-full" style={{ marginTop: '0.3em', background: 'color-mix(in srgb,currentColor 14%,transparent)' }}>
            <div className="h-full rounded-full bg-primary transition duration-700" style={{ transitionProperty: 'width', width: `${Math.round(Math.max(0, Math.min(1, meter.ratio)) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function formatBytes(bytes: number) {
  const gb = bytes / 1024 ** 3
  return gb >= 10 ? `${gb.toFixed(0)} GB` : `${gb.toFixed(1)} GB`
}

function formatRate(bytesPerSecond: number) {
  const mb = bytesPerSecond / 1024 ** 2
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${(bytesPerSecond / 1024).toFixed(0)} KB/s`
}

const SAMPLE_SYSTEM: WallpaperHostSystemInfo = { cpuName: 'CPU', gpuName: 'GPU', cpu: 23, gpu: 61, ramTotal: 65536, ramAvailable: 38912, netDown: 2_400_000, netUp: 180_000 }

export function WallpaperSystemMonitorBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'system-monitor' }> }) {
  const { t } = useI18n()
  const { mode } = useWallpaperDataEnvironment()
  const { system: hostSystem } = useWallpaperHostState()
  const { source, display, showNetwork } = widget.settings
  const comfyQuery = useWallpaperComfyStats(source === 'comfyui')

  if (source === 'host') {
    const system = hostSystem ?? (mode === 'editor' ? SAMPLE_SYSTEM : null)
    if (!system) return <WallpaperWidgetNote>{t({ ko: 'Lively 패키지로 열면 보여.', en: 'Shown when opened from the Lively package.' })}</WallpaperWidgetNote>
    const ramUsed = Math.max(0, system.ramTotal - system.ramAvailable)
    const meters: Meter[] = [
      { key: 'cpu', label: 'CPU', ratio: system.cpu / 100, detail: `${Math.round(system.cpu)}%` },
      { key: 'gpu', label: 'GPU', ratio: system.gpu / 100, detail: `${Math.round(system.gpu)}%` },
      { key: 'ram', label: 'RAM', ratio: system.ramTotal > 0 ? ramUsed / system.ramTotal : 0, detail: `${(ramUsed / 1024).toFixed(1)} / ${(system.ramTotal / 1024).toFixed(0)} GB` },
    ]
    return (
      <div className="flex h-full flex-col gap-2">
        <div className="min-h-0 flex-1"><MeterList meters={meters} display={display} /></div>
        {showNetwork ? (
          <div className="flex shrink-0 justify-between gap-2 tabular-nums opacity-65" style={{ fontSize: 'clamp(10px,min(9cqh,3cqw),18px)' }}>
            <span>↓ {formatRate(system.netDown)}</span>
            <span>↑ {formatRate(system.netUp)}</span>
          </div>
        ) : null}
      </div>
    )
  }

  if (comfyQuery.isError) return <WallpaperWidgetErrorNote error={comfyQuery.error} forbidden={t({ ko: 'ComfyUI 상태는 관리자만 볼 수 있어.', en: 'ComfyUI stats are for administrators.' })} />
  const servers = comfyQuery.data ?? []
  if (servers.length === 0) {
    return <WallpaperWidgetNote>{comfyQuery.isLoading ? t({ ko: '불러오는 중…', en: 'Loading…' }) : t({ ko: '켜진 ComfyUI 서버가 없어.', en: 'No active ComfyUI server.' })}</WallpaperWidgetNote>
  }
  const meters: Meter[] = servers.flatMap((server) => {
    if (!server.online) return [{ key: `${server.id}-off`, label: server.name, ratio: 0, detail: t({ ko: '응답 없음', en: 'Offline' }) }]
    const vram = server.devices.map((device, index) => ({
      key: `${server.id}-gpu-${index}`,
      label: servers.length > 1 || server.devices.length > 1 ? `${server.name} · ${device.name}` : device.name,
      ratio: device.vramTotal > 0 ? (device.vramTotal - device.vramFree) / device.vramTotal : 0,
      detail: `${formatBytes(device.vramTotal - device.vramFree)} / ${formatBytes(device.vramTotal)}`,
    }))
    const ram = server.ramTotal && server.ramFree !== null
      ? [{ key: `${server.id}-ram`, label: servers.length > 1 ? `${server.name} · RAM` : 'RAM', ratio: (server.ramTotal - server.ramFree) / server.ramTotal, detail: `${formatBytes(server.ramTotal - server.ramFree)} / ${formatBytes(server.ramTotal)}` }]
      : []
    return [...vram, ...ram]
  })
  return <MeterList meters={meters} display={display} />
}

export function WallpaperQuickRunBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'quick-run' }> }) {
  const { t } = useI18n()
  const { mode, presetId } = useWallpaperDataEnvironment()
  const [status, setStatus] = useState<{ tone: 'idle' | 'busy' | 'ok' | 'info' | 'error'; message: string }>({ tone: 'idle', message: '' })
  const label = widget.settings.label.trim() || widget.settings.scheduleName || t({ ko: '실행', en: 'Run' })

  useEffect(() => {
    if (status.tone === 'idle' || status.tone === 'busy') return undefined
    const timer = window.setTimeout(() => setStatus({ tone: 'idle', message: '' }), 6000)
    return () => window.clearTimeout(timer)
  }, [status.tone])

  if (widget.settings.scheduleId === null) return <WallpaperWidgetNote>{t({ ko: '설정에서 실행할 예약을 골라줘.', en: 'Pick a schedule to run in settings.' })}</WallpaperWidgetNote>

  /** Server refusals in plain words instead of the raw English error. */
  const describeError = (error: unknown) => {
    if (getWallpaperWidgetErrorKind(error) === 'sign-in') return t({ ko: '로그인하거나 키가 든 URL이 필요해.', en: 'Sign in or open a URL with a key.' })
    if (error instanceof ApiRequestError) {
      if (error.status === 403) return t({ ko: '이 예약을 실행할 권한이 없어.', en: 'You may not run this schedule.' })
      if (error.status === 404) return t({ ko: '저장된 버튼이나 예약을 찾을 수 없어.', en: 'The saved button or schedule is gone.' })
      if (error.status === 429) return t({ ko: '방금 눌렀어. 잠깐 뒤에 다시 눌러줘.', en: 'Just pressed. Try again in a moment.' })
    }
    return t({ ko: '실행하지 못했어.', en: 'Could not run it.' })
  }

  const press = async () => {
    if (status.tone === 'busy') return
    if (mode !== 'runtime') {
      setStatus({ tone: 'info', message: t({ ko: '실제 월페이퍼에서만 실행돼.', en: 'Runs only on the live wallpaper.' }) })
      return
    }
    if (!presetId) {
      setStatus({ tone: 'error', message: t({ ko: '저장된 월페이퍼에서만 실행돼.', en: 'Runs only from a saved wallpaper.' }) })
      return
    }
    setStatus({ tone: 'busy', message: '' })
    try {
      const result = await runWallpaperQuickRun(presetId, widget.id)
      setStatus(result.enqueued > 0
        ? { tone: 'ok', message: t({ ko: '대기열에 넣었어.', en: 'Queued.' }) }
        : { tone: 'error', message: t({ ko: '예약 실행 한도에 걸렸어.', en: 'The schedule hit its run limit.' }) })
    } catch (error) {
      setStatus({ tone: 'error', message: describeError(error) })
    }
  }

  return (
    <div className="flex h-full flex-col items-stretch justify-center gap-1.5">
      {/* eslint-disable-next-line no-restricted-syntax -- wallpaper action button sized by the widget frame */}
      <button
        type="button"
        onClick={() => void press()}
        disabled={status.tone === 'busy'}
        className="flex min-h-0 flex-1 items-center justify-center bg-primary font-semibold text-primary-foreground transition hover:brightness-110 active:scale-98 disabled:opacity-60"
        // The label grows with the button; the status line below keeps its own smaller size.
        style={{ fontSize: 'clamp(14px, min(32cqh, 8cqw), 44px)', gap: '0.5em', borderRadius: '0.6em', paddingInline: '0.9em' }}
      >
        <Play className="size-[1.1em] shrink-0" />
        <span className="truncate">{label}</span>
      </button>
      {status.message ? (
        <div className={cn('shrink-0 truncate text-center', status.tone === 'error' ? 'text-destructive' : 'opacity-70')} style={{ fontSize: 'clamp(11px,min(12cqh,3.6cqw),18px)' }} role="status">{status.message}</div>
      ) : null}
    </div>
  )
}
