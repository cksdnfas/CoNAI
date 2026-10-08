import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Film, Locate, Pipette, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SegmentedControl } from '@/components/common/segmented-control'
import { RuntimeJobProgress } from '@/components/common/runtime-job-progress'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useI18n } from '@/i18n'
import { getErrorMessage } from '@/lib/error-message'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { useRuntimeJob } from '@/lib/use-runtime-job'
import { getSpriteVideoInfo, libraryMediaFileUrl, libraryThumbnailUrl, saveSpriteBuild, startSpriteExtract, startSpriteExtractBatch, type SpriteExtractBatchResult, type SpriteExtractResult, type SpriteRect } from '@/lib/api-sprite'
import { cn } from '@/lib/utils'
import { LibraryMediaButtons, LibraryResults } from './sprite-library'
import { DEFAULT_OUTPUT, MAX_KEY_COLORS, MAX_SPRITE_FRAMES, defaultExtractForm, estimateFrameIndices, extractSignature, normalizeHex, resolvedEndTime, toExtractOptions, withDespill, type ExtractForm, type OutputForm } from './sprite-options'
import { HexInput, SpriteResultPanel } from './sprite-result-panel'
import { MiniField, SliderLine, SpriteSection, SwitchLine } from './sprite-ui'
import { SpriteVideoSource, type SpriteVideoHandle } from './sprite-video-source'
import { useSpriteChatPage } from './use-sprite-chat-page'

