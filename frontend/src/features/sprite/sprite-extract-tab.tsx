import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Download, Eye, Film, Locate, Settings2, Square } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SegmentedControl } from '@/components/common/segmented-control'
import { RuntimeJobProgress } from '@/components/common/runtime-job-progress'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useI18n } from '@/i18n'
import { triggerBrowserDownload } from '@/lib/api-client'
import { getErrorMessage } from '@/lib/error-message'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { useRuntimeJob } from '@/lib/use-runtime-job'
import {
  getSpriteBatchItems,
  getSpriteVideoInfo,
  libraryMediaFileUrl,
  saveSpriteBuild,
  spriteResultDownloadUrl,
  spriteVideoFrameUrl,
  startSpriteExtract,
  startSpriteExtractBatch,
  stopSpriteBatch,
  type SpriteBatchItem,
  type SpriteExtractBatchResult,
  type SpriteExtractOptions,
  type SpriteExtractResult,
  type SpriteGroupTarget,
  type SpriteRect,
} from '@/lib/api-sprite'
import { cn } from '@/lib/utils'
import { LibraryResults } from './sprite-library'
import { MAX_SPRITE_FRAMES, estimateFrameIndices, extractSignature, formFromOptions, normalizeHex, resolvedEndTime, resolvedStartTime, toExtractOptions, type ExtractForm, type OutputForm, type SaveForm } from './sprite-options'
import { SpritePresetMenu } from './sprite-presets'
import { SpriteQueue } from './sprite-queue'
import { SpriteResultPanel } from './sprite-result-panel'
import { SpriteSettingsPanel } from './sprite-settings-panel'
import { readStoredSpriteSettings, writeStoredSpriteSettings } from './sprite-storage'
import { MiniField } from './sprite-ui'
import { SpriteVideoSource, type SpriteVideoHandle } from './sprite-video-source'
import { useSpriteChatPage } from './use-sprite-chat-page'

type CenterView = 'video' | 'result'

function saveTarget(save: SaveForm): SpriteGroupTarget | true {
  return save.groupPath ? { groupPath: save.groupPath } : true
}

/**
 * Extract: one list of videos (one or many), one set of settings for all of them. A selected video can be previewed
 * on its own before the whole list runs; the run saves every sheet to the library and can also hand over a ZIP.
 */
