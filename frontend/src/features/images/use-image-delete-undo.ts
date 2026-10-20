import { useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { restoreDeletedImageFiles } from '@/lib/api-system-folders'
import { refreshRestoredImageListCaches } from './image-list-cache'

/** Shared by Home, group selection and the single-image viewer. Each action captures only its own bin entries. */
export function useImageDeleteUndo() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t, formatNumber } = useI18n()

  return (details: { deleted: number; failed: number; recycleBinEntries: string[] }) => {
    const names = [...details.recycleBinEntries]
    const undo = async () => {
      try {
        const result = await restoreDeletedImageFiles(names)
        showSnackbar({
          message: result.failed.length
            ? t({ ko: '{restored}개 파일 복원, {failed}개 실패: {error}', en: '{restored} files restored, {failed} failed: {error}' }, { restored: formatNumber(result.done.length), failed: formatNumber(result.failed.length), error: result.failed[0].error })
            : t({ ko: '{count}개 파일을 복원했어.', en: '{count} files restored.' }, { count: formatNumber(result.done.length) }),
          tone: result.failed.length ? 'error' : 'info',
        })
      } catch (error) {
        showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '복원하지 못했어.', en: 'Could not restore the files.' }), tone: 'error' })
      } finally {
        await refreshRestoredImageListCaches(queryClient)
      }
    }
    const summary = details.failed
      ? t({ ko: '{deleted}개 삭제, {failed}개 실패했어.', en: '{deleted} deleted, {failed} failed.' }, { deleted: formatNumber(details.deleted), failed: formatNumber(details.failed) })
      : t({ ko: '{count}개 항목을 삭제했어.', en: '{count} items deleted.' }, { count: formatNumber(details.deleted) })
    showSnackbar({
      message: names.length ? `${summary} ${t({ ko: '휴지통의 파일 {count}개를 되돌릴 수 있어.', en: '{count} files in the Recycle Bin can be restored.' }, { count: formatNumber(names.length) })}` : summary,
      tone: details.failed ? 'error' : 'info',
      ...(names.length ? {
        action: { label: t({ ko: '되돌리기', en: 'Undo' }), onClick: () => { void undo() } },
      } : {}),
    })
  }
}
