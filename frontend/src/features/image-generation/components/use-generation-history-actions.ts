import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import {
  cleanupFailedGenerationHistory,
  clearGenerationHistoryScope,
  deleteGenerationHistoryRecord,
  downloadGenerationHistorySelection,
} from '@/lib/api-image-generation-history'
import {
  cleanupPublicGenerationWorkflowFailedHistory,
  clearPublicGenerationWorkflowHistory,
} from '@/lib/api-public-workflows'
import type { GenerationHistoryRecord, GenerationServiceType } from '@/lib/api-image-generation-types'
import {
  getErrorMessage,
  getRetryableHistoryQueueJobId,
} from '../image-generation-shared'
import {
  getUniqueRetryableHistoryQueueJobIds,
  retryGenerationHistoryRecords,
  runGenerationHistoryMutationBatch,
} from './generation-history-retry-actions'
import {
  collectRetryableHistoryRecords,
  getGenerationHistorySelectionId,
  readAcknowledgedRecoveryIds,
  writeAcknowledgedRecoveryIds,
} from './generation-history-panel-helpers'

/** Per-scope acknowledgement of run-recovery rows, persisted in localStorage. */
export function useHistoryRecoveryAcknowledgement(recoveryAckStorageKey: string) {
  const [acknowledgedRecoveryIds, setAcknowledgedRecoveryIds] = useState<Set<number>>(() => readAcknowledgedRecoveryIds(recoveryAckStorageKey))

  useEffect(() => {
    setAcknowledgedRecoveryIds(readAcknowledgedRecoveryIds(recoveryAckStorageKey))
  }, [recoveryAckStorageKey])

  const acknowledgeRecoveryRecords = useCallback((records: GenerationHistoryRecord[]) => {
    if (records.length === 0) {
      return
    }

    setAcknowledgedRecoveryIds((current) => {
      const next = new Set(current)
      for (const record of records) {
        next.add(record.id)
      }
      writeAcknowledgedRecoveryIds(recoveryAckStorageKey, next)
      return next
    })
  }, [recoveryAckStorageKey])

  return { acknowledgedRecoveryIds, acknowledgeRecoveryRecords }
}

type UseGenerationHistoryActionsOptions = {
  serviceType: GenerationServiceType
  workflowId?: number | null
  publicWorkflowSlug?: string | null
  isAdmin: boolean
  isPublicView: boolean
  refreshHistory: (options?: { watchForNewRows?: boolean }) => Promise<void>
  setSelectedHistoryIds: Dispatch<SetStateAction<string[]>>
  selectedHistoryRecords: GenerationHistoryRecord[]
  selectedRetryableHistoryRecords: GenerationHistoryRecord[]
  visibleRetryableHistoryRecords: GenerationHistoryRecord[]
  downloadableHistoryRecords: GenerationHistoryRecord[]
  downloadableHistoryIds: number[]
  acknowledgeRecoveryRecords: (records: GenerationHistoryRecord[]) => void
}

