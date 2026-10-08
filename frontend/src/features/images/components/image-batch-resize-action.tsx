import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ImageUpscale, Link2, Link2Off } from 'lucide-react'
import { SelectionBarAction } from '@/components/common/selection-action-bar'
import { RuntimeJobProgress } from '@/components/common/runtime-job-progress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { startImageBatchResize, type ImageBatchResizeFormat, type ImageBatchResizeResult } from '@/lib/api-image-batch-resize'
import { useRuntimeJobAction } from '@/lib/use-runtime-job'

const MAX_SIDE = 16384
const DEFAULT_GROUP_PATH = '크기 변경'

interface ImageBatchResizeActionProps {
  compositeHashes: string[]
  /** Size of the first selected image: the starting size and the ratio the lock keeps. */
  referenceSize?: { width?: number | null; height?: number | null } | null
}

function clampSide(value: number) {
  return Math.min(MAX_SIDE, Math.max(1, Math.round(value)))
}

/**
 * "크기 변경" in the image selection bar: resize the selected images to exactly W×H into new library images
 * (originals untouched, videos and animations skipped). Runs as a runtime job; the snackbar links to the result group.
 */
export function ImageBatchResizeAction({ compositeHashes, referenceSize }: ImageBatchResizeActionProps) {
  const { t, formatNumber } = useI18n()
  const { showSnackbar } = useSnackbar()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const refWidth = referenceSize?.width && referenceSize.width > 0 ? referenceSize.width : null
  const refHeight = referenceSize?.height && referenceSize.height > 0 ? referenceSize.height : null
  const ratio = refWidth && refHeight ? refWidth / refHeight : null
  const [width, setWidth] = useState(512)
  const [height, setHeight] = useState(512)
  const [locked, setLocked] = useState(true)
  const [format, setFormat] = useState<ImageBatchResizeFormat>('png')
  const [quality, setQuality] = useState(90)
  const [groupPath, setGroupPath] = useState(DEFAULT_GROUP_PATH)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setWidth(refWidth ?? 512)
    setHeight(refHeight ?? 512)
    setLocked(ratio !== null)
    setError(null)
  }, [open, ratio, refHeight, refWidth])

  const resize = useRuntimeJobAction<ImageBatchResizeResult>(
    () => startImageBatchResize({ compositeHashes, width, height, format, quality, groupPath: groupPath.trim() || DEFAULT_GROUP_PATH }),
    {
      onStartError: (startError) => setError(startError instanceof Error ? startError.message : String(startError)),
      onFailed: (job) => setError(job.failureMessage ?? t({ ko: '크기를 바꾸지 못했어', en: 'Resize failed' })),
      onCompleted: (job) => {
        setOpen(false)
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ['groups-hierarchy-all'] }),
          queryClient.invalidateQueries({ queryKey: ['group-detail', 'custom'] }),
          queryClient.invalidateQueries({ queryKey: ['group-images', 'custom'] }),
        ])
        const result = job.result
        if (!result) return
        const skipped = result.skipped.length + result.failed.length
        const message = t({ ko: `${formatNumber(result.saved.length)}개 크기 변경됨`, en: `${formatNumber(result.saved.length)} resized` })
        showSnackbar({
          message,
          content: (
            <span className="flex flex-wrap items-center gap-x-2">
              <span>{message}{skipped > 0 ? t({ ko: ` · ${formatNumber(skipped)}개 건너뜀`, en: ` · ${formatNumber(skipped)} skipped` }) : ''}</span>
              {/* The snackbar renders outside the router, so navigate with the hook captured here instead of a <Link>. */}
              <a
                href={`#/groups/${result.groupId}`}
                onClick={(event) => { event.preventDefault(); navigate(`/groups/${result.groupId}`) }}
                className="font-semibold text-primary underline-offset-2 hover:underline"
              >
                {t({ ko: '그룹 열기', en: 'Open group' })}
              </a>
            </span>
          ),
          durationMs: 6000,
        })
      },
    },
  )

  const setWidthKeepingRatio = (value: number) => {
    const next = clampSide(value)
    setWidth(next)
    if (locked && ratio) setHeight(clampSide(next / ratio))
  }
  const setHeightKeepingRatio = (value: number) => {
    const next = clampSide(value)
    setHeight(next)
    if (locked && ratio) setWidth(clampSide(next * ratio))
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    void resize.run()
  }

  const busy = resize.isStarting || resize.isRunning

  return (
    <>
      <SelectionBarAction
        icon={ImageUpscale}
        label={t({ ko: '크기 변경', en: 'Resize' })}
        onClick={() => setOpen(true)}
        disabled={compositeHashes.length === 0}
      />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t({ ko: `크기 변경 · ${formatNumber(compositeHashes.length)}개`, en: `Resize · ${formatNumber(compositeHashes.length)}` })}
        widthClassName="max-w-md"
      >
        <form onSubmit={handleSubmit}>
          <ModalBody className="space-y-4">
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex items-end gap-2">
              <Field label={t({ ko: '가로', en: 'Width' })} className="min-w-0 flex-1">
                <Input type="number" min={1} max={MAX_SIDE} value={width} onChange={(event) => setWidthKeepingRatio(Number(event.target.value) || 1)} disabled={busy} />
              </Field>
              <IconButton
                label={locked ? t({ ko: '비율 고정 풀기', en: 'Unlock ratio' }) : t({ ko: '첫 이미지 비율로 고정', en: 'Lock to the first image ratio' })}
                variant="ghost"
                size="icon"
                active={locked && ratio !== null}
                disabled={ratio === null || busy}
                onClick={() => {
                  const next = !locked
                  setLocked(next)
                  if (next && ratio) setHeight(clampSide(width / ratio))
                }}
              >
                {locked && ratio !== null ? <Link2 className="h-4 w-4" /> : <Link2Off className="h-4 w-4" />}
              </IconButton>
              <Field label={t({ ko: '세로', en: 'Height' })} className="min-w-0 flex-1">
                <Input type="number" min={1} max={MAX_SIDE} value={height} onChange={(event) => setHeightKeepingRatio(Number(event.target.value) || 1)} disabled={busy} />
              </Field>
            </div>
            <div className="flex items-end gap-2">
              <Field label={t({ ko: '형식', en: 'Format' })} className="min-w-0 flex-1">
                <Select value={format} onChange={(event) => setFormat(event.target.value as ImageBatchResizeFormat)} disabled={busy}>
                  <option value="png">PNG</option>
                  <option value="webp">WebP</option>
                </Select>
              </Field>
              {format === 'webp' ? (
                <Field label={t({ ko: '품질', en: 'Quality' })} className="w-24 shrink-0">
                  <Input type="number" min={1} max={100} value={quality} onChange={(event) => setQuality(Math.min(100, Math.max(1, Number(event.target.value) || 1)))} disabled={busy} />
                </Field>
              ) : null}
            </div>
            <Field label={t({ ko: '저장할 그룹', en: 'Save to group' })}>
              <Input value={groupPath} onChange={(event) => setGroupPath(event.target.value)} placeholder={DEFAULT_GROUP_PATH} disabled={busy} />
            </Field>
            {resize.job && resize.isRunning ? <RuntimeJobProgress job={resize.job} cancel={resize.cancel} isCancelling={resize.isCancelling} /> : null}
            <ModalFooter>
              <Button type="submit" disabled={busy || compositeHashes.length === 0}>
                <ImageUpscale className="h-4 w-4" />
                {t({ ko: '크기 변경', en: 'Resize' })}
              </Button>
            </ModalFooter>
          </ModalBody>
        </form>
      </Modal>
    </>
  )
}