export function SpriteExtractTab({ initialVideoHash, onVideoChange, toolbarSlot }: {
  initialVideoHash: string | null
  onVideoChange: (hash: string | null) => void
  /** Where the preset menu goes (the page toolbar, next to the tabs). */
  toolbarSlot: HTMLElement | null
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const { has } = useFeaturePermissions()
  const isWide = useDesktopPageLayout()
  const [stored] = useState(readStoredSpriteSettings)
  const [videoHashes, setVideoHashes] = useState<string[]>(initialVideoHash ? [initialVideoHash] : [])
  const [selectedHash, setSelectedHash] = useState<string | null>(initialVideoHash)
  const [form, setForm] = useState<ExtractForm>(stored.form)
  const [output, setOutput] = useState<OutputForm>(stored.output)
  const [save, setSave] = useState<SaveForm>(stored.save)
  const [presetId, setPresetId] = useState<string | null>(stored.presetId)
  const [view, setView] = useState<CenterView>('video')
  const [picking, setPicking] = useState(false)
  const [activeColor, setActiveColor] = useState(0)
  const [crop, setCrop] = useState<SpriteRect | null>(null)
  const [previewJobId, setPreviewJobId] = useState<string | null>(null)
  const [previewSignature, setPreviewSignature] = useState('')
  const [build, setBuild] = useState<SpriteExtractResult | null>(null)
  const [buildSignature, setBuildSignature] = useState('')
  const [batchJobId, setBatchJobId] = useState<string | null>(null)
  const [batchResult, setBatchResult] = useState<SpriteExtractBatchResult | null>(null)
  const [stopRequested, setStopRequested] = useState(false)
  const [showSummary, setShowSummary] = useState(false)
  const [starting, setStarting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedHashes, setSavedHashes] = useState<string[]>([])
  const videoRef = useRef<SpriteVideoHandle | null>(null)

  const selected = selectedHash && videoHashes.includes(selectedHash) ? selectedHash : videoHashes[0] ?? null
  const multiple = videoHashes.length > 1
  const infoQuery = useQuery({ queryKey: ['sprite-video-info', selected], queryFn: () => getSpriteVideoInfo(selected as string), enabled: Boolean(selected), retry: false, staleTime: 5 * 60_000 })
  const info = infoQuery.data ?? null

  useEffect(() => { if (initialVideoHash) { setVideoHashes((current) => current.includes(initialVideoHash) ? current : [initialVideoHash, ...current]); setSelectedHash(initialVideoHash) } }, [initialVideoHash])
  useEffect(() => { onVideoChange(selected) }, [selected, onVideoChange])
  useEffect(() => { writeStoredSpriteSettings({ form, output, save, presetId }) }, [form, output, save, presetId])
  // A size the user never set follows the selected video.
  useEffect(() => {
    if (info && (!form.outputWidth || !form.outputHeight)) setForm((current) => ({ ...current, outputWidth: current.outputWidth || info.width, outputHeight: current.outputHeight || info.height }))
  }, [info, form.outputWidth, form.outputHeight])

  const previewJob = useRuntimeJob<SpriteExtractResult>(previewJobId, {
    onCompleted: (completed) => {
      setPreviewJobId(null)
      setBuild(completed.result as SpriteExtractResult)
      setBuildSignature(previewSignature)
      setCrop(null)
      setView('result')
    },
    onFailed: (failed) => { setPreviewJobId(null); showSnackbar({ tone: 'error', message: failed.failureMessage ?? failed.message ?? t({ ko: '스프라이트를 만들지 못했어.', en: 'Could not build the sprites.' }) }) },
    onCancelled: () => setPreviewJobId(null),
  })

  const batchJob = useRuntimeJob<SpriteExtractBatchResult>(batchJobId, {
    onCompleted: (completed) => {
      const result = completed.result as SpriteExtractBatchResult
      setBatchJobId(null)
      setBatchResult(result)
      setSavedHashes(result.items.flatMap((item) => item.compositeHash ? [item.compositeHash] : []))
      if (result.zip) triggerBrowserDownload(spriteResultDownloadUrl(result.zip.workspaceId, result.zip.fileName))
      showSnackbar({
        tone: result.failed ? 'error' : 'info',
        message: t({ ko: '{done}개 저장 · {failed}개 실패{skipped}', en: '{done} saved · {failed} failed{skipped}' }, { done: result.succeeded, failed: result.failed, skipped: result.skipped ? t({ ko: ' · {count}개 건너뜀', en: ' · {count} skipped' }, { count: result.skipped }) : '' }),
      })
    },
    onFailed: (failed) => { setBatchJobId(null); showSnackbar({ tone: 'error', message: failed.failureMessage ?? failed.message ?? t({ ko: '일괄 생성이 실패했어.', en: 'The batch failed.' }) }) },
    onCancelled: () => setBatchJobId(null),
  })
  const liveItems = useQuery({
    queryKey: ['sprite-batch-items', batchJobId],
    queryFn: () => getSpriteBatchItems(batchJobId as string),
    enabled: Boolean(batchJobId),
    refetchInterval: 1000,
  })

  const statuses = useMemo(() => {
    const items: SpriteBatchItem[] = batchJobId ? liveItems.data?.items ?? videoHashes.map((videoHash) => ({ videoHash, status: 'waiting' as const })) : batchResult?.items ?? []
    return new Map(items.map((item) => [item.videoHash, item]))
  }, [batchJobId, liveItems.data, batchResult, videoHashes])

  const indices = useMemo(() => estimateFrameIndices(form, info), [form, info])
  const signature = extractSignature(selected, form)
  const stale = Boolean(build) && buildSignature !== signature
  const batchRunning = Boolean(batchJobId)
  const previewRunning = Boolean(previewJobId)
  const tooMany = indices.length > MAX_SPRITE_FRAMES
  const canEdit = has('images.edit')
  const canUpload = has('images.upload')
  const canPreview = canEdit && Boolean(info) && !tooMany && !previewRunning && !batchRunning && !starting
  const canRunAll = canEdit && canUpload && videoHashes.length > 0 && !batchRunning && !starting

  const preview = async () => {
    if (!selected) return
    setStarting(true)
    try {
      const record = await startSpriteExtract({ videoHash: selected, options: toExtractOptions(form, info, output) })
      setPreviewSignature(signature)
      setPreviewJobId(record.jobId)
    } catch (error) {
      showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '시작하지 못했어.', en: 'Could not start.' })) })
    } finally {
      setStarting(false)
    }
  }

  const runAll = async () => {
    setStarting(true)
    try {
      // Frame intervals differ per video; several videos always take seconds.
      const options = toExtractOptions(multiple ? { ...form, intervalUnit: 'seconds' } : form, info, output)
      const record = await startSpriteExtractBatch({ videoHashes, options, render: { columns: output.columns, spacing: output.spacing, format: output.format, quality: output.quality }, save: saveTarget(save), zip: save.zip })
      setBatchResult(null)
      setStopRequested(false)
      setShowSummary(true)
      setBatchJobId(record.jobId)
    } catch (error) {
      showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '시작하지 못했어.', en: 'Could not start.' })) })
    } finally {
      setStarting(false)
    }
  }

  const stopAfterCurrent = async () => {
    if (!batchJobId) return
    try {
      await stopSpriteBatch(batchJobId)
      setStopRequested(true)
    } catch (error) {
      showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '멈추지 못했어.', en: 'Could not stop.' })) })
    }
  }

  const saveBuild = async () => {
    if (!build) return
    setSaving(true)
    try {
      const saved = await saveSpriteBuild(build.buildId, { columns: output.columns, spacing: output.spacing, crop, format: output.format, quality: output.quality }, save.groupPath ? { groupPath: save.groupPath } : undefined)
      setSavedHashes((current) => [saved.compositeHash, ...current.filter((hash) => hash !== saved.compositeHash)])
      showSnackbar({ message: t({ ko: '"{group}" 그룹에 저장했어.', en: 'Saved to "{group}".' }, { group: save.groupPath ?? '스프라이트' }) })
    } catch (error) {
      showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })) })
    } finally {
      setSaving(false)
    }
  }

  const detectBackground = () => {
    const hex = videoRef.current?.detectBackground()
    const color = hex ? normalizeHex(hex) : null
    if (!color) { showSnackbar({ tone: 'error', message: t({ ko: '이 화면에서는 색을 읽을 수 없어.', en: 'The colour cannot be read here.' }) }); return }
    const index = form.despill ? 0 : activeColor
    setForm((current) => ({ ...current, keyColors: current.keyColors.map((value, position) => position === index ? color : value) }))
    setPresetId(null)
  }

  const applyStored = useCallback((options: Partial<SpriteExtractOptions>, nextSave: SaveForm | null) => {
    const restored = formFromOptions(options, info)
    setForm(restored.form)
    setOutput(restored.output)
    if (nextSave) setSave(nextSave)
    setActiveColor(0)
  }, [info])

  useSpriteChatPage({ videoHash: selected, videos: videoHashes, selectVideo: setSelectedHash, info, form, setForm, output, build })

  const selectedItem = selected ? statuses.get(selected) : undefined
  // Sheets appear in the summary as each video finishes, not only at the end.
  const runSaved = batchRunning ? [...statuses.values()].flatMap((item) => item.status === 'done' && item.compositeHash ? [item.compositeHash] : []) : savedHashes
  const progress = batchJob.job?.progress
  const summary = [
    form.samplingMode === 'count' ? t({ ko: '각 {count}컷', en: '{count} frames each' }, { count: form.sampleCount }) : `${form.intervalValue}${multiple || form.intervalUnit === 'seconds' ? 's' : 'f'}`,
    output.columns > 0 ? t({ ko: '{count}열', en: '{count} cols' }, { count: output.columns }) : t({ ko: '열 자동', en: 'auto cols' }),
    form.keyColors.join(' '),
    `${output.format.toUpperCase()}${save.zip ? ' + ZIP' : ''}`,
  ].join(' · ')

  const queue = (
    <SpriteQueue
      hashes={videoHashes}
      selected={selected}
      statuses={statuses}
      locked={batchRunning}
      onSelect={(hash) => { setSelectedHash(hash); setPicking(false); const item = statuses.get(hash); setView(item?.status === 'done' ? 'result' : 'video') }}
      onChange={(next) => { setVideoHashes(next); if (!next.includes(selected ?? '')) setSelectedHash(next[0] ?? null); setBatchResult(null) }}
    />
  )

  const center = (
    <section aria-label={t({ ko: '미리보기', en: 'Preview' })} className="flex min-w-0 flex-col gap-3">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm text-muted-foreground">{info?.name ?? ''}</span>
        <SegmentedControl
          size="sm"
          semantics="tabs"
          value={view}
          onChange={(next) => setView(next as CenterView)}
          items={[{ value: 'video', label: t({ ko: '영상', en: 'Video' }) }, { value: 'result', label: t({ ko: '결과', en: 'Result' }) }]}
          ariaLabel={t({ ko: '보기', en: 'View' })}
        />
      </div>
      {previewRunning ? <RuntimeJobProgress job={previewJob.job} cancel={previewJob.cancel} isCancelling={previewJob.isCancelling} /> : null}
      {view === 'video' ? (
        selected && info ? (
          <>
            <SpriteVideoSource
              ref={videoRef}
              src={libraryMediaFileUrl(selected)}
              frameUrl={(time) => spriteVideoFrameUrl(selected, time, Math.max(info.width, info.height))}
              info={info}
              rangeStart={resolvedStartTime(form)}
              rangeEnd={resolvedEndTime(form, info)}
              picking={picking}
              onPick={(hex) => {
                setPicking(false)
                const color = normalizeHex(hex)
                if (!color) { showSnackbar({ tone: 'error', message: t({ ko: '이 화면에서는 색을 읽을 수 없어.', en: 'The colour cannot be read here.' }) }); return }
                const index = form.despill ? 0 : activeColor
                setForm((current) => ({ ...current, keyColors: current.keyColors.map((value, position) => position === index ? color : value) }))
                setPresetId(null)
              }}
              preCrop={form.preCrop}
              onPreCropChange={(rect) => setForm((current) => ({ ...current, preCrop: rect }))}
            />
            <RangeControls form={form} setForm={(next) => { setForm(next); setPresetId(null) }} frameCount={indices.length} tooMany={tooMany} currentTime={() => Number((videoRef.current?.currentTime() ?? 0).toFixed(3))} maxTime={info.lastFrameTime} />
          </>
        ) : (
          <div className="flex h-40 items-center justify-center rounded-sm bg-surface-low text-muted-foreground">
            {infoQuery.isError ? <span role="alert" className="px-4 text-center text-sm text-destructive">{getErrorMessage(infoQuery.error, t({ ko: '영상을 읽지 못했어.', en: 'Could not read the video.' }))}</span> : <Film className="size-8 opacity-40" />}
          </div>
        )
      ) : build && build.videoHash === selected ? (
        <SpriteResultPanel build={build} output={output} onOutputChange={setOutput} crop={crop} onCropChange={setCrop} stale={stale} saving={saving} canSave={canUpload} onSave={() => void saveBuild()} />
      ) : selectedItem?.status === 'done' && selectedItem.compositeHash ? (
        <div className="flex flex-col gap-2">
          <div className="bg-checker flex h-[min(60vh,560px)] items-center justify-center overflow-auto rounded-sm p-3">
            <img src={libraryMediaFileUrl(selectedItem.compositeHash)} alt={t({ ko: '저장된 시트', en: 'Saved sheet' })} className="max-h-full max-w-full object-contain" />
          </div>
          <Tip content={[selectedItem.sheet ? `${selectedItem.sheet.width}×${selectedItem.sheet.height}` : null, save.groupPath ?? '스프라이트'].filter(Boolean).join(' · ')}>
            <span className="self-start font-mono text-xs text-muted-foreground" tabIndex={0}>
              {t({ ko: '{count}컷', en: '{count} frames' }, { count: selectedItem.frameCount ?? 0 })}
            </span>
          </Tip>
        </div>
      ) : (
        <div className="bg-checker flex h-40 items-center justify-center rounded-sm">
          <Film className="size-8 text-muted-foreground opacity-30" />
        </div>
      )}
    </section>
  )

  const right = showSummary && (batchRunning || batchResult) ? (
    <RunSummary form={form} output={output} save={save} multiple={multiple} savedHashes={runSaved} canClose={!batchRunning} onClose={() => setShowSummary(false)} />
  ) : (
    <SpriteSettingsPanel
      form={form}
      setForm={(next) => { setForm(next); setPresetId(null) }}
      output={output}
      setOutput={(next) => { setOutput(next); setPresetId(null) }}
      save={save}
      setSave={(next) => { setSave(next); setPresetId(null) }}
      info={info}
      multiple={multiple}
      picking={picking}
      onPickingChange={(next) => { setPicking(next); if (next) setView('video') }}
      activeColor={activeColor}
      onActiveColorChange={setActiveColor}
      onDetectBackground={detectBackground}
      canSave={canUpload}
    />
  )

  return (
    <div className="flex flex-col">
      {toolbarSlot ? createPortal(
        <SpritePresetMenu
          activeId={presetId}
          current={() => ({ options: toExtractOptions(multiple ? { ...form, intervalUnit: 'seconds' } : form, info, output), save })}
          onApply={applyStored}
          onActiveChange={setPresetId}
        />,
        toolbarSlot,
      ) : null}
      {isWide ? (
        <div className="grid grid-cols-[minmax(230px,280px)_minmax(0,1fr)_minmax(300px,360px)] items-start gap-7">{queue}{center}{right}</div>
      ) : (
        <div className="flex flex-col gap-6">{queue}{center}{right}</div>
      )}

      <div className="sticky bottom-3 z-sticky mt-4 flex flex-wrap items-center gap-3 rounded-md bg-surface-container/95 p-1.5 pl-3 shadow-elevation-3 backdrop-blur-md">
        {batchRunning ? (
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <span className="whitespace-nowrap font-mono text-xs">
              {t({ ko: '{done} / {total} 완료', en: '{done} / {total} done' }, { done: [...statuses.values()].filter((item) => item.status === 'done').length, total: videoHashes.length })}
              {[...statuses.values()].some((item) => item.status === 'failed') ? t({ ko: ' · {count} 실패', en: ' · {count} failed' }, { count: [...statuses.values()].filter((item) => item.status === 'failed').length }) : ''}
            </span>
            <span className="relative h-1 min-w-16 max-w-80 flex-1 rounded-full bg-surface-highest">
              <span className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width]" style={{ width: `${progress?.total ? Math.round((progress.processed / progress.total) * 100) : 0}%` }} />
            </span>
          </span>
        ) : (
          <span className="min-w-0 flex-1">
            <Tip content={summary}>
              <span className="font-mono text-xs text-muted-foreground" tabIndex={0}>{t({ ko: '영상 {count}', en: '{count} videos' }, { count: videoHashes.length })}</span>
            </Tip>
          </span>
        )}
        {batchRunning ? (
          <IconButton variant="secondary" disabled={stopRequested} onClick={() => void stopAfterCurrent()} label={stopRequested ? t({ ko: '멈추는 중', en: 'Stopping' }) : t({ ko: '지금 영상 끝나고 멈추기', en: 'Stop after this video' })}>
            <Square />
          </IconButton>
        ) : (
          <>
            {batchResult?.zip ? (
              <IconButton variant="secondary" label={t({ ko: 'ZIP 다시 받기', en: 'Download the ZIP again' })} onClick={() => triggerBrowserDownload(spriteResultDownloadUrl(batchResult.zip!.workspaceId, batchResult.zip!.fileName))}><Download /></IconButton>
            ) : null}
            <IconButton variant="secondary" disabled={!canPreview} onClick={() => void preview()} label={t({ ko: '이 영상만 미리보기: 저장 없이 결과만 만들어봐', en: 'Preview this video: build without saving' })}><Eye /></IconButton>
            <IconButton variant="default" disabled={!canRunAll} onClick={() => void runAll()} label={t({ ko: '전체 생성 · {count}', en: 'Build all · {count}' }, { count: videoHashes.length })}>
              <Film />
            </IconButton>
          </>
        )}
      </div>
    </div>
  )
}

