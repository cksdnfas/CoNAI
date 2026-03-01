import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { imageApi } from '@/services/image-api'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ThumbnailCard } from '@/features/image-groups/components/thumbnail-card'
import {
  type DuplicateGroup,
  findDuplicateGroups,
  getSimilarityQueryImage,
  getSimilaritySettings,
  getSimilarityStats,
  getSimilarityThresholds,
  rebuildSimilarityHashes,
  type SimilaritySearchMode,
  type SimilaritySearchResult,
  testSimilaritySearch,
  updateAutoGenerateHashOnUpload,
} from './similarity-api'

export default function SimilaritySettingsFeature() {
  const { t } = useTranslation('settings')
  const [autoGenerateHash, setAutoGenerateHash] = useState(true)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null)
  const [testImageId, setTestImageId] = useState('')
  const [testMode, setTestMode] = useState<SimilaritySearchMode>('similar')
  const [testValidationError, setTestValidationError] = useState<string | null>(null)
  const [testLoading, setTestLoading] = useState(false)
  const [queryImage, setQueryImage] = useState<Awaited<ReturnType<typeof getSimilarityQueryImage>>>(null)
  const [testResults, setTestResults] = useState<SimilaritySearchResult[]>([])
  const [duplicateThreshold, setDuplicateThreshold] = useState(5)
  const [similarThreshold, setSimilarThreshold] = useState(15)
  const [colorThreshold, setColorThreshold] = useState(85)
  const [searchLimit, setSearchLimit] = useState(20)
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getSimilarityStats>>>(null)
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([])
  const [duplicateScanLoading, setDuplicateScanLoading] = useState(false)
  const [selectedDuplicateFileIds, setSelectedDuplicateFileIds] = useState<Set<number>>(new Set())
  const [duplicateDeleteLoading, setDuplicateDeleteLoading] = useState(false)
  const [duplicateFeedback, setDuplicateFeedback] = useState<{ type: 'success' | 'warning'; message: string } | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshingStats, setRefreshingStats] = useState(false)
  const [updatingAutoGenerate, setUpdatingAutoGenerate] = useState(false)
  const [rebuildingHashes, setRebuildingHashes] = useState(false)
  const [rebuildProgress, setRebuildProgress] = useState(0)
  const [rebuildProcessed, setRebuildProcessed] = useState(0)
  const [rebuildTotal, setRebuildTotal] = useState(0)

  const statusControlsDisabled = initialLoading || refreshingStats || updatingAutoGenerate || rebuildingHashes

  useEffect(() => {
    let isActive = true

    const loadThresholds = async () => {
      setInitialLoading(true)
      setOperationError(null)

      try {
        const [thresholds, loadedStats, loadedSettings] = await Promise.all([
          getSimilarityThresholds(),
          getSimilarityStats(),
          getSimilaritySettings(),
        ])

        if (!isActive) {
          return
        }

        setDuplicateThreshold(thresholds.duplicateThreshold)
        setSimilarThreshold(thresholds.similarThreshold)
        setColorThreshold(thresholds.colorThreshold)
        setSearchLimit(thresholds.searchLimit)
        setStats(loadedStats)
        setAutoGenerateHash(loadedSettings.autoGenerateHashOnUpload)
      } catch {
        if (!isActive) {
          return
        }

        setOperationError(t('similarity.systemStatus.refreshFailed', { defaultValue: 'Failed to refresh similarity statistics.' }))
      } finally {
        if (isActive) {
          setInitialLoading(false)
        }
      }
    }

    void loadThresholds()

    return () => {
      isActive = false
    }
  }, [t])

  const handleToggle = async () => {
    if (statusControlsDisabled) {
      return
    }

    const previous = autoGenerateHash
    const next = !previous

    setAutoGenerateHash(next)
    setOperationError(null)
    setStatusFeedback(null)
    setUpdatingAutoGenerate(true)

    try {
      const saved = await updateAutoGenerateHashOnUpload(next)
      setAutoGenerateHash(saved)
    } catch {
      setOperationError(t('similarity.systemStatus.autoGenerateUpdateFailed', { defaultValue: 'Failed to update auto-generate hash setting.' }))
      setAutoGenerateHash(previous)
    } finally {
      setUpdatingAutoGenerate(false)
    }
  }

  const handleSimilarityTest = async () => {
    setOperationError(null)
    setTestValidationError(null)
    setQueryImage(null)
    setTestResults([])

    const compositeHash = testImageId.trim()
    if (!compositeHash) {
      setTestValidationError(t('similarity.test.validation.requiredHash', { defaultValue: 'Please enter an image hash.' }))
      return
    }

    if (!/^[0-9a-fA-F]{48}$/.test(compositeHash)) {
      setTestValidationError(t('similarity.test.validation.invalidHashFormat', { defaultValue: 'Invalid hash format. Expected 48 hexadecimal characters.' }))
      return
    }

    setTestLoading(true)

    try {
      const loadedQueryImage = await getSimilarityQueryImage(compositeHash)
      setQueryImage(loadedQueryImage)

      const results = await testSimilaritySearch(compositeHash, testMode, {
        duplicateThreshold,
        similarThreshold,
        colorThreshold,
        limit: searchLimit,
      })
      setTestResults(Array.isArray(results) ? results : [])
    } catch {
      setOperationError(t('similarity.test.searchFailed', { defaultValue: 'Failed to run similarity test search.' }))
    } finally {
      setTestLoading(false)
    }
  }

  const getModeLabel = (mode: SimilaritySearchMode) => {
    if (mode === 'duplicates') {
      return t('similarity.test.types.duplicates', { defaultValue: 'Duplicates' })
    }
    if (mode === 'color') {
      return t('similarity.test.types.color', { defaultValue: 'Color' })
    }
    return t('similarity.test.types.similar', { defaultValue: 'Similar' })
  }

  const getMatchTypeLabel = (matchType: string) => {
    if (matchType === 'exact') {
      return t('similarity.test.matchTypes.exact', { defaultValue: 'exact' })
    }
    if (matchType === 'near-duplicate' || matchType === 'nearDuplicate') {
      return t('similarity.test.matchTypes.nearDuplicate', { defaultValue: 'near-duplicate' })
    }
    if (matchType === 'color-similar' || matchType === 'colorSimilar') {
      return t('similarity.test.matchTypes.colorSimilar', { defaultValue: 'color-similar' })
    }

    return t('similarity.test.matchTypes.similar', { defaultValue: 'similar' })
  }

  const getThumbnailUrl = (compositeHash: string | null | undefined, thumbnailUrl: string | null | undefined) => {
    if (thumbnailUrl) {
      return thumbnailUrl
    }
    if (compositeHash) {
      return `/api/images/${compositeHash}/thumbnail`
    }
    return null
  }

  const getDuplicateFileId = (image: DuplicateGroup['images'][number]) => {
    if (typeof image.file_id === 'number') {
      return image.file_id
    }
    if (typeof image.id === 'number') {
      return image.id
    }
    return null
  }

  const getDuplicateGroupFileIds = (group: DuplicateGroup) => {
    return group.images
      .map((image) => getDuplicateFileId(image))
      .filter((fileId): fileId is number => fileId !== null)
  }

  const isDuplicateGroupFullySelected = (group: DuplicateGroup) => {
    const groupFileIds = getDuplicateGroupFileIds(group)
    return groupFileIds.length > 0 && groupFileIds.every((fileId) => selectedDuplicateFileIds.has(fileId))
  }

  const isDuplicateGroupPartiallySelected = (group: DuplicateGroup) => {
    const groupFileIds = getDuplicateGroupFileIds(group)
    const selectedInGroup = groupFileIds.filter((fileId) => selectedDuplicateFileIds.has(fileId)).length
    return selectedInGroup > 0 && selectedInGroup < groupFileIds.length
  }

  const toggleDuplicateImageSelection = (fileId: number) => {
    setSelectedDuplicateFileIds((previous) => {
      const next = new Set(previous)
      if (next.has(fileId)) {
        next.delete(fileId)
      } else {
        next.add(fileId)
      }
      return next
    })
  }

  const toggleDuplicateGroupSelection = (group: DuplicateGroup, shouldSelect: boolean) => {
    const groupFileIds = getDuplicateGroupFileIds(group)
    setSelectedDuplicateFileIds((previous) => {
      const next = new Set(previous)
      groupFileIds.forEach((fileId) => {
        if (shouldSelect) {
          next.add(fileId)
        } else {
          next.delete(fileId)
        }
      })
      return next
    })
  }

  const keepFirstImageInGroup = (group: DuplicateGroup) => {
    const groupFileIds = getDuplicateGroupFileIds(group)
    const removableFileIds = groupFileIds.slice(1)

    if (removableFileIds.length === 0) {
      return
    }

    setSelectedDuplicateFileIds((previous) => {
      const next = new Set(previous)

      groupFileIds.forEach((fileId) => {
        next.delete(fileId)
      })

      removableFileIds.forEach((fileId) => {
        next.add(fileId)
      })
      return next
    })
  }

  const handleRebuildHashes = async () => {
    if (statusControlsDisabled) {
      return
    }

    setOperationError(null)
    setStatusFeedback(null)
    setRebuildingHashes(true)
    setRebuildProgress(0)
    setRebuildProcessed(0)
    setRebuildTotal(0)

    try {
      const snapshot = await getSimilarityStats()
      const totalToProcess = snapshot?.imagesWithoutHash ?? 0

      if (totalToProcess === 0) {
        setStatusFeedback(t('similarity.systemStatus.noImagesToProcess', { defaultValue: 'No images require hash generation.' }))
        return
      }

      setRebuildTotal(totalToProcess)

      let totalProcessed = 0
      let totalFailed = 0
      let remaining = totalToProcess

      while (remaining > 0) {
        const result = await rebuildSimilarityHashes(50)
        if (!result) {
          throw new Error('rebuild_failed')
        }

        totalProcessed += result.processed
        totalFailed += result.failed
        remaining = result.remaining

        const safeProcessed = Math.min(totalProcessed, totalToProcess)
        setRebuildProcessed(safeProcessed)
        setRebuildProgress(totalToProcess > 0 ? Math.round((safeProcessed / totalToProcess) * 100) : 100)

        if (result.processed === 0 && result.remaining > 0) {
          throw new Error('rebuild_stalled')
        }
      }

      const loadedStats = await getSimilarityStats()
      setStats(loadedStats)

      if (totalFailed > 0) {
        setStatusFeedback(t('similarity.systemStatus.rebuildCompleteWithErrors', {
          defaultValue: 'Rebuild completed: {{success}} succeeded, {{failed}} failed.',
          success: totalProcessed,
          failed: totalFailed,
        }))
      } else {
        setStatusFeedback(t('similarity.systemStatus.rebuildComplete', {
          defaultValue: 'Rebuild completed: {{processed}} image hashes generated.',
          processed: totalProcessed,
        }))
      }
    } catch {
      setOperationError(t('similarity.systemStatus.rebuildFailed', { defaultValue: 'Failed to rebuild similarity hashes.' }))
    } finally {
      setRebuildingHashes(false)
    }
  }

  const handleScanDuplicates = async (options?: { preserveFeedback?: boolean }) => {
    setDuplicateScanLoading(true)
    setOperationError(null)
    if (!options?.preserveFeedback) {
      setDuplicateFeedback(null)
    }
    try {
      const groups = await findDuplicateGroups(duplicateThreshold, 2)
      setDuplicateGroups(groups)
      setSelectedDuplicateFileIds(new Set())
    } catch {
      setOperationError(t('similarity.duplicateScan.failed', { defaultValue: 'Failed to scan duplicate groups.' }))
    } finally {
      setDuplicateScanLoading(false)
    }
  }

  const handleDeleteSelectedDuplicateFiles = async () => {
    const fileIds = Array.from(selectedDuplicateFileIds)
    if (fileIds.length === 0 || duplicateDeleteLoading) {
      return
    }

    const isConfirmed = window.confirm(
      `${t('similarity.duplicateScan.deleteConfirmMessage', {
        defaultValue: 'Are you sure you want to delete {{count}} selected images?',
        count: fileIds.length,
      })} ${t('similarity.duplicateScan.deleteWarning', { defaultValue: 'Deleted images cannot be recovered!' })}`,
    )

    if (!isConfirmed) {
      return
    }

    setDuplicateDeleteLoading(true)
    setOperationError(null)
    setDuplicateFeedback(null)

    try {
      const result = await imageApi.deleteImageFiles(fileIds)
      if (!result.success) {
        setOperationError(result.error || t('similarity.duplicateScan.deleteFailed', { defaultValue: 'Failed to delete images.' }))
        return
      }

      const details = result.details as
        | {
            deletedFiles?: unknown[]
            failedFiles?: unknown[]
          }
        | undefined

      const deletedCount = Array.isArray(details?.deletedFiles)
        ? details.deletedFiles.length
        : fileIds.length
      const failedCount = Array.isArray(details?.failedFiles)
        ? details.failedFiles.length
        : Math.max(fileIds.length - deletedCount, 0)

      if (failedCount > 0) {
        setDuplicateFeedback({
          type: 'warning',
          message: t('similarity.duplicateScan.deletePartialSuccess', {
            defaultValue: '{{success}} succeeded, {{failed}} failed',
            success: deletedCount,
            failed: failedCount,
          }),
        })
      } else {
        setDuplicateFeedback({
          type: 'success',
          message: t('similarity.duplicateScan.deleteSuccess', {
            defaultValue: '{{count}} images deleted successfully.',
            count: deletedCount,
          }),
        })
      }

      setSelectedDuplicateFileIds(new Set())
      await handleScanDuplicates({ preserveFeedback: true })

      const refreshedStats = await getSimilarityStats()
      setStats(refreshedStats)
    } catch {
      setOperationError(t('similarity.duplicateScan.deleteFailed', { defaultValue: 'Failed to delete images.' }))
    } finally {
      setDuplicateDeleteLoading(false)
    }
  }

  const handleRefreshStats = async () => {
    if (statusControlsDisabled) {
      return
    }

    setOperationError(null)
    setStatusFeedback(null)
    setRefreshingStats(true)

    try {
      const loadedStats = await getSimilarityStats()
      if (!loadedStats) {
        setOperationError(t('similarity.systemStatus.refreshFailed', { defaultValue: 'Failed to refresh similarity statistics.' }))
        return
      }
      setStats(loadedStats)
    } catch {
      setOperationError(t('similarity.systemStatus.refreshFailed', { defaultValue: 'Failed to refresh similarity statistics.' }))
    } finally {
      setRefreshingStats(false)
    }
  }

  return (
    <section className="space-y-3">
      {operationError ? (
        <Alert variant="destructive">
          <AlertDescription>{operationError}</AlertDescription>
        </Alert>
      ) : null}
      <h3>{t('similarity.title', { defaultValue: 'Image Similarity Search Settings' })}</h3>
      <div className="space-y-2 rounded-md border p-3">
        <h4 className="font-medium">{t('similarity.systemStatus.title', { defaultValue: 'System status' })}</h4>
        <p className="text-sm text-muted-foreground">{t('similarity.systemStatus.description', { defaultValue: 'Current status of the similarity hash system.' })}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={autoGenerateHash ? 'true' : 'false'}
            aria-label={t('similarity.systemStatus.autoGenerateHash', { defaultValue: 'Auto-generate hashes on upload' })}
            disabled={statusControlsDisabled}
            onClick={() => void handleToggle()}
          >
            {updatingAutoGenerate
              ? t('common.loading', { defaultValue: 'Loading...' })
              : t('similarity.systemStatus.autoGenerateHash', { defaultValue: 'Auto-generate hashes on upload' })}
          </button>
          <Button type="button" variant="outline" disabled={statusControlsDisabled} onClick={() => void handleRefreshStats()}>
            {refreshingStats ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {t('similarity.systemStatus.refreshButton', { defaultValue: 'Refresh stats' })}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={statusControlsDisabled || (stats?.imagesWithoutHash ?? 0) === 0}
            onClick={() => void handleRebuildHashes()}
          >
            {rebuildingHashes ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {rebuildingHashes
              ? t('similarity.systemStatus.rebuildingButton', { defaultValue: 'Rebuilding...' })
              : t('similarity.systemStatus.rebuildButton', {
                  defaultValue: 'Rebuild missing hashes ({{count}})',
                  count: stats?.imagesWithoutHash ?? 0,
                })}
          </Button>
        </div>
        {initialLoading ? <p className="text-sm text-muted-foreground">{t('common.loading', { defaultValue: 'Loading...' })}</p> : null}
        {stats ? (
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{t('similarity.systemStatus.totalImages', { defaultValue: 'Total images: {{count}}', count: stats.totalImages })}</Badge>
            <Badge variant="outline">{t('similarity.systemStatus.withHash', { defaultValue: 'With hash: {{count}}', count: stats.imagesWithHash })}</Badge>
            <Badge variant="outline">{t('similarity.systemStatus.withoutHash', { defaultValue: 'Without hash: {{count}}', count: stats.imagesWithoutHash })}</Badge>
            <Badge variant="outline">{t('similarity.systemStatus.completion', { defaultValue: 'Completion: {{percent}}%', percent: stats.completionPercentage })}</Badge>
          </div>
        ) : null}
        {rebuildingHashes && rebuildTotal > 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('similarity.systemStatus.rebuildProgress', {
              defaultValue: 'Rebuilding hashes... {{processed}}/{{total}} ({{percent}}%)',
              processed: rebuildProcessed,
              total: rebuildTotal,
              percent: rebuildProgress,
            })}
          </p>
        ) : null}
        {statusFeedback ? (
          <p className="text-sm text-muted-foreground">
            {statusFeedback}
          </p>
        ) : null}
      </div>

      <div className="border-t" />

      <div className="space-y-2 rounded-md border p-3">
        <h4 className="font-medium">{t('similarity.test.title', { defaultValue: 'Test' })}</h4>
        <p className="text-sm text-muted-foreground">{t('similarity.test.description', { defaultValue: 'Test current settings with a specific image.' })}</p>
        <div className="grid gap-2 md:grid-cols-[1fr_200px]">
          <Input
            placeholder={t('similarity.test.placeholderHash', { defaultValue: 'e.g., abc123def456...' })}
            value={testImageId}
            onChange={(event) => setTestImageId(event.target.value)}
            aria-invalid={testValidationError ? 'true' : 'false'}
          />
          <Select value={testMode} onValueChange={(value: SimilaritySearchMode) => setTestMode(value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('similarity.test.searchType', { defaultValue: 'Search type' })} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="duplicates">{t('similarity.test.types.duplicates', { defaultValue: 'Duplicates' })}</SelectItem>
              <SelectItem value="similar">{t('similarity.test.types.similar', { defaultValue: 'Similar' })}</SelectItem>
              <SelectItem value="color">{t('similarity.test.types.color', { defaultValue: 'Color' })}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {testValidationError ? <p className="text-sm text-destructive">{testValidationError}</p> : null}
        <Button type="button" onClick={() => void handleSimilarityTest()} disabled={testLoading}>
          {testLoading
            ? t('similarity.test.searching', { defaultValue: 'Searching...' })
            : t('similarity.test.searchButton', { defaultValue: 'Run search' })}
        </Button>

        {queryImage ? (
          <Card>
            <CardContent className="space-y-2">
              <p className="text-sm font-medium">{t('similarity.test.queryImage', { defaultValue: 'Query image' })}</p>
              <div className="grid gap-3 md:grid-cols-[120px_1fr]">
                {getThumbnailUrl(queryImage.composite_hash, queryImage.thumbnail_url) ? (
                  <img
                    src={getThumbnailUrl(queryImage.composite_hash, queryImage.thumbnail_url) ?? ''}
                    alt={queryImage.original_file_path ?? queryImage.composite_hash ?? t('similarity.test.queryImage', { defaultValue: 'Query image' })}
                    className="h-24 w-full rounded-md border object-cover"
                  />
                ) : (
                  <div className="flex h-24 items-center justify-center rounded-md border text-xs text-muted-foreground">{t('similarity.test.noPreview', { defaultValue: 'No preview' })}</div>
                )}
                <div className="space-y-1 text-sm">
                  <p><span className="font-medium">{t('similarity.test.imageDetails.hash', { defaultValue: 'Hash:' })}</span> {queryImage.composite_hash ?? '-'}</p>
                  <p className="truncate"><span className="font-medium">{t('similarity.test.imageDetails.filename', { defaultValue: 'File:' })}</span> {queryImage.original_file_path ?? '-'}</p>
                  <p><span className="font-medium">{t('similarity.test.imageDetails.size', { defaultValue: 'Size:' })}</span> {queryImage.width} x {queryImage.height}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {testResults.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('similarity.test.results', { defaultValue: 'Search results: {{count}}', count: testResults.length })}</p>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {testResults.map((result, index) => (
                <ThumbnailCard
                  key={`${result.image.composite_hash ?? index}-${result.image.file_id ?? index}`}
                  ariaLabel={result.image.original_file_path ?? result.image.composite_hash ?? t('similarity.test.resultImage', { defaultValue: 'Result image' })}
                  onClick={() => undefined}
                  className="aspect-auto min-h-[14rem]"
                  preview={getThumbnailUrl(result.image.composite_hash, result.image.thumbnail_url)
                    ? (
                        <img
                          src={getThumbnailUrl(result.image.composite_hash, result.image.thumbnail_url) ?? ''}
                          alt={result.image.original_file_path ?? result.image.composite_hash ?? t('similarity.test.resultImage', { defaultValue: 'Result image' })}
                          className="h-full w-full object-cover"
                        />
                      )
                    : undefined}
                  fallbackPreview={
                    <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                      {t('similarity.test.noPreview', { defaultValue: 'No preview' })}
                    </div>
                  }
                  title={result.image.original_file_path ?? result.image.composite_hash ?? '-'}
                  subtitle={t('similarity.test.similarity', {
                    defaultValue: 'Similarity: {{percent}}%',
                    percent: Number.isFinite(result.similarity) ? result.similarity.toFixed(1) : '-',
                  })}
                  badges={
                    <>
                      <Badge variant="outline">{t('similarity.test.modeLabel', { defaultValue: 'Mode: {{mode}}', mode: getModeLabel(testMode) })}</Badge>
                      {result.matchType
                        ? <Badge variant="outline">{t('similarity.test.matchLabel', { defaultValue: 'Match: {{type}}', type: getMatchTypeLabel(result.matchType) })}</Badge>
                        : null}
                      {typeof result.colorSimilarity === 'number' ? (
                        <Badge variant="outline">
                          {t('similarity.test.colorSimilarity', {
                            defaultValue: 'Color similarity: {{percent}}%',
                            percent: result.colorSimilarity.toFixed(1),
                          })}
                        </Badge>
                      ) : null}
                    </>
                  }
                />
              ))}
            </div>
          </div>
        ) : null}

        {!testLoading && queryImage && testResults.length === 0 ? <p className="text-sm text-muted-foreground">{t('similarity.test.noResults', { defaultValue: 'No similar images found.' })}</p> : null}
      </div>

      <div className="border-t" />

      <div className="space-y-2 rounded-md border p-3">
        <h4 className="font-medium">{t('similarity.duplicateScan.title', { defaultValue: 'Full Duplicate Analysis' })}</h4>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void handleScanDuplicates()} disabled={duplicateScanLoading || duplicateDeleteLoading}>
            {duplicateScanLoading
              ? t('similarity.duplicateScan.scanning', { defaultValue: 'Scanning...' })
              : t('similarity.duplicateScan.scanButton', { defaultValue: 'Run Full Scan' })}
          </Button>
          {selectedDuplicateFileIds.size > 0 ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDeleteSelectedDuplicateFiles()}
              disabled={duplicateDeleteLoading || duplicateScanLoading}
            >
              {duplicateDeleteLoading
                ? t('similarity.duplicateScan.deleting', { defaultValue: 'Deleting...' })
                : t('similarity.duplicateScan.deleteSelected', {
                    defaultValue: 'Delete {{count}} Selected',
                    count: selectedDuplicateFileIds.size,
                  })}
            </Button>
          ) : null}
        </div>

        {duplicateFeedback ? (
          <Alert variant={duplicateFeedback.type === 'warning' ? 'default' : 'default'}>
            <AlertDescription>{duplicateFeedback.message}</AlertDescription>
          </Alert>
        ) : null}

        <p className="text-sm text-muted-foreground">
          {t('similarity.duplicateScan.foundGroups', {
            defaultValue: 'Found Duplicate Groups: {{count}}',
            count: duplicateGroups.length,
          })}
        </p>

        {duplicateGroups.length > 0 ? (
          <div className="space-y-3">
            {duplicateGroups.map((group) => {
              const isFullySelected = isDuplicateGroupFullySelected(group)
              const isPartiallySelected = isDuplicateGroupPartiallySelected(group)

              return (
                <Card key={group.groupId}>
                  <CardContent className="space-y-3 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">
                        {t('similarity.duplicateScan.groupLabel', {
                          defaultValue: 'Group {{id}} • {{count}} images',
                          id: group.groupId,
                          count: group.images.length,
                        })}
                      </p>
                      <Badge variant="outline">
                        {t('similarity.duplicateScan.similarityLabel', {
                          defaultValue: '{{percent}}% similar',
                          percent: Number.isFinite(group.similarity) ? group.similarity.toFixed(1) : '-',
                        })}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant={isFullySelected ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() => toggleDuplicateGroupSelection(group, !isFullySelected)}
                        disabled={duplicateDeleteLoading}
                      >
                        {t('similarity.duplicateScan.selectAll', { defaultValue: 'Select All' })}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => toggleDuplicateGroupSelection(group, false)}
                        disabled={duplicateDeleteLoading || (!isFullySelected && !isPartiallySelected)}
                      >
                        {t('similarity.duplicateScan.deselectAll', { defaultValue: 'Deselect All' })}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => keepFirstImageInGroup(group)}
                        disabled={duplicateDeleteLoading || group.images.length <= 1}
                      >
                        {t('similarity.duplicateScan.keepOneDelete', { defaultValue: 'Keep first image and select rest for deletion' })}
                      </Button>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {group.images.map((image, index) => {
                        const fileId = getDuplicateFileId(image)
                        const isSelected = fileId !== null && selectedDuplicateFileIds.has(fileId)
                        const imageTitle = image.original_file_path
                          ?? image.filename
                          ?? image.composite_hash
                          ?? t('similarity.duplicateScan.imageFallback', {
                            defaultValue: 'Duplicate image {{index}}',
                            index: index + 1,
                          })

                        return (
                          <ThumbnailCard
                            key={`${group.groupId}-${fileId ?? image.composite_hash ?? index}`}
                            ariaLabel={imageTitle}
                            onClick={() => undefined}
                            className={`aspect-auto min-h-[14rem] ${isSelected ? 'border-destructive bg-destructive/10' : ''}`}
                            preview={getThumbnailUrl(image.composite_hash, image.thumbnail_url)
                              ? (
                                  <img
                                    src={getThumbnailUrl(image.composite_hash, image.thumbnail_url) ?? ''}
                                    alt={imageTitle}
                                    className="h-full w-full object-cover"
                                  />
                                )
                              : undefined}
                            fallbackPreview={
                              <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                                {t('similarity.test.noPreview', { defaultValue: 'No preview' })}
                              </div>
                            }
                            selectable
                            selected={isSelected}
                            readOnly={fileId === null || duplicateDeleteLoading}
                            onSelectedChange={() => {
                              if (fileId !== null) {
                                toggleDuplicateImageSelection(fileId)
                              }
                            }}
                            selectionAriaLabel={fileId !== null
                              ? t('similarity.duplicateScan.selectForDelete', {
                                  defaultValue: 'Select for delete (ID: {{id}})',
                                  id: fileId,
                                })
                              : t('similarity.duplicateScan.unselectable', { defaultValue: 'Unselectable image' })}
                            title={imageTitle}
                            subtitle={typeof image.width === 'number' && typeof image.height === 'number'
                              ? `${image.width} x ${image.height}`
                              : undefined}
                            badges={
                              <span className="text-[11px] text-white/90">
                                {fileId !== null
                                  ? t('similarity.duplicateScan.selectForDelete', {
                                      defaultValue: 'Select for delete (ID: {{id}})',
                                      id: fileId,
                                    })
                                  : t('similarity.duplicateScan.unselectable', { defaultValue: 'Unselectable image' })}
                              </span>
                            }
                          />
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ) : null}
      </div>

      <div className="border-t" />

      <div className="space-y-2 rounded-md border p-3">
        <h4 className="font-medium">{t('similarity.thresholds.title', { defaultValue: 'Threshold Settings' })}</h4>
        <label htmlFor="similarity-duplicate-threshold" className="space-y-1 text-sm">
          <span>{t('similarity.thresholds.duplicate.label', { defaultValue: 'Duplicate threshold: {{value}}', value: duplicateThreshold })}</span>
          <input
            id="similarity-duplicate-threshold"
            type="range"
            min={0}
            max={10}
            step={1}
            value={duplicateThreshold}
            onChange={(event) => setDuplicateThreshold(Number(event.target.value))}
            className="w-full"
          />
        </label>
        <label htmlFor="similarity-similar-threshold" className="space-y-1 text-sm">
          <span>{t('similarity.thresholds.similar.label', { defaultValue: 'Similar threshold: {{value}}', value: similarThreshold })}</span>
          <input
            id="similarity-similar-threshold"
            type="range"
            min={5}
            max={25}
            step={1}
            value={similarThreshold}
            onChange={(event) => setSimilarThreshold(Number(event.target.value))}
            className="w-full"
          />
        </label>
        <label htmlFor="similarity-color-threshold" className="space-y-1 text-sm">
          <span>{t('similarity.thresholds.color.label', { defaultValue: 'Color threshold: {{value}}%', value: colorThreshold })}</span>
          <input
            id="similarity-color-threshold"
            type="range"
            min={70}
            max={100}
            step={1}
            value={colorThreshold}
            onChange={(event) => setColorThreshold(Number(event.target.value))}
            className="w-full"
          />
        </label>
        <label htmlFor="similarity-search-limit" className="space-y-1 text-sm">
          <span className="flex items-center justify-between gap-2">
            <span>{t('similarity.thresholds.searchLimit.label', { defaultValue: 'Search result limit' })}</span>
            <span className="text-xs text-muted-foreground">{searchLimit}</span>
          </span>
          <input
            id="similarity-search-limit"
            type="range"
            min={1}
            max={200}
            step={1}
            value={searchLimit}
            onChange={(event) => setSearchLimit(Number(event.target.value))}
            aria-label={t('similarity.thresholds.searchLimit.label', { defaultValue: 'Search result limit' })}
            className="w-full"
          />
        </label>
      </div>
    </section>
  )
}
