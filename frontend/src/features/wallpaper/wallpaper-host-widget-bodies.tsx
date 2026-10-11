import { useEffect, useRef, useState } from 'react'
import { Music, Play } from 'lucide-react'
import { useI18n } from '@/i18n'
import { runWallpaperQuickRun } from '@/lib/api-wallpaper-runtime'
import { cn } from '@/lib/utils'
import type { WallpaperWidgetInstance } from './wallpaper-types'
import { readWallpaperHostAudio, useWallpaperHostState, WALLPAPER_AUDIO_BINS, type WallpaperHostSystemInfo, type WallpaperHostTrack } from './wallpaper-host-bridge'
import { WallpaperWidgetNote } from './wallpaper-monitor-widget-bodies'
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

export function WallpaperAudioVisualizerBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'audio-visualizer' }> }) {
  const { mode } = useWallpaperDataEnvironment()
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

    return runWallpaperFrameLoop((now) => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (width <= 0 || height <= 0) return
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      // The accent can change with the theme or the background; re-read it about once a second.
      if (!color && now - paintCheckedAt > 1000) {
        paint = getComputedStyle(canvas).color
        paintCheckedAt = now
      }
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

  return <canvas ref={canvasRef} aria-hidden="true" className="block h-full w-full text-primary" style={color ? { color } : undefined} />
}

const SAMPLE_TRACK: WallpaperHostTrack = { title: 'Midnight Signal', artist: 'CoNAI', album: '', thumbnail: null }

export function WallpaperNowPlayingBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'now-playing' }> }) {
  const { t } = useI18n()
  const { mode } = useWallpaperDataEnvironment()
  const { track: hostTrack } = useWallpaperHostState()
  const track = hostTrack ?? (mode === 'editor' ? SAMPLE_TRACK : null)
  const { layout, showArt, hideWhenIdle } = widget.settings

  if (!track) {
    return hideWhenIdle ? null : <WallpaperWidgetNote>{t({ ko: '재생 중인 곡이 없어.', en: 'Nothing is playing.' })}</WallpaperWidgetNote>
  }

  const art = showArt ? (
    <div className={cn('shrink-0 overflow-hidden rounded-lg bg-[color-mix(in_srgb,var(--primary)_28%,transparent)]', layout === 'stack' ? 'aspect-square w-full max-w-[min(100%,60cqh)]' : 'aspect-square h-full max-h-[96cqh]')}>
      {track.thumbnail ? (
        <img src={track.thumbnail} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="flex h-full w-full items-center justify-center"><Music className="size-[40%] opacity-70" /></div>
      )}
    </div>
  ) : null

  return (
    <div className={cn('flex h-full min-w-0', layout === 'stack' ? 'flex-col items-start justify-end gap-2' : 'items-center gap-3')}>
      {art}
      <div className="min-w-0 flex-1 self-stretch">
        <div className="flex h-full min-w-0 flex-col justify-center">
          <div className="truncate text-base font-semibold">{track.title || t({ ko: '알 수 없는 곡', en: 'Unknown track' })}</div>
          {track.artist ? <div className="truncate text-sm opacity-70">{track.artist}</div> : null}
          {track.album ? <div className="truncate text-xs opacity-50">{track.album}</div> : null}
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
  if (display === 'rings') {
    return (
      <div className="flex h-full flex-wrap content-center items-center justify-around gap-3">
        {meters.map((meter) => (
          <div key={meter.key} className="flex min-w-0 flex-col items-center gap-1">
            <svg viewBox="0 0 36 36" className="size-[min(56cqh,88px)]" aria-hidden="true">
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
                className="transition-[stroke-dasharray] duration-700"
              />
              <text x="18" y="21" textAnchor="middle" fontSize="9" className="fill-current font-semibold tabular-nums">{Math.round(meter.ratio * 100)}</text>
            </svg>
            <div className="max-w-24 truncate text-2xs opacity-70">{meter.label}</div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col justify-center gap-2.5">
      {meters.map((meter) => (
        <div key={meter.key} className="min-w-0">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate opacity-75">{meter.label}</span>
            <span className="shrink-0 tabular-nums opacity-60">{meter.detail}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,currentColor_14%,transparent)]">
            <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${Math.round(Math.max(0, Math.min(1, meter.ratio)) * 100)}%` }} />
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
          <div className="flex shrink-0 justify-between gap-2 text-2xs tabular-nums opacity-65">
            <span>↓ {formatRate(system.netDown)}</span>
            <span>↑ {formatRate(system.netUp)}</span>
          </div>
        ) : null}
      </div>
    )
  }

  if (comfyQuery.isError) return <WallpaperWidgetNote>{t({ ko: 'ComfyUI 상태는 관리자만 볼 수 있어.', en: 'ComfyUI stats are for administrators.' })}</WallpaperWidgetNote>
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
  const [status, setStatus] = useState<{ tone: 'idle' | 'busy' | 'ok' | 'error'; message: string }>({ tone: 'idle', message: '' })
  const label = widget.settings.label.trim() || widget.settings.scheduleName || t({ ko: '실행', en: 'Run' })

  useEffect(() => {
    if (status.tone !== 'ok' && status.tone !== 'error') return undefined
    const timer = window.setTimeout(() => setStatus({ tone: 'idle', message: '' }), 6000)
    return () => window.clearTimeout(timer)
  }, [status.tone])

  if (widget.settings.scheduleId === null) return <WallpaperWidgetNote>{t({ ko: '설정에서 실행할 예약을 골라줘.', en: 'Pick a schedule to run in settings.' })}</WallpaperWidgetNote>

  const press = async () => {
    if (mode !== 'runtime' || status.tone === 'busy') return
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
      setStatus({ tone: 'error', message: error instanceof Error ? error.message : t({ ko: '실행하지 못했어.', en: 'Could not run it.' }) })
    }
  }

  return (
    <div className="flex h-full flex-col items-stretch justify-center gap-1.5">
      {/* eslint-disable-next-line no-restricted-syntax -- wallpaper action button sized by the widget frame */}
      <button
        type="button"
        onClick={() => void press()}
        disabled={status.tone === 'busy'}
        className="flex min-h-0 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
      >
        <Play className="size-[1.1em] shrink-0" />
        <span className="truncate">{label}</span>
      </button>
      {status.message ? (
        <div className={cn('shrink-0 truncate text-center text-xs', status.tone === 'error' ? 'text-destructive' : 'opacity-70')} role="status">{status.message}</div>
      ) : null}
    </div>
  )
}
