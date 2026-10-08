import { useEffect, useRef, useState } from 'react'
import { Clapperboard, Download, Loader2, Pause, Play, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SegmentedControl } from '@/components/common/segmented-control'
import { RuntimeJobProgress } from '@/components/common/runtime-job-progress'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { getImageListDisplayName } from '@/features/images/components/image-list/image-list-utils'
import { useI18n } from '@/i18n'
import { triggerBrowserDownload } from '@/lib/api-client'
import { getImage } from '@/lib/api-images'
import { libraryMediaFileUrl, spriteResultDownloadUrl, startSpriteAnimation, type SpriteAnimationOptions, type SpriteAnimationResult } from '@/lib/api-sprite'
import { getErrorMessage } from '@/lib/error-message'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { useRuntimeJob } from '@/lib/use-runtime-job'
import { detectSheetGrid } from './sprite-grid-detect'
import { cellSize } from './sprite-options'
import { LibraryMediaButtons, LibraryResults } from './sprite-library'
import { MiniField, SliderLine, SpriteSection } from './sprite-ui'

interface SheetSource { hash: string; name: string; width: number; height: number }

export function SpriteAnimationTab() {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const { has } = useFeaturePermissions()
  const isWide = useDesktopPageLayout()
  const [sheet, setSheet] = useState<SheetSource | null>(null)
  const [options, setOptions] = useState<SpriteAnimationOptions>({ columns: 8, rows: 1, frameCount: 8, spacing: 0, fps: 12, outputFormat: 'webp', backgroundColor: '#000000' })
  const [jobId, setJobId] = useState<string | null>(null)
  const [saveRun, setSaveRun] = useState(true)
  const [savedHashes, setSavedHashes] = useState<string[]>([])
  const [starting, setStarting] = useState(false)

  const job = useRuntimeJob<SpriteAnimationResult>(jobId, {
    onCompleted: (completed) => {
      setJobId(null)
      const result = completed.result
      if (!result) return
      if (saveRun && result.saved) setSavedHashes((current) => [result.saved!.compositeHash, ...current])
      if (!saveRun) triggerBrowserDownload(spriteResultDownloadUrl(result.workspaceId, result.fileName))
    },
    onFailed: (failed) => { setJobId(null); showSnackbar({ tone: 'error', message: failed.failureMessage ?? failed.message ?? t({ ko: '애니메이션을 만들지 못했어.', en: 'Could not build the animation.' }) }) },
    onCancelled: () => setJobId(null),
  })

  const pick = async (hashes: string[]) => {
    const image = hashes[0] ? await getImage(hashes[0]).catch(() => null) : null
    if (!image?.composite_hash || !image.width || !image.height) return
    const grid = await detectSheetGrid(image.composite_hash, image.width, image.height)
    setSheet({ hash: image.composite_hash, name: getImageListDisplayName(image), width: image.width, height: image.height })
    setOptions((current) => ({ ...current, columns: grid.columns, rows: grid.rows, frameCount: grid.frameCount, spacing: 0 }))
  }

  const cell = sheet ? cellSize(sheet.width, sheet.height, options.columns, options.rows, options.spacing) : null
  const invalid = !sheet || !cell?.exact || options.frameCount < 1 || options.frameCount > options.columns * options.rows
  const running = Boolean(jobId) || starting
  const canRun = has('images.edit') && !invalid && !running

  const run = async (save: boolean) => {
    if (!sheet) return
    setStarting(true)
    setSaveRun(save)
    try {
      const record = await startSpriteAnimation({ sheetHash: sheet.hash, options, save: save ? true : null })
      setJobId(record.jobId)
    } catch (error) {
      showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '시작하지 못했어.', en: 'Could not start.' })) })
    } finally {
      setStarting(false)
    }
  }

  const left = (
    <div className="flex min-w-0 flex-col">
      <SpriteSection title={sheet?.name ?? t({ ko: '시트', en: 'Sheet' })} actions={<LibraryMediaButtons kind="image" maxCount={1} initialHashes={sheet ? [sheet.hash] : []} onPick={(hashes) => void pick(hashes)} />}>
        {sheet ? <div className="font-mono text-xs text-muted-foreground">{sheet.width}×{sheet.height}{cell ? ` · ${t({ ko: '셀', en: 'cell' })} ${Number(cell.cellWidth.toFixed(2))}×${Number(cell.cellHeight.toFixed(2))}` : ''}</div> : null}
        <div className="grid grid-cols-2 gap-2">
          <MiniField label={t({ ko: '열', en: 'Columns' })}><NumberStepperInput value={options.columns} min={1} max={64} step={1} onValueCommit={(value) => setOptions({ ...options, columns: Math.max(1, Number(value) || 1) })} /></MiniField>
          <MiniField label={t({ ko: '행', en: 'Rows' })}><NumberStepperInput value={options.rows} min={1} max={64} step={1} onValueCommit={(value) => setOptions({ ...options, rows: Math.max(1, Number(value) || 1) })} /></MiniField>
          <MiniField label={t({ ko: '프레임', en: 'Frames' })}><NumberStepperInput value={options.frameCount} min={1} max={256} step={1} onValueCommit={(value) => setOptions({ ...options, frameCount: Math.max(1, Number(value) || 1) })} /></MiniField>
          <MiniField label={t({ ko: '간격', en: 'Spacing' })}><NumberStepperInput value={options.spacing} min={0} max={64} step={1} onValueCommit={(value) => setOptions({ ...options, spacing: Math.max(0, Number(value) || 0) })} /></MiniField>
        </div>
        {sheet && invalid ? <div role="alert" className="text-xs text-warning">{t({ ko: '격자가 시트 크기와 맞지 않거나 프레임 수가 칸 수를 넘어.', en: 'The grid does not divide the sheet, or the frame count exceeds the cells.' })}</div> : null}
      </SpriteSection>
      <SpriteSection title={t({ ko: '출력', en: 'Output' })}>
        <SliderLine label="FPS" value={options.fps} min={1} max={60} onChange={(fps) => setOptions({ ...options, fps })} />
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl size="sm" value={options.outputFormat} onChange={(format) => setOptions({ ...options, outputFormat: format as SpriteAnimationOptions['outputFormat'] })} items={[{ value: 'gif', label: 'GIF' }, { value: 'webp', label: 'WebP' }, { value: 'mp4', label: 'MP4' }]} ariaLabel={t({ ko: '형식', en: 'Format' })} />
          {options.outputFormat === 'mp4' ? (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              {t({ ko: '배경', en: 'Background' })}
              <span className="relative size-7 overflow-hidden rounded-sm border border-line" style={{ background: options.backgroundColor }}>
                <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={options.backgroundColor} aria-label={t({ ko: '배경색', en: 'Background colour' })} onChange={(event) => setOptions({ ...options, backgroundColor: event.target.value.toUpperCase() })} />
              </span>
              <Input className="h-8 w-24 font-mono text-xs" value={options.backgroundColor} aria-label={t({ ko: '배경색 코드', en: 'Background colour code' })} onChange={(event) => setOptions({ ...options, backgroundColor: event.target.value })} />
            </label>
          ) : null}
        </div>
      </SpriteSection>
      <div className="sticky bottom-3 z-sticky mt-2 flex items-center gap-2 rounded-md bg-surface-container/95 p-1.5 pl-3 shadow-elevation-3 backdrop-blur-md">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{t({ ko: '{count}프레임', en: '{count} frames' }, { count: options.frameCount })} · {options.fps}fps · {options.outputFormat.toUpperCase()}</span>
        <IconButton variant="ghost" size="icon-sm" disabled={!canRun} label={t({ ko: '파일로 받기', en: 'Download file' })} onClick={() => void run(false)}><Download /></IconButton>
        <Button disabled={!canRun || !has('images.upload')} onClick={() => void run(true)}>
          {running ? <Loader2 className="animate-spin" /> : <Save />}
          {t({ ko: '라이브러리에 저장', en: 'Save to library' })}
        </Button>
      </div>
    </div>
  )

  const right = (
    <div className="flex min-w-0 flex-col gap-3">
      {jobId ? <RuntimeJobProgress job={job.job} cancel={job.cancel} isCancelling={job.isCancelling} /> : null}
      {sheet && cell?.exact ? <AnimationPreview sheet={sheet} options={options} cellWidth={cell.cellWidth} cellHeight={cell.cellHeight} /> : (
        <div className="bg-checker flex h-[min(48vh,380px)] items-center justify-center rounded-sm"><Clapperboard className="size-10 text-muted-foreground opacity-30" /></div>
      )}
      <LibraryResults hashes={savedHashes} />
    </div>
  )

  return isWide ? (
    <div className="grid grid-cols-[minmax(360px,4fr)_minmax(0,6fr)] items-start gap-8">{left}<div className="sticky top-[calc(var(--theme-shell-header-height)+1rem)]">{right}</div></div>
  ) : (
    <div className="flex flex-col gap-6">{left}{right}</div>
  )
}

