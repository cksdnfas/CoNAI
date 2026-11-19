import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useI18n } from '@/i18n'
import { stopTreeUpload, useTreeUploadProgress } from './folder-upload'

/** Progress and Stop of the running folder upload (see `folder-upload.ts`); nothing while none runs. Shown by every view of the files page. */
export function TreeUploadStatus() {
  const { t } = useI18n()
  const upload = useTreeUploadProgress()
  if (!upload) return null
  return (
    <div role="status" className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span>{upload.total === null ? t({ ko: '폴더를 읽는 중…', en: 'Reading folders…' }) : t({ ko: '업로드 중 {done}/{total}', en: 'Uploading {done}/{total}' }, { done: upload.done, total: upload.total })}</span>
        <Button variant="ghost" size="sm" disabled={upload.stopping} onClick={stopTreeUpload}>{upload.stopping ? t({ ko: '중지하는 중…', en: 'Stopping…' }) : t({ ko: '중지', en: 'Stop' })}</Button>
      </div>
      <Progress value={upload.done} max={upload.total ?? 1} indeterminate={upload.total === null} />
    </div>
  )
}
