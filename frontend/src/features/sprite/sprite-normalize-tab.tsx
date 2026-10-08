import { useState } from 'react'
import { CopyCheck, Download, LayoutGrid, Loader2, Save, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SegmentedControl } from '@/components/common/segmented-control'
import { RuntimeJobProgress } from '@/components/common/runtime-job-progress'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { getImageListDisplayName } from '@/features/images/components/image-list/image-list-utils'
import { useI18n } from '@/i18n'
import { triggerBrowserDownload } from '@/lib/api-client'
import { getImage } from '@/lib/api-images'
import { libraryMediaFileUrl, libraryThumbnailUrl, spriteResultDownloadUrl, startSpriteNormalize, type SpriteAnchorPolicy, type SpriteNormalizeOptions, type SpriteNormalizeResult, type SpriteNormalizeSheet } from '@/lib/api-sprite'
import { getErrorMessage } from '@/lib/error-message'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { useRuntimeJob } from '@/lib/use-runtime-job'
import { cn } from '@/lib/utils'
import { detectSheetGrid } from './sprite-grid-detect'
import { cellSize } from './sprite-options'
import { LibraryMediaButtons, LibraryResults } from './sprite-library'
import { MiniField, SliderLine, SpriteSection } from './sprite-ui'

interface SheetEntry {
  hash: string
  name: string
  width: number
  height: number
  options: SpriteNormalizeSheet['options']
}

const DEFAULT_OPTIONS: SpriteNormalizeOptions = { mode: 'per_sheet', alphaThreshold: 20, padding: 2, outputSpacing: 0, anchorPolicy: 'bottom_center', outputFormat: 'png', outputQuality: 90 }

function sheetProblem(sheet: SheetEntry) {
  const { columns, rows, frameCount, inputSpacing, customAnchorX, customAnchorY } = sheet.options
  const cell = cellSize(sheet.width, sheet.height, columns, rows, inputSpacing)
  return !cell.exact || frameCount < 1 || frameCount > columns * rows || columns * rows > 256
    || customAnchorX < 0 || customAnchorY < 0 || customAnchorX > cell.cellWidth || customAnchorY > cell.cellHeight
}