export function SpriteExtractTab({ initialVideoHash, onVideoChange }: { initialVideoHash: string | null; onVideoChange: (hash: string | null) => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const { has } = useFeaturePermissions()
  const isWide = useDesktopPageLayout()
  const [videoHashes, setVideoHashes] = useState<string[]>(initialVideoHash ? [initialVideoHash] : [])
  const videoHash = videoHashes.length === 1 ? videoHashes[0] : null
  const batch = videoHashes.length > 1
  const infoQuery = useQuery({ queryKey: ['sprite-video-info', videoHash], queryFn: () => getSpriteVideoInfo(videoHash as string), enabled: Boolean(videoHash), retry: false })
  const info = infoQuery.data ?? null
  const [form, setForm] = useState<ExtractForm>(() => defaultExtractForm(null))
  const [output, setOutput] = useState<OutputForm>(DEFAULT_OUTPUT)
  const [crop, setCrop] = useState<SpriteRect | null>(null)
  const [picking, setPicking] = useState(false)
  const [activeColor, setActiveColor] = useState(0)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobKind, setJobKind] = useState<'single' | 'batch'>('single')
  const [jobSignature, setJobSignature] = useState('')
  const [build, setBuild] = useState<SpriteExtractResult | null>(null)
  const [buildSignature, setBuildSignature] = useState('')
  const [batchResult, setBatchResult] = useState<SpriteExtractBatchResult | null>(null)
  const [starting, setStarting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedHashes, setSavedHashes] = useState<string[]>([])
  const videoRef = useRef<SpriteVideoHandle | null>(null)

  useEffect(() => { if (initialVideoHash) setVideoHashes([initialVideoHash]) }, [initialVideoHash])
  useEffect(() => { onVideoChange(videoHash) }, [videoHash, onVideoChange])

  // A new video resets what depends on its length and size; key colour and clean-up choices stay.
  const infoKey = info ? `${info.compositeHash}` : null
  useEffect(() => {
    if (!info) return
    const fresh = defaultExtractForm(info)
    setForm((current) => ({ ...current, startTime: 0, endTime: null, intervalValue: fresh.intervalValue, sampleCount: fresh.sampleCount, preCrop: null, outputWidth: info.width, outputHeight: info.height }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infoKey])

  const job = useRuntimeJob<SpriteExtractResult | SpriteExtractBatchResult>(jobId, {
    onCompleted: (completed) => {
      setJobId(null)
      if (jobKind === 'batch') {
        const result = completed.result as SpriteExtractBatchResult
        setBatchResult(result)
        setSavedHashes(result.items.flatMap((item) => item.compositeHash ? [item.compositeHash] : []))
        if (result.failed) showSnackbar({ tone: 'error', message: t({ ko: '{count}개 영상은 실패했어.', en: '{count} videos failed.' }, { count: result.failed }) })
        return
      }
      setBuild(completed.result as SpriteExtractResult)
      setBuildSignature(jobSignature)
      setCrop(null)
    },
    onFailed: (failed) => { setJobId(null); showSnackbar({ tone: 'error', message: failed.failureMessage ?? failed.message ?? t({ ko: '스프라이트를 만들지 못했어.', en: 'Could not build the sprites.' }) }) },
    onCancelled: () => setJobId(null),
  })

  const update = (patch: Partial<ExtractForm>) => setForm((current) => ({ ...current, ...patch }))
  const indices = useMemo(() => estimateFrameIndices(form, info), [form, info])
  const endTime = resolvedEndTime(form, info)
  const signature = extractSignature(videoHash, form)
  const stale = Boolean(build) && buildSignature !== signature
  const tooMany = !batch && indices.length > MAX_SPRITE_FRAMES
  const running = Boolean(jobId) || starting
  const canRun = has('images.edit') && (batch ? true : Boolean(info)) && !tooMany && !running && (!batch || has('images.upload'))

  const run = async () => {
    setStarting(true)
    try {
      if (batch) {
        const options = toExtractOptions({ ...form, intervalUnit: 'seconds' }, null, output)
        const record = await startSpriteExtractBatch({ videoHashes, options, save: true })
        setJobKind('batch')
        setBatchResult(null)
        setJobId(record.jobId)
      } else if (videoHash) {
        const record = await startSpriteExtract({ videoHash, options: toExtractOptions(form, info, output) })
        setJobKind('single')
        setJobSignature(signature)
        setJobId(record.jobId)
      }
    } catch (error) {
      showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '시작하지 못했어.', en: 'Could not start.' })) })
    } finally {
      setStarting(false)
    }
  }

  const save = async () => {
    if (!build) return
    setSaving(true)
    try {
      const saved = await saveSpriteBuild(build.buildId, { columns: output.columns, spacing: output.spacing, crop, format: output.format, quality: output.quality })
      setSavedHashes((current) => [saved.compositeHash, ...current.filter((hash) => hash !== saved.compositeHash)])
      showSnackbar({ message: t({ ko: '"스프라이트" 그룹에 저장했어.', en: 'Saved to the "스프라이트" group.' }) })
    } catch (error) {
      showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })) })
    } finally {
      setSaving(false)
    }
  }

  const setColor = (index: number, value: string) => {
    const hex = normalizeHex(value)
    if (!hex) return
    update({ keyColors: form.keyColors.map((color, position) => position === index ? hex : color) })
  }

  useSpriteChatPage({ videoHash, info, form, setForm, output, build })

  const summary = batch
    ? t({ ko: '영상 {count}개 · 지정색{despill}', en: '{count} videos · key colour{despill}' }, { count: videoHashes.length, despill: form.despill ? t({ ko: ' + 디스필', en: ' + despill' }) : '' })
    : t({ ko: '{count}프레임 · 지정색{despill}', en: '{count} frames · key colour{despill}' }, { count: indices.length, despill: form.despill ? t({ ko: ' + 디스필', en: ' + despill' }) : '' })

  const left = (
    <div className="flex min-w-0 flex-col">
      <SpriteSection
        title={t({ ko: '영상', en: 'Video' })}
        actions={<LibraryMediaButtons kind="video" maxCount={100} initialHashes={videoHashes} onPick={(hashes) => { setVideoHashes(hashes); setBuild(null); setBatchResult(null); setSavedHashes([]) }} />}
      >
        {videoHash && info ? (
          <SpriteVideoSource
            ref={videoRef}
            src={libraryMediaFileUrl(videoHash)}
            info={info}
            rangeStart={form.startTime}
            rangeEnd={endTime}
            picking={picking}
            onPick={(hex) => {
              setPicking(false)
              if (!hex) { showSnackbar({ tone: 'error', message: t({ ko: '이 화면에서는 색을 읽을 수 없어.', en: 'The colour cannot be read here.' }) }); return }
              setColor(form.despill ? 0 : activeColor, hex)
            }}
            preCrop={form.preCrop}
            onPreCropChange={(rect) => update({ preCrop: rect })}
          />
        ) : batch ? (
          <div className="flex flex-wrap gap-1.5">
            {videoHashes.map((hash) => (
              <div key={hash} className="group relative size-16 overflow-hidden rounded-sm bg-surface-low">
                <img src={libraryThumbnailUrl(hash)} alt="" loading="lazy" className="size-full object-cover" />
                <IconButton size="icon-xs" variant="secondary" className="absolute right-0.5 top-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" label={t({ ko: '빼기', en: 'Remove' })} onClick={() => setVideoHashes(videoHashes.filter((item) => item !== hash))}><X /></IconButton>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex aspect-[16/10] items-center justify-center rounded-sm bg-surface-low text-muted-foreground">
            {infoQuery.isError ? <span role="alert" className="px-4 text-center text-sm text-destructive">{getErrorMessage(infoQuery.error, t({ ko: '영상을 읽지 못했어.', en: 'Could not read the video.' }))}</span> : <Film className="size-8 opacity-40" />}
          </div>
        )}
      </SpriteSection>

      <SpriteSection title={t({ ko: '구간', en: 'Range' })} actions={!batch && info ? <span className="rounded-sm bg-fill px-2 py-0.5 text-xs font-semibold text-muted-foreground">{t({ ko: '예상 {count}프레임', en: '~{count} frames' }, { count: indices.length })}</span> : undefined}>
        <div className="grid gap-3 sm:grid-cols-2">
          <MiniField label={t({ ko: '시작 (초)', en: 'Start (s)' })}>
            <div className="flex items-center gap-1">
              <NumberStepperInput value={form.startTime} min={0} max={info?.lastFrameTime} step={0.001} onValueCommit={(value) => update({ startTime: Math.max(0, Number(value) || 0) })} />
              {!batch ? <IconButton variant="ghost" size="icon-sm" disabled={!info} label={t({ ko: '현재 재생 위치 사용', en: 'Use current position' })} onClick={() => update({ startTime: Number((videoRef.current?.currentTime() ?? 0).toFixed(3)) })}><Locate /></IconButton> : null}
            </div>
          </MiniField>
          <MiniField label={t({ ko: '끝 (초)', en: 'End (s)' })}>
            <div className="flex items-center gap-1">
              <NumberStepperInput value={form.endTime ?? (batch ? '' : Number(endTime.toFixed(3)))} placeholder={batch ? t({ ko: '끝까지', en: 'To the end' }) : undefined} min={0} max={info?.lastFrameTime} step={0.001} onValueCommit={(value) => update({ endTime: value === '' ? null : Number(value) })} />
              {!batch ? <IconButton variant="ghost" size="icon-sm" disabled={!info} label={t({ ko: '현재 재생 위치 사용', en: 'Use current position' })} onClick={() => update({ endTime: Number((videoRef.current?.currentTime() ?? 0).toFixed(3)) })}><Locate /></IconButton> : null}
            </div>
          </MiniField>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl size="sm" value={form.samplingMode} onChange={(mode) => update({ samplingMode: mode as ExtractForm['samplingMode'] })} items={[{ value: 'interval', label: t({ ko: '간격', en: 'Interval' }) }, { value: 'count', label: t({ ko: '개수', en: 'Count' }) }]} ariaLabel={t({ ko: '추출 방식', en: 'Sampling' })} />
          {form.samplingMode === 'interval' ? (
            <>
              <NumberStepperInput className="w-24" value={form.intervalValue} min={form.intervalUnit === 'frames' ? 1 : 0.001} step={form.intervalUnit === 'frames' ? 1 : 0.01} onValueCommit={(value) => update({ intervalValue: Math.max(0.001, Number(value) || 1) })} aria-label={t({ ko: '간격', en: 'Interval' })} />
              <SegmentedControl
                size="sm"
                value={batch ? 'seconds' : form.intervalUnit}
                onChange={(unit) => {
                  const fps = info?.fps ?? 30
                  const next = unit as ExtractForm['intervalUnit']
                  if (next === form.intervalUnit) return
                  update({ intervalUnit: next, intervalValue: next === 'frames' ? Math.max(1, Math.round(form.intervalValue * fps)) : Number((form.intervalValue / fps).toFixed(4)) })
                }}
                items={[{ value: 'seconds', label: t({ ko: '초', en: 'sec' }) }, { value: 'frames', label: t({ ko: '프레임', en: 'frames' }), disabled: batch }]}
                ariaLabel={t({ ko: '간격 단위', en: 'Interval unit' })}
              />
            </>
          ) : (
            <NumberStepperInput className="w-24" value={form.sampleCount} min={2} max={MAX_SPRITE_FRAMES} step={1} onValueCommit={(value) => update({ sampleCount: Math.max(2, Math.min(MAX_SPRITE_FRAMES, Number(value) || 2)) })} aria-label={t({ ko: '개수', en: 'Count' })} />
          )}
        </div>
        <SwitchLine
          label={t({ ko: '연속 중복 프레임 빼기', en: 'Drop repeated frames' })}
          checked={form.removeDuplicateFrames}
          onChange={(checked) => update({ removeDuplicateFrames: checked })}
          extra={form.removeDuplicateFrames ? <NumberStepperInput className="h-7 w-36 text-xs" value={form.similarityPercent} min={1} max={100} step={0.5} onValueCommit={(value) => update({ similarityPercent: Math.max(1, Math.min(100, Number(value) || 99)) })} aria-label={t({ ko: '유사도 %', en: 'Similarity %' })} /> : undefined}
        />
        {tooMany ? <div role="alert" className="text-xs text-destructive">{t({ ko: '프레임은 {max}개까지야. 간격을 늘리거나 구간을 줄여.', en: 'Up to {max} frames. Widen the interval or shorten the range.' }, { max: MAX_SPRITE_FRAMES })}</div> : null}
      </SpriteSection>

      <SpriteSection title={t({ ko: '배경 지정색', en: 'Key colour' })}>
        <div className="flex flex-col gap-1.5">
          {form.keyColors.map((color, index) => (
            <div key={index} className="flex items-center gap-2">
              <label className={cn('relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-sm border-2', index === activeColor && !form.despill ? 'border-foreground' : 'border-line')} style={{ background: color }} onClick={() => setActiveColor(index)}>
                <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={color.toLowerCase()} aria-label={t({ ko: '색 고르기', en: 'Choose colour' })} onChange={(event) => setColor(index, event.target.value)} />
              </label>
              <HexInput value={color} label={t({ ko: '색 코드', en: 'Colour code' })} onCommit={(value) => setColor(index, value)} />
              <span className="flex-1" />
              {index === 0 ? (
                <>
                  <IconButton variant="secondary" size="icon-sm" active={picking} disabled={!info} label={t({ ko: '영상에서 색 찍기', en: 'Pick from the video' })} onClick={() => setPicking(!picking)}><Pipette /></IconButton>
                  <IconButton variant="secondary" size="icon-sm" disabled={form.despill || form.keyColors.length >= MAX_KEY_COLORS} label={form.despill ? t({ ko: '디스필은 색 하나만 써', en: 'Despill uses one colour' }) : t({ ko: '색 추가', en: 'Add colour' })} onClick={() => { update({ keyColors: [...form.keyColors, '#00FF00'] }); setActiveColor(form.keyColors.length) }}><Plus /></IconButton>
                </>
              ) : (
                <IconButton variant="ghost" size="icon-sm" label={t({ ko: '색 빼기', en: 'Remove colour' })} onClick={() => { update({ keyColors: form.keyColors.filter((_, position) => position !== index) }); setActiveColor(0) }}><X /></IconButton>
              )}
            </div>
          ))}
        </div>
        <SliderLine label={t({ ko: '허용치', en: 'Tolerance' })} value={form.tolerancePercent} min={1} max={100} format={(value) => `${Math.round(value)}%`} onChange={(value) => update({ tolerancePercent: value })} />
        <SliderLine label={t({ ko: '부드러움', en: 'Softness' })} value={form.softnessPercent} min={form.despill ? 1 : 0} max={100} format={(value) => `${Math.round(value)}%`} onChange={(value) => update({ softnessPercent: value })} />
        <SwitchLine label={t({ ko: '디스필', en: 'Despill' })} checked={form.despill} onChange={(checked) => { setForm(withDespill(form, checked)); setActiveColor(0) }} />
        {form.despill ? (
          <div className="border-l-2 border-line pl-3">
            <SwitchLine muted label={t({ ko: '가장자리 정리', en: 'Edge clean-up' })} checked={form.edgeCleanup} onChange={(checked) => update({ edgeCleanup: checked })} />
          </div>
        ) : null}
      </SpriteSection>

      <SpriteSection title={t({ ko: '보정·크기', en: 'Clean-up and size' })}>
        <SwitchLine
          label={t({ ko: '자동 크롭', en: 'Auto crop' })}
          checked={form.autoCrop}
          onChange={(checked) => update({ autoCrop: checked })}
          extra={form.autoCrop ? <NumberStepperInput className="h-7 w-36 text-xs" value={form.alphaThreshold} min={1} max={255} step={1} onValueCommit={(value) => update({ alphaThreshold: Math.max(1, Math.min(255, Number(value) || 20)) })} aria-label={t({ ko: '알파 임계값', en: 'Alpha threshold' })} /> : undefined}
        />
        <SwitchLine
          label={t({ ko: '사전 크롭', en: 'Pre-crop' })}
          checked={Boolean(form.preCrop)}
          disabled={!info}
          onChange={(checked) => update({ preCrop: checked && info ? { x: Math.round(info.width * 0.1), y: Math.round(info.height * 0.1), width: Math.round(info.width * 0.8), height: Math.round(info.height * 0.8) } : null })}
        />
        {form.preCrop ? (
          <div className="grid grid-cols-2 gap-2">
            {(['x', 'y', 'width', 'height'] as const).map((key) => (
              <MiniField key={key} label={key === 'x' ? 'X' : key === 'y' ? 'Y' : key === 'width' ? 'W' : 'H'}>
                <NumberStepperInput value={form.preCrop![key]} min={key === 'width' || key === 'height' ? 1 : 0} max={key === 'x' || key === 'width' ? info?.width : info?.height} step={1} onValueCommit={(value) => update({ preCrop: { ...form.preCrop!, [key]: Math.max(0, Math.round(Number(value) || 0)) } })} />
              </MiniField>
            ))}
          </div>
        ) : null}
        <SegmentedControl
          size="sm"
          value={form.resizeMode}
          onChange={(mode) => update({ resizeMode: mode as ExtractForm['resizeMode'] })}
          items={[{ value: 'none', label: t({ ko: '원본', en: 'Original' }) }, { value: 'contain', label: t({ ko: '맞춤', en: 'Fit' }) }, { value: 'cover', label: t({ ko: '채움', en: 'Fill' }) }, { value: 'stretch', label: t({ ko: '늘림', en: 'Stretch' }) }]}
          ariaLabel={t({ ko: '크기 조정', en: 'Resize' })}
        />
        {form.resizeMode !== 'none' ? (
          <div className="grid grid-cols-2 gap-3">
            <MiniField label={t({ ko: '가로', en: 'Width' })}><NumberStepperInput value={form.outputWidth} min={1} max={16384} step={1} onValueCommit={(value) => update({ outputWidth: Math.max(1, Number(value) || 1) })} /></MiniField>
            <MiniField label={t({ ko: '세로', en: 'Height' })}><NumberStepperInput value={form.outputHeight} min={1} max={16384} step={1} onValueCommit={(value) => update({ outputHeight: Math.max(1, Number(value) || 1) })} /></MiniField>
          </div>
        ) : null}
      </SpriteSection>

      <div className="sticky bottom-3 z-sticky mt-2 flex items-center gap-3 rounded-md bg-surface-container/95 p-1.5 pl-3 shadow-elevation-3 backdrop-blur-md">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{summary}</span>
        <Button disabled={!canRun} onClick={() => void run()}>
          <Film />
          {t({ ko: '스프라이트 생성', en: 'Build sprites' })}
        </Button>
      </div>
    </div>
  )

  const right = (
    <div className="flex min-w-0 flex-col gap-4">
      {jobId ? <RuntimeJobProgress job={job.job} cancel={job.cancel} isCancelling={job.isCancelling} /> : null}
      {build && !batch ? (
        <SpriteResultPanel build={build} output={output} onOutputChange={setOutput} crop={crop} onCropChange={setCrop} stale={stale} saving={saving} canSave={has('images.upload')} onSave={() => void save()} />
      ) : batchResult ? null : (
        <div className="bg-checker flex h-[min(56vh,420px)] items-center justify-center rounded-sm">
          <Film className="size-10 text-muted-foreground opacity-30" />
        </div>
      )}
      {batchResult?.items.some((item) => item.error) ? (
        <ul role="alert" className="flex flex-col gap-1 text-xs text-destructive">
          {batchResult.items.filter((item) => item.error).map((item) => <li key={item.videoHash} className="truncate">{item.videoHash.slice(0, 12)} · {item.error}</li>)}
        </ul>
      ) : null}
      <LibraryResults hashes={savedHashes} />
    </div>
  )

  return isWide ? (
    <div className="grid grid-cols-[minmax(360px,4fr)_minmax(0,6fr)] items-start gap-8">{left}<div className="sticky top-[calc(var(--theme-shell-header-height)+1rem)]">{right}</div></div>
  ) : (
    <div className="flex flex-col gap-6">{left}{right}</div>
  )
}