/** Range under the player: the whole video, or the same start/end seconds for every video. */
function RangeControls({ form, setForm, frameCount, tooMany, currentTime, maxTime }: {
  form: ExtractForm
  setForm: (next: ExtractForm) => void
  frameCount: number
  tooMany: boolean
  currentTime: () => number
  maxTime: number
}) {
  const { t } = useI18n()
  const update = (patch: Partial<ExtractForm>) => setForm({ ...form, ...patch })
  return (
    <div className="flex flex-col gap-3 pt-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl size="sm" value={form.rangeMode} onChange={(mode) => update({ rangeMode: mode as ExtractForm['rangeMode'] })} items={[{ value: 'full', label: t({ ko: '영상 전체', en: 'Whole video' }) }, { value: 'common', label: t({ ko: '공통 구간', en: 'Same range' }) }]} ariaLabel={t({ ko: '구간', en: 'Range' })} />
        <Tip content={t({ ko: '이 영상에서 뽑힐 예상 컷 수', en: 'Estimated frames from this video' })}>
          <span className={cn('font-mono text-xs', tooMany ? 'text-destructive' : 'text-muted-foreground')} tabIndex={0}>{t({ ko: '~{count}컷', en: '~{count} frames' }, { count: frameCount })}</span>
        </Tip>
      </div>
      {form.rangeMode === 'common' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <MiniField label={t({ ko: '시작 (초)', en: 'Start (s)' })}>
            <div className="flex items-center gap-1">
              <NumberStepperInput value={form.startTime} min={0} max={maxTime} step={0.001} onValueCommit={(value) => update({ startTime: Math.max(0, Number(value) || 0) })} />
              <IconButton variant="ghost" size="icon-sm" label={t({ ko: '현재 재생 위치 사용', en: 'Use current position' })} onClick={() => update({ startTime: currentTime() })}><Locate /></IconButton>
            </div>
          </MiniField>
          <MiniField label={t({ ko: '끝 (초)', en: 'End (s)' })}>
            <div className="flex items-center gap-1">
              <NumberStepperInput value={form.endTime ?? ''} placeholder={t({ ko: '끝까지', en: 'To the end' })} min={0} max={maxTime} step={0.001} onValueCommit={(value) => update({ endTime: value === '' ? null : Number(value) })} />
              <IconButton variant="ghost" size="icon-sm" label={t({ ko: '현재 재생 위치 사용', en: 'Use current position' })} onClick={() => update({ endTime: currentTime() })}><Locate /></IconButton>
            </div>
          </MiniField>
        </div>
      ) : null}
      {tooMany ? <div role="alert" className="text-xs text-destructive">{t({ ko: '프레임은 {max}개까지야. 간격을 늘리거나 구간을 줄여.', en: 'Up to {max} frames. Widen the interval or shorten the range.' }, { max: MAX_SPRITE_FRAMES })}</div> : null}
    </div>
  )
}