/** Delete / cleanup / clear / rerun / download actions for the generation history panel. */
export function useGenerationHistoryActions({
  serviceType,
  workflowId,
  publicWorkflowSlug,
  isAdmin,
  isPublicView,
  refreshHistory,
  setSelectedHistoryIds,
  selectedHistoryRecords,
  selectedRetryableHistoryRecords,
  visibleRetryableHistoryRecords,
  downloadableHistoryRecords,
  downloadableHistoryIds,
  acknowledgeRecoveryRecords,
}: UseGenerationHistoryActionsOptions) {
  const { showSnackbar } = useSnackbar()
  const { t, formatNumber } = useI18n()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [isDeletingSelection, setIsDeletingSelection] = useState(false)
  const [isDownloadingSelection, setIsDownloadingSelection] = useState(false)
  const [isCleaningFailed, setIsCleaningFailed] = useState(false)
  const [isClearingHistory, setIsClearingHistory] = useState(false)
  const [retryingQueueJobIds, setRetryingQueueJobIds] = useState<Set<number>>(() => new Set())
  const isRetryingRunRecovery = retryingQueueJobIds.size > 0

  const handleDeleteSelected = useCallback(async () => {
    if (!isAdmin) {
      showSnackbar({ message: t('image-generation.components.generation.history.panel.only.admin.accounts.can.delete'), tone: 'error' })
      return
    }

    if (selectedHistoryRecords.length === 0 || isDeletingSelection) {
      return
    }

    const selectedCount = selectedHistoryRecords.length
    const confirmed = await confirm({
      title: t({ ko: '휴지통으로 보내기', en: 'Move to Recycle Bin' }),
      description: t('image-generation.components.generation.history.panel.selected.valueresults.to.the.recycle.bin.and', { count: formatNumber(selectedCount) }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (!confirmed) {
      return
    }

    try {
      setIsDeletingSelection(true)
      const result = await runGenerationHistoryMutationBatch(
        selectedHistoryRecords,
        (record) => deleteGenerationHistoryRecord(record.id, true),
      )
      const failedSelectionIds = new Set(result.failedItems.map(({ item }) => getGenerationHistorySelectionId(item)))
      setSelectedHistoryIds((current) => current.filter((id) => failedSelectionIds.has(id)))
      await refreshHistory()
      if (result.failedItems.length === 0) {
        showSnackbar({ message: t('image-generation.components.generation.history.panel.valueresults.moved.to.recyclebin', { count: formatNumber(selectedCount) }), tone: 'info' })
      } else if (result.successfulItems.length > 0) {
        showSnackbar({
          message: t(
            { ko: '{deleted}개 삭제, {failed}개 실패했어.', en: '{deleted} deleted, {failed} failed.' },
            { deleted: formatNumber(result.successfulItems.length), failed: formatNumber(result.failedItems.length) },
          ),
          tone: 'error',
        })
      } else {
        showSnackbar({ message: getErrorMessage(result.failedItems[0]?.error, t('image-generation.components.generation.history.panel.failed.to.delete.history')), tone: 'error' })
      }
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t('image-generation.components.generation.history.panel.failed.to.delete.history')), tone: 'error' })
    } finally {
      setIsDeletingSelection(false)
    }
  }, [confirm, formatNumber, isAdmin, isDeletingSelection, refreshHistory, selectedHistoryRecords, setSelectedHistoryIds, showSnackbar, t])

  const handleCleanupFailed = useCallback(async () => {
    if (isCleaningFailed) {
      return
    }

    // Clear history 와 같은 범위(서비스/워크플로 + 계정)로만 정리한다.
    const runCleanup = (dryRun: boolean) => (
      isPublicView && publicWorkflowSlug
        ? cleanupPublicGenerationWorkflowFailedHistory(publicWorkflowSlug, { dryRun })
        : cleanupFailedGenerationHistory({
            serviceType,
            workflowId,
            mine: !isAdmin,
            dryRun,
          })
    )

    try {
      setIsCleaningFailed(true)
      // 로드된 페이지가 아니라 서버 범위 전체의 실제 개수로 확인을 받는다.
      const preview = await runCleanup(true)
      if (preview.deleted <= 0) {
        showSnackbar({ message: t({ ko: '정리할 실패 기록이 없어.', en: 'There are no failed records to clean up.' }), tone: 'info' })
        return
      }

      const confirmed = await confirm({
        title: t({ ko: '실패 기록 정리', en: 'Clean up failed records' }),
        description: isPublicView
          ? t(
              { ko: '이 공용 워크플로에서 내 실패 기록 {count}개를 목록에서 지울까? 원본 미디어는 유지돼.', en: 'Remove {count} of my failed records for this public workflow? Original media will be kept.' },
              { count: formatNumber(preview.deleted) },
            )
          : t(
              { ko: '이 생성 페이지의 실패 기록 {count}개를 목록에서 지울까? 원본 미디어는 유지돼.', en: 'Remove {count} failed records from this generation page? Original media will be kept.' },
              { count: formatNumber(preview.deleted) },
            ),
        confirmLabel: t({ ko: '정리', en: 'Clean up' }),
        tone: 'destructive',
      })
      if (!confirmed) {
        return
      }

      const result = await runCleanup(false)
      setSelectedHistoryIds([])
      await refreshHistory()
      showSnackbar({
        message: result.deleted > 0
          ? t(
              { ko: '실패 기록 {count}개를 정리했어.', en: 'Cleaned up {count} failed records.' },
              { count: formatNumber(result.deleted) },
            )
          : t({ ko: '정리할 실패 기록이 없어.', en: 'There are no failed records to clean up.' }),
        tone: 'info',
      })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t('image-generation.components.generation.history.panel.failed.to.clean.up.failed.history')), tone: 'error' })
    } finally {
      setIsCleaningFailed(false)
    }
  }, [confirm, formatNumber, isAdmin, isCleaningFailed, isPublicView, publicWorkflowSlug, refreshHistory, serviceType, setSelectedHistoryIds, showSnackbar, t, workflowId])

  const handleClearHistory = useCallback(async () => {
    if (isClearingHistory) {
      return
    }

    const confirmed = await confirm({
      title: t({ ko: '히스토리 비우기', en: 'Clear history' }),
      description: isPublicView
        ? t({
            ko: '이 공용 워크플로에서 내 완료·실패 히스토리 목록을 비울까? 원본 미디어는 유지돼.',
            en: 'Clear my completed and failed history for this public workflow? Original media will be kept.',
          })
        : t({
            ko: '이 생성 페이지의 완료·실패 히스토리 목록을 비울까? 원본 미디어는 유지돼.',
            en: 'Clear completed and failed history for this generation page? Original media will be kept.',
          }),
      confirmLabel: t({ ko: '비우기', en: 'Clear' }),
      tone: 'destructive',
    })
    if (!confirmed) {
      return
    }

    try {
      setIsClearingHistory(true)
      const result = isPublicView && publicWorkflowSlug
        ? await clearPublicGenerationWorkflowHistory(publicWorkflowSlug)
        : await clearGenerationHistoryScope({
            serviceType,
            workflowId,
            mine: !isAdmin,
          })
      setSelectedHistoryIds([])
      await refreshHistory()
      showSnackbar({
        message: result.deleted > 0
          ? t(
              { ko: '히스토리 {count}개를 목록에서 지웠어. 원본 미디어는 유지돼.', en: 'Removed {count} history records. Original media was kept.' },
              { count: formatNumber(result.deleted) },
            )
          : t({ ko: '정리할 완료·실패 히스토리가 없어.', en: 'There is no completed or failed history to clear.' }),
        tone: 'info',
      })
    } catch (error) {
      showSnackbar({
        message: getErrorMessage(error, t({ ko: '히스토리 목록을 비우지 못했어.', en: 'Failed to clear the history list.' })),
        tone: 'error',
      })
    } finally {
      setIsClearingHistory(false)
    }
  }, [confirm, formatNumber, isAdmin, isClearingHistory, isPublicView, publicWorkflowSlug, refreshHistory, serviceType, setSelectedHistoryIds, showSnackbar, t, workflowId])

  const handleAcknowledgeRunRecovery = useCallback(() => {
    acknowledgeRecoveryRecords(visibleRetryableHistoryRecords)
  }, [acknowledgeRecoveryRecords, visibleRetryableHistoryRecords])

  const handleRetryHistoryRecords = useCallback(async (
    records: readonly GenerationHistoryRecord[],
    options: { successMessage: string; failureMessage: string },
  ) => {
    const retryableRecords = collectRetryableHistoryRecords(records)
    if (retryableRecords.length === 0 || isRetryingRunRecovery) {
      return
    }

    const queueJobIds = getUniqueRetryableHistoryQueueJobIds(retryableRecords)
    if (queueJobIds.length === 0) {
      return
    }

    try {
      setRetryingQueueJobIds(new Set(queueJobIds))
      const retryResult = await retryGenerationHistoryRecords({
        records: retryableRecords,
        queryClient,
        refreshHistory,
        showSnackbar,
        successMessage: options.successMessage,
        failureMessage: options.failureMessage,
        partialFailureMessage: (successCount, failureCount) => t(
          { ko: '{succeeded}개 재실행 등록, {failed}개 실패했어.', en: '{succeeded} retries queued, {failed} failed.' },
          { succeeded: formatNumber(successCount), failed: formatNumber(failureCount) },
        ),
      })
      if (retryResult.successfulItems.length > 0) {
        const succeededQueueJobIds = new Set(retryResult.successfulItems)
        acknowledgeRecoveryRecords(retryableRecords.filter((record) => {
          const queueJobId = getRetryableHistoryQueueJobId(record)
          return queueJobId !== null && succeededQueueJobIds.has(queueJobId)
        }))
      }
    } finally {
      setRetryingQueueJobIds(new Set())
    }
  }, [acknowledgeRecoveryRecords, formatNumber, isRetryingRunRecovery, queryClient, refreshHistory, showSnackbar, t])

  const handleRetryHistoryRecord = useCallback(async (record: GenerationHistoryRecord) => {
    await handleRetryHistoryRecords([record], {
      successMessage: t({ ko: '큐 재실행 작업을 등록했어.', en: 'Added the retry job to the queue.' }),
      failureMessage: t({ ko: '큐 재실행 등록에 실패했어.', en: 'Failed to add the retry job.' }),
    })
  }, [handleRetryHistoryRecords, t])

  const handleRetryVisibleRecoveryRecords = useCallback(async () => {
    await handleRetryHistoryRecords(visibleRetryableHistoryRecords, {
      successMessage: t(
        { ko: '재실행 작업 {count}개를 큐에 등록했어.', en: 'Added {count} retry jobs to the queue.' },
        { count: formatNumber(visibleRetryableHistoryRecords.length) },
      ),
      failureMessage: t({ ko: '일괄 재실행 등록에 실패했어.', en: 'Failed to add retry jobs.' }),
    })
  }, [formatNumber, handleRetryHistoryRecords, t, visibleRetryableHistoryRecords])

  const handleRetrySelectedHistoryRecords = useCallback(async () => {
    await handleRetryHistoryRecords(selectedRetryableHistoryRecords, {
      successMessage: t(
        { ko: '선택한 재실행 작업 {count}개를 큐에 등록했어.', en: 'Added {count} selected retry jobs to the queue.' },
        { count: formatNumber(selectedRetryableHistoryRecords.length) },
      ),
      failureMessage: t({ ko: '선택 재실행 등록에 실패했어.', en: 'Failed to add selected retry jobs.' }),
    })
  }, [formatNumber, handleRetryHistoryRecords, selectedRetryableHistoryRecords, t])

  const handleDownloadSelected = useCallback(async (type: 'thumbnail' | 'original') => {
    if (downloadableHistoryIds.length === 0 || isDownloadingSelection) {
      return
    }

    try {
      setIsDownloadingSelection(true)
      const selectedRecord = downloadableHistoryRecords.length === 1 ? downloadableHistoryRecords[0] : null
      await downloadGenerationHistorySelection(downloadableHistoryIds, type, selectedRecord ? {
        originalFilePath: selectedRecord.actual_file_name,
        contentType: selectedRecord.actual_mime_type,
      } : undefined)
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t('image-generation.components.generation.history.panel.failed.to.download.the.selected.images')), tone: 'error' })
    } finally {
      setIsDownloadingSelection(false)
    }
  }, [downloadableHistoryIds, downloadableHistoryRecords, isDownloadingSelection, showSnackbar, t])

  return {
    isDeletingSelection,
    isDownloadingSelection,
    isCleaningFailed,
    isClearingHistory,
    retryingQueueJobIds,
    isRetryingRunRecovery,
    handleDeleteSelected,
    handleCleanupFailed,
    handleClearHistory,
    handleAcknowledgeRunRecovery,
    handleRetryHistoryRecord,
    handleRetryVisibleRecoveryRecords,
    handleRetrySelectedHistoryRecords,
    handleDownloadSelected,
  }
}
