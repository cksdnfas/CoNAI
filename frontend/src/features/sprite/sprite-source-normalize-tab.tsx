import { useState } from 'react'
import { Download, LoaderCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { FieldInfo } from '@/components/ui/field'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SegmentedControl } from '@/components/common/segmented-control'
import { RuntimeJobProgress } from '@/components/common/runtime-job-progress'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { PageBlockLayout } from '@/features/image-generation/layout/page-block-layout'
import { useI18n } from '@/i18n'
import { triggerBrowserDownload } from '@/lib/api-client'
import { spriteResultDownloadUrl, startSpriteSourceNormalize, type SpriteNormalizeResult, type SpriteSourceNormalizeOptions } from '@/lib/api-sprite'
import { getErrorMessage } from '@/lib/error-message'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { useRuntimeJob } from '@/lib/use-runtime-job'
import { LibraryMediaButtons, LibraryResults } from './sprite-library'
import { MiniField, SpriteActionBar, SpriteSection } from './sprite-ui'
import { useSpriteSourceNormalizeChatPage } from './use-sprite-chat-page'

export function SpriteSourceNormalizeTab({ active }: { active: boolean }) {
  const { t } = useI18n()
  const { has } = useFeaturePermissions()
  const { showSnackbar } = useSnackbar()
  const wide = useDesktopPageLayout()
  const [hashes, setHashes] = useState<string[]>([])
  const [options, setOptions] = useState<SpriteSourceNormalizeOptions>({
    input: 'image', keyColor: '#FF00FF', tolerance: 40, workSize: 1024, canvasSize: 1600,
    bottomMargin: 0, anchor: 'bottom', keep: 'both', scale: 1, offsetX: 0, offsetY: 0,
  })
  const [groupPath, setGroupPath] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [downloadRun, setDownloadRun] = useState(false)
  const [result, setResult] = useState<SpriteNormalizeResult | null>(null)
  const job = useRuntimeJob<SpriteNormalizeResult>(jobId, {
    onCompleted: (completed) => {
      setJobId(null)
      setResult(completed.result ?? null)
      if (downloadRun && completed.result) triggerBrowserDownload(spriteResultDownloadUrl(completed.result.workspaceId))
    },
    onFailed: (failed) => { setJobId(null); showSnackbar({ tone: 'error', message: failed.failureMessage ?? failed.message ?? t({ ko: '정규화 실패', en: 'Normalization failed' }) }) },
    onCancelled: () => setJobId(null),
  })
  const running = starting || Boolean(jobId)
  const canRun = has('images.edit') && hashes.length > 0 && !running
  const update = (patch: Partial<SpriteSourceNormalizeOptions>) => setOptions((current) => ({ ...current, ...patch }))
  const run = async (save: boolean) => {
    setStarting(true)
    setDownloadRun(!save)
    try {
      const started = await startSpriteSourceNormalize({ hashes, options, save: save ? { groupPath: groupPath.trim() || undefined } : null })
      setJobId(started.jobId)
    } catch (error) {
      showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '시작하지 못했어.', en: 'Could not start.' })) })
    } finally {
      setStarting(false)
    }
  }
  useSpriteSourceNormalizeChatPage({ active, hashes, setHashes, options, setOptions, groupPath, setGroupPath, running, canRun, canSave: has('images.upload'), run, cancel: job.cancel, result })
  const numberField = (key: 'tolerance' | 'workSize' | 'canvasSize' | 'bottomMargin' | 'scale' | 'offsetX' | 'offsetY', label: string, min?: number, step = 1) => (
    <MiniField label={label}><NumberStepperInput value={options[key]} min={min} max={key === 'scale' ? 1 : undefined} step={step} onValueCommit={(value) => update({ [key]: Number(value) })} /></MiniField>
  )
  const settings = (
    <div className="flex min-w-0 flex-col">
      <SpriteSection title={t({ ko: '원본 정규화', en: 'Source normalization' })}>
        <SegmentedControl size="sm" value={options.input} ariaLabel={t({ ko: '원본 종류', en: 'Source type' })} onChange={(value) => { update({ input: value as SpriteSourceNormalizeOptions['input'] }); setHashes([]) }} items={[{ value: 'image', label: t({ ko: '이미지', en: 'Images' }) }, { value: 'last_frame', label: t({ ko: '영상 마지막 프레임', en: 'Video last frame' }) }]} />
        <div className="flex items-center gap-2">
          <span className="flex-1 text-sm">{t({ ko: '{count}개 선택', en: '{count} selected' }, { count: hashes.length })}</span>
          <LibraryMediaButtons kind={options.input === 'image' ? 'image' : 'video'} maxCount={500} initialHashes={hashes} onPick={setHashes} />
          <IconButton variant="ghost" size="icon-sm" label={t({ ko: '선택 비우기', en: 'Clear selection' })} onClick={() => setHashes([])}><X /></IconButton>
        </div>
        <MiniField label={t({ ko: '배경 지정색 (#RRGGBB)', en: 'Background key (#RRGGBB)' })}>
          <div className="flex gap-2">
            <Input type="color" className="w-12" aria-label={t({ ko: '배경색 선택', en: 'Choose key colour' })} value={/^#[0-9a-f]{6}$/i.test(options.keyColor) ? options.keyColor : '#FF00FF'} onChange={(event) => update({ keyColor: event.target.value })} />
            <Input value={options.keyColor} onChange={(event) => update({ keyColor: event.target.value })} />
          </div>
        </MiniField>
        <div className="grid grid-cols-2 gap-2">
          {numberField('tolerance', t({ ko: 'RGB 거리 허용치', en: 'RGB distance tolerance' }), 0)}
          {numberField('canvasSize', t({ ko: '캔버스 크기', en: 'Canvas size' }), 1)}
          {options.input === 'image' ? <>
            {numberField('workSize', t({ ko: '작업 크기', en: 'Work size' }), 1)}
            {numberField('bottomMargin', t({ ko: '하단 여백 (bottom)', en: 'Bottom margin (bottom anchor)' }), 0)}
          </> : <>
            {numberField('scale', t({ ko: '균일 배율 (0 < s ≤ 1)', en: 'Uniform scale (0 < s ≤ 1)' }), 0, 0.01)}
            {numberField('offsetX', t({ ko: 'X 이동', en: 'X offset' }))}
            {numberField('offsetY', t({ ko: 'Y 이동', en: 'Y offset' }))}
          </>}
        </div>
        {options.input === 'image' ? <>
          <MiniField label={t({ ko: '캔버스 기준점', en: 'Canvas anchor' })}>
            <SegmentedControl size="sm" value={options.anchor} onChange={(value) => update({ anchor: value as SpriteSourceNormalizeOptions['anchor'] })} items={[{ value: 'bottom', label: t({ ko: '하단', en: 'Bottom' }) }, { value: 'center', label: t({ ko: '중앙', en: 'Centre' }) }]} ariaLabel={t({ ko: '캔버스 기준점', en: 'Canvas anchor' })} />
          </MiniField>
          <MiniField label={t({ ko: '보관할 출력', en: 'Outputs to keep' })}>
            <SegmentedControl size="sm" value={options.keep} onChange={(value) => update({ keep: value as SpriteSourceNormalizeOptions['keep'] })} items={[{ value: 'both', label: t({ ko: '둘 다', en: 'Both' }) }, { value: 'work', label: t({ ko: '작업 크기', en: 'Work' }) }, { value: 'canvas', label: t({ ko: '캔버스', en: 'Canvas' }) }]} ariaLabel={t({ ko: '보관할 출력', en: 'Outputs to keep' })} />
          </MiniField>
        </> : null}
        <MiniField label={t({ ko: '저장 그룹 경로 (기본: 스프라이트)', en: 'Save group path (default: 스프라이트)' })}><Input value={groupPath} onChange={(event) => setGroupPath(event.target.value)} /></MiniField>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>{t({ ko: '저장 방식', en: 'Save format' })}</span>
          <FieldInfo>{t({ ko: '투명화하지 않고 지정색 위에 불투명 PNG로 저장해. 테두리 검사 실패는 결과에 표시돼.', en: 'Saves opaque PNGs on the key colour, not transparent sprites. Failed border checks are flagged in the results.' })}</FieldInfo>
        </div>
      </SpriteSection>
      <SpriteActionBar>
        <span className="flex-1" />
        <IconButton variant="ghost" size="icon-sm" disabled={!canRun} label={t({ ko: 'ZIP으로 받기', en: 'Download ZIP' })} onClick={() => void run(false)}><Download /></IconButton>
        <Button size="sm" variant="default" disabled={!canRun || !has('images.upload')} onClick={() => void run(true)}>
          {running ? <LoaderCircle className="animate-spin" /> : null}
          {t({ ko: '저장', en: 'Save' })}
        </Button>
      </SpriteActionBar>
    </div>
  )
  const preview = (
    <div className="flex min-w-0 flex-col gap-3">
      <LibraryResults hashes={hashes} />
      {jobId ? <RuntimeJobProgress job={job.job} cancel={job.cancel} isCancelling={job.isCancelling} /> : null}
      {result ? <>
        <IconButton variant="ghost" size="icon-sm" label={t({ ko: '결과 ZIP 받기', en: 'Download result ZIP' })} onClick={() => triggerBrowserDownload(spriteResultDownloadUrl(result.workspaceId))}><Download /></IconButton>
        <div className="max-h-64 overflow-y-auto text-xs">
          {result.sheets.map((sheet) => <p key={sheet.outputFilename} className={sheet.report?.passed ? 'text-muted-foreground' : 'text-warning'}>
            {sheet.outputFilename} · {sheet.report?.passed ? 'OK' : 'FAIL'} · {t({ ko: '테두리', en: 'Border' })}: {String(sheet.report?.borderExact)} · {t({ ko: '남은 근사색', en: 'Remaining near-key' })}: {sheet.report?.nearKeyCount}
          </p>)}
          {result.failures.map((failure) => <p role="alert" key={failure.source} className="text-destructive">{failure.source}: {failure.error}</p>)}
        </div>
      </> : null}
    </div>
  )
  return <PageBlockLayout surface="sprite-normalize" active={active} wide={wide} blocks={{ settings, preview, saved: <LibraryResults hashes={result?.sheets.flatMap((sheet) => sheet.compositeHash ? [sheet.compositeHash] : []) ?? []} /> }} />
}