export function SpriteNormalizeTab() {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const { has } = useFeaturePermissions()
  const isWide = useDesktopPageLayout()
  const [sheets, setSheets] = useState<SheetEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [options, setOptions] = useState<SpriteNormalizeOptions>(DEFAULT_OPTIONS)
  const [jobId, setJobId] = useState<string | null>(null)
  const [saveRun, setSaveRun] = useState(true)
  const [savedHashes, setSavedHashes] = useState<string[]>([])
  const [failures, setFailures] = useState<SpriteNormalizeResult['failures']>([])
  const [starting, setStarting] = useState(false)

  const job = useRuntimeJob<SpriteNormalizeResult>(jobId, {
    onCompleted: (completed) => {
      setJobId(null)
      const result = completed.result
      if (!result) return
      setFailures(result.failures)
      if (saveRun) setSavedHashes(result.sheets.flatMap((sheet) => sheet.compositeHash ? [sheet.compositeHash] : []))
      else triggerBrowserDownload(spriteResultDownloadUrl(result.workspaceId))
    },
    onFailed: (failed) => { setJobId(null); showSnackbar({ tone: 'error', message: failed.failureMessage ?? failed.message ?? t({ ko: '정규화하지 못했어.', en: 'Normalization failed.' }) }) },
    onCancelled: () => setJobId(null),
  })

  const add = async (hashes: string[]) => {
    const records = await Promise.all(hashes.filter((hash) => !sheets.some((sheet) => sheet.hash === hash)).map((hash) => getImage(hash).catch(() => null)))
    const added = (await Promise.all(records.map(async (image): Promise<SheetEntry[]> => {
      if (!image?.composite_hash || !image.width || !image.height) return []
      const grid = await detectSheetGrid(image.composite_hash, image.width, image.height)
      const cell = cellSize(image.width, image.height, grid.columns, grid.rows, 0)
      return [{ hash: image.composite_hash, name: getImageListDisplayName(image), width: image.width, height: image.height, options: {
        columns: grid.columns, rows: grid.rows, frameCount: grid.frameCount, inputSpacing: 0, outputColumns: Math.min(grid.columns, grid.frameCount),
        readOrder: 'row_major', customAnchorX: Math.floor(cell.cellWidth / 2), customAnchorY: Math.floor(cell.cellHeight),
      } }]
    }))).flat()
    setSheets((current) => [...current, ...added])
    if (!selected && added[0]) setSelected(added[0].hash)
  }

  const current = sheets.find((sheet) => sheet.hash === selected) ?? null
  const updateSheet = (hash: string, patch: Partial<SheetEntry['options']>) => setSheets((list) => list.map((sheet) => sheet.hash === hash ? { ...sheet, options: { ...sheet.options, ...patch } } : sheet))
  const applyToSameSize = () => {
    if (!current) return
    setSheets((list) => list.map((sheet) => sheet.width === current.width && sheet.height === current.height ? { ...sheet, options: { ...current.options } } : sheet))
  }
  const problems = sheets.filter(sheetProblem).length
  const running = Boolean(jobId) || starting
  const canRun = has('images.edit') && sheets.length > 0 && problems === 0 && !running

  const run = async (save: boolean) => {
    setStarting(true)
    setSaveRun(save)
    try {
      const record = await startSpriteNormalize({ sheets: sheets.map((sheet) => ({ imageHash: sheet.hash, options: sheet.options })), options, save: save ? true : null })
      setJobId(record.jobId)
    } catch (error) {
      showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '시작하지 못했어.', en: 'Could not start.' })) })
    } finally {
      setStarting(false)
    }
  }

  const left = (
    <div className="flex min-w-0 flex-col">
      <SpriteSection
        title={t({ ko: '시트 {count}개', en: '{count} sheets' }, { count: sheets.length })}
        actions={<LibraryMediaButtons kind="image" maxCount={500} onPick={(hashes) => void add(hashes)} />}
      >
        <div className="flex flex-col">
          {sheets.map((sheet) => {
            const problem = sheetProblem(sheet)
            return (
              <ListRow
                key={sheet.hash}
                selected={sheet.hash === selected}
                className="px-2"
                trailing={<>
                  <span className={cn('rounded-sm px-1.5 py-0.5 text-xs font-semibold', problem ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success')}>{problem ? t({ ko: '확인', en: 'Check' }) : t({ ko: '준비', en: 'Ready' })}</span>
                  <IconButton size="icon-xs" variant="ghost" label={t({ ko: '빼기', en: 'Remove' })} onClick={() => { setSheets(sheets.filter((item) => item.hash !== sheet.hash)); if (selected === sheet.hash) setSelected(null) }}><X /></IconButton>
                </>}
              >
                <Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start gap-3 px-0 py-0.5 text-left font-normal hover:bg-transparent" onClick={() => setSelected(sheet.hash)}>
                  <span className="bg-checker size-9 shrink-0 overflow-hidden rounded-sm"><img src={libraryThumbnailUrl(sheet.hash)} alt="" loading="lazy" className="size-full object-contain" /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{sheet.name}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      {sheet.options.columns}×{sheet.options.rows} · {t({ ko: '{count}프레임', en: '{count} frames' }, { count: sheet.options.frameCount })} · {sheet.options.readOrder === 'row_major' ? t({ ko: '행 우선', en: 'rows first' }) : t({ ko: '열 우선', en: 'columns first' })}
                    </span>
                  </span>
                </Button>
              </ListRow>
            )
          })}
        </div>
      </SpriteSection>

      {current ? (
        <SpriteSection title={current.name} actions={<IconButton variant="ghost" size="icon-sm" label={t({ ko: '같은 크기 시트에 적용', en: 'Apply to sheets of the same size' })} onClick={applyToSameSize}><CopyCheck /></IconButton>}>
          <div className="grid grid-cols-2 gap-2">
            <MiniField label={t({ ko: '열', en: 'Columns' })}><NumberStepperInput value={current.options.columns} min={1} max={64} step={1} onValueCommit={(value) => updateSheet(current.hash, { columns: Math.max(1, Number(value) || 1) })} /></MiniField>
            <MiniField label={t({ ko: '행', en: 'Rows' })}><NumberStepperInput value={current.options.rows} min={1} max={64} step={1} onValueCommit={(value) => updateSheet(current.hash, { rows: Math.max(1, Number(value) || 1) })} /></MiniField>
            <MiniField label={t({ ko: '프레임', en: 'Frames' })}><NumberStepperInput value={current.options.frameCount} min={1} max={256} step={1} onValueCommit={(value) => updateSheet(current.hash, { frameCount: Math.max(1, Number(value) || 1) })} /></MiniField>
            <MiniField label={t({ ko: '입력 간격', en: 'Spacing' })}><NumberStepperInput value={current.options.inputSpacing} min={0} max={64} step={1} onValueCommit={(value) => updateSheet(current.hash, { inputSpacing: Math.max(0, Number(value) || 0) })} /></MiniField>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <SegmentedControl size="sm" value={current.options.readOrder} onChange={(order) => updateSheet(current.hash, { readOrder: order as SheetEntry['options']['readOrder'] })} items={[{ value: 'row_major', label: t({ ko: '행 우선', en: 'Rows first' }) }, { value: 'column_major', label: t({ ko: '열 우선', en: 'Columns first' }) }]} ariaLabel={t({ ko: '읽는 순서', en: 'Read order' })} />
            <MiniField label={t({ ko: '출력 열', en: 'Output columns' })} className="w-32"><NumberStepperInput value={current.options.outputColumns} min={1} max={current.options.frameCount} step={1} onValueCommit={(value) => updateSheet(current.hash, { outputColumns: Math.max(1, Number(value) || 1) })} /></MiniField>
            {options.anchorPolicy === 'custom' ? (
              <>
                <MiniField label={t({ ko: '기준점 X', en: 'Anchor X' })} className="w-32"><NumberStepperInput value={current.options.customAnchorX} min={0} step={1} onValueCommit={(value) => updateSheet(current.hash, { customAnchorX: Math.max(0, Number(value) || 0) })} /></MiniField>
                <MiniField label={t({ ko: '기준점 Y', en: 'Anchor Y' })} className="w-32"><NumberStepperInput value={current.options.customAnchorY} min={0} step={1} onValueCommit={(value) => updateSheet(current.hash, { customAnchorY: Math.max(0, Number(value) || 0) })} /></MiniField>
              </>
            ) : null}
          </div>
          {sheetProblem(current) ? <div role="alert" className="text-xs text-warning">{t({ ko: '격자가 이미지 크기와 맞지 않거나 프레임 수·기준점이 범위를 벗어났어.', en: 'The grid does not divide the image, or the frame count or anchor is out of range.' })}</div> : null}
        </SpriteSection>
      ) : null}

      <SpriteSection title={t({ ko: '정규화', en: 'Normalization' })}>
        <div className="flex flex-wrap gap-2">
          <SegmentedControl size="sm" value={options.mode} onChange={(mode) => setOptions({ ...options, mode: mode as SpriteNormalizeOptions['mode'] })} items={[{ value: 'per_sheet', label: t({ ko: '시트별', en: 'Per sheet' }) }, { value: 'group', label: t({ ko: '묶음 공통', en: 'Shared' }) }]} ariaLabel={t({ ko: '모드', en: 'Mode' })} />
          <SegmentedControl size="sm" value={options.anchorPolicy} onChange={(anchor) => setOptions({ ...options, anchorPolicy: anchor as SpriteAnchorPolicy })} items={[{ value: 'center', label: t({ ko: '가운데', en: 'Centre' }) }, { value: 'bottom_center', label: t({ ko: '아래 가운데', en: 'Bottom centre' }) }, { value: 'custom', label: t({ ko: '직접', en: 'Custom' }) }]} ariaLabel={t({ ko: '기준점', en: 'Anchor' })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MiniField label={t({ ko: '여백', en: 'Padding' })}><NumberStepperInput value={options.padding} min={0} max={512} step={1} onValueCommit={(value) => setOptions({ ...options, padding: Math.max(0, Number(value) || 0) })} /></MiniField>
          <MiniField label={t({ ko: '출력 간격', en: 'Out spacing' })}><NumberStepperInput value={options.outputSpacing} min={0} max={64} step={1} onValueCommit={(value) => setOptions({ ...options, outputSpacing: Math.max(0, Number(value) || 0) })} /></MiniField>
          <MiniField label={t({ ko: '알파 임계값', en: 'Alpha' })}><NumberStepperInput value={options.alphaThreshold} min={1} max={255} step={1} onValueCommit={(value) => setOptions({ ...options, alphaThreshold: Math.max(1, Math.min(255, Number(value) || 20)) })} /></MiniField>
          <MiniField label={t({ ko: '형식', en: 'Format' })}>
            <SegmentedControl size="xs" fullWidth value={options.outputFormat} onChange={(format) => setOptions({ ...options, outputFormat: format as SpriteNormalizeOptions['outputFormat'] })} items={[{ value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' }]} ariaLabel={t({ ko: '형식', en: 'Format' })} />
          </MiniField>
        </div>
        {options.outputFormat === 'webp' ? <SliderLine label={t({ ko: '품질', en: 'Quality' })} value={options.outputQuality} min={1} max={100} onChange={(quality) => setOptions({ ...options, outputQuality: quality })} /> : null}
      </SpriteSection>

      <div className="sticky bottom-3 z-sticky mt-2 flex items-center gap-2 rounded-md bg-surface-container/95 p-1.5 pl-3 shadow-elevation-3 backdrop-blur-md">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {problems ? t({ ko: '확인 필요 {count}개', en: '{count} need a check' }, { count: problems }) : t({ ko: '시트 {count}개', en: '{count} sheets' }, { count: sheets.length })}
        </span>
        <IconButton variant="ghost" size="icon-sm" disabled={!canRun} label={t({ ko: 'ZIP으로 받기', en: 'Download ZIP' })} onClick={() => void run(false)}><Download /></IconButton>
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
      <div className="bg-checker flex h-[min(48vh,380px)] items-center justify-center overflow-hidden rounded-sm">
        {current ? <GridPreview sheet={current} anchor={options.anchorPolicy} /> : <LayoutGrid className="size-10 text-muted-foreground opacity-30" />}
      </div>
      {current ? (
        <div className="font-mono text-xs text-muted-foreground">
          {(() => { const cell = cellSize(current.width, current.height, current.options.columns, current.options.rows, current.options.inputSpacing); return `${current.width}×${current.height} · ${t({ ko: '셀', en: 'cell' })} ${Number(cell.cellWidth.toFixed(2))}×${Number(cell.cellHeight.toFixed(2))}` })()}
        </div>
      ) : null}
      {failures.length ? <ul role="alert" className="flex flex-col gap-1 text-xs text-destructive">{failures.map((failure) => <li key={failure.source} className="truncate">{failure.source} · {failure.error}</li>)}</ul> : null}
      <LibraryResults hashes={savedHashes} />
    </div>
  )

  return isWide ? (
    <div className="grid grid-cols-[minmax(360px,4fr)_minmax(0,6fr)] items-start gap-8">{left}<div className="sticky top-[calc(var(--theme-shell-header-height)+1rem)]">{right}</div></div>
  ) : (
    <div className="flex flex-col gap-6">{left}{right}</div>
  )
}

/** The sheet with its cell grid (dashed) and each cell's input anchor, drawn over the real image. */
function GridPreview({ sheet, anchor }: { sheet: SheetEntry; anchor: SpriteAnchorPolicy }) {
  const { columns, rows, frameCount, inputSpacing, readOrder, customAnchorX, customAnchorY } = sheet.options
  const cell = cellSize(sheet.width, sheet.height, columns, rows, inputSpacing)
  const cells = Array.from({ length: Math.min(frameCount, columns * rows) }, (_, index) => {
    const column = readOrder === 'row_major' ? index % columns : Math.floor(index / rows)
    const row = readOrder === 'row_major' ? Math.floor(index / columns) : index % rows
    return { x: column * (cell.cellWidth + inputSpacing), y: row * (cell.cellHeight + inputSpacing) }
  })
  const anchorX = anchor === 'custom' ? customAnchorX : Math.floor(cell.cellWidth / 2)
  const anchorY = anchor === 'custom' ? customAnchorY : anchor === 'center' ? Math.floor(cell.cellHeight / 2) : cell.cellHeight
  const stroke = Math.max(1, sheet.width / 400)
  return (
    <svg viewBox={`0 0 ${sheet.width} ${sheet.height}`} className="max-h-full max-w-full" style={{ aspectRatio: `${sheet.width} / ${sheet.height}` }}>
      <image href={libraryMediaFileUrl(sheet.hash)} width={sheet.width} height={sheet.height} style={{ imageRendering: 'pixelated' }} />
      {cells.map((origin, index) => (
        <g key={index}>
          <rect x={origin.x} y={origin.y} width={cell.cellWidth} height={cell.cellHeight} fill="none" stroke="var(--primary)" strokeOpacity={0.7} strokeWidth={stroke} strokeDasharray={`${stroke * 3} ${stroke * 3}`} />
          <line x1={origin.x + anchorX} x2={origin.x + anchorX} y1={origin.y + anchorY - stroke * 4} y2={origin.y + anchorY} stroke="var(--foreground)" strokeWidth={stroke * 1.5} />
        </g>
      ))}
    </svg>
  )
}