/** While (and after) the whole list runs: what this run uses, and the sheets saved so far. */
function RunSummary({ form, output, save, multiple, savedHashes, canClose, onClose }: {
  form: ExtractForm
  output: OutputForm
  save: SaveForm
  multiple: boolean
  savedHashes: string[]
  canClose: boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  const rows: Array<[string, string]> = [
    [t({ ko: '추출', en: 'Frames' }), form.samplingMode === 'count' ? t({ ko: '영상마다 {count}컷', en: '{count} per video' }, { count: form.sampleCount }) : `${form.intervalValue}${multiple || form.intervalUnit === 'seconds' ? 's' : 'f'}`],
    [t({ ko: '구간', en: 'Range' }), form.rangeMode === 'full' ? t({ ko: '영상 전체', en: 'Whole video' }) : `${form.startTime}s – ${form.endTime ?? t({ ko: '끝', en: 'end' })}`],
    [t({ ko: '배경', en: 'Background' }), `${form.keyColors.join(' ')} · ${Math.round(form.tolerancePercent)}% / ${Math.round(form.softnessPercent)}%${form.despill ? t({ ko: ' · 디스필', en: ' · despill' }) : ''}`],
    [t({ ko: '시트', en: 'Sheet' }), `${output.columns > 0 ? t({ ko: '{count}열', en: '{count} cols' }, { count: output.columns }) : t({ ko: '열 자동', en: 'auto cols' })} · ${output.spacing}px · ${output.format.toUpperCase()}`],
    [t({ ko: '저장', en: 'Saved to' }), `${save.groupPath ?? '스프라이트'}${save.zip ? ' + ZIP' : ''}`],
  ]
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-h-8 items-center justify-between gap-2 pb-2">
        <h2 className="text-sm font-semibold">{t({ ko: '이번 생성', en: 'This run' })}</h2>
        {canClose ? <IconButton variant="ghost" size="icon-sm" label={t({ ko: '설정으로 돌아가기', en: 'Back to settings' })} onClick={onClose}><Settings2 /></IconButton> : null}
      </div>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 border-t border-line py-2 text-sm">
          <span className="shrink-0 text-muted-foreground">{label}</span>
          <span className="min-w-0 truncate text-right font-mono text-xs leading-5">{value}</span>
        </div>
      ))}
      {savedHashes.length ? (
        <>
          <h2 className="pb-2 pt-5 text-sm font-semibold">{t({ ko: '저장된 시트', en: 'Saved sheets' })}</h2>
          <LibraryResults hashes={savedHashes} />
        </>
      ) : null}
    </div>
  )
}