/** Draw the sheet's cells in order on a canvas at the chosen FPS, the way the exported file will play. */
function AnimationPreview({ sheet, options, cellWidth, cellHeight }: { sheet: SheetSource; options: SpriteAnimationOptions; cellWidth: number; cellHeight: number }) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(true)

  useEffect(() => {
    setLoaded(false)
    const image = new Image()
    image.onload = () => { imageRef.current = image; setLoaded(true) }
    image.src = libraryMediaFileUrl(sheet.hash)
  }, [sheet.hash])

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => setFrame((current) => (current + 1) % Math.max(1, options.frameCount)), 1000 / options.fps)
    return () => window.clearInterval(timer)
  }, [playing, options.fps, options.frameCount])

  useEffect(() => {
    const canvas = canvasRef.current
    const image = imageRef.current
    if (!canvas || !image || !loaded) return
    const context = canvas.getContext('2d')
    if (!context) return
    const index = frame % Math.max(1, options.frameCount)
    const column = index % options.columns
    const row = Math.floor(index / options.columns)
    context.imageSmoothingEnabled = false
    context.clearRect(0, 0, canvas.width, canvas.height)
    if (options.outputFormat === 'mp4') { context.fillStyle = options.backgroundColor; context.fillRect(0, 0, canvas.width, canvas.height) }
    context.drawImage(image, column * (cellWidth + options.spacing), row * (cellHeight + options.spacing), cellWidth, cellHeight, 0, 0, cellWidth, cellHeight)
  }, [frame, loaded, options, cellWidth, cellHeight])

  return (
    <div className="flex flex-col gap-2">
      <div className="bg-checker flex h-[min(48vh,380px)] items-center justify-center overflow-hidden rounded-sm">
        <canvas ref={canvasRef} width={cellWidth} height={cellHeight} className="max-h-full max-w-full" style={{ height: Math.min(340, cellHeight * 4), imageRendering: 'pixelated', aspectRatio: `${cellWidth} / ${cellHeight}` }} />
      </div>
      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
        <IconButton size="icon-xs" variant="ghost" label={playing ? t({ ko: '일시정지', en: 'Pause' }) : t({ ko: '재생', en: 'Play' })} onClick={() => setPlaying(!playing)}>
          {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
        </IconButton>
        <input type="range" min={0} max={Math.max(0, options.frameCount - 1)} value={frame % Math.max(1, options.frameCount)} onChange={(event) => { setPlaying(false); setFrame(Number(event.target.value)) }} aria-label={t({ ko: '프레임 위치', en: 'Frame position' })} className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--primary)]" />
        <span className="tabular-nums">{(frame % Math.max(1, options.frameCount)) + 1} / {options.frameCount}</span>
      </div>
    </div>
  )
}
