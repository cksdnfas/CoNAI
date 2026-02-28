import React, { useCallback, useEffect, useState } from 'react'
import { CheckCircle, RefreshCw, Search, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { ImageRecord } from '../../../../../types/image'
import type { SimilarImage, SimilarityStats } from '../../../../../services/similarityApi'
import { similarityApi } from '../../../../../services/similarityApi'
import { SimilarityResultsDisplay } from './SimilarityResultsDisplay'

interface SimilarityTestPanelProps {
  testImageId: string
  testLoading: boolean
  testType: 'duplicates' | 'similar' | 'color'
  queryImage: ImageRecord | null
  testResults: SimilarImage[]
  onSetTestImageId: (id: string) => void
  onSetTestType: (type: 'duplicates' | 'similar' | 'color') => void
  onTestSearch: () => void
}

export const SimilarityTestPanel: React.FC<SimilarityTestPanelProps> = ({
  testImageId,
  testLoading,
  testType,
  queryImage,
  testResults,
  onSetTestImageId,
  onSetTestType,
  onTestSearch,
}) => {
  const { t } = useTranslation('settings')
  const [stats, setStats] = useState<SimilarityStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [rebuildLoading, setRebuildLoading] = useState(false)
  const [rebuildMessage, setRebuildMessage] = useState('')
  const [rebuildSuccess, setRebuildSuccess] = useState(false)

  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const data = await similarityApi.getStats()
      setStats(data)
    } finally {
      setStatsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  const handleRebuildHashes = async () => {
    setRebuildLoading(true)
    setRebuildMessage('')
    setRebuildSuccess(false)
    try {
      const result = await similarityApi.rebuildHashes(100)
      setRebuildMessage(
        t('similarity.test.rebuild.success', {
          processed: result.processed,
          failed: result.failed,
          remaining: result.remaining,
        })
      )
      setRebuildSuccess(true)
      await loadStats()
    } catch (error: unknown) {
      const fallback = error instanceof Error ? error.message : 'Unknown error'
      setRebuildMessage(t('similarity.test.rebuild.error', { error: fallback }))
      setRebuildSuccess(false)
    } finally {
      setRebuildLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('similarity.test.title')}</CardTitle>
        <CardDescription>{t('similarity.test.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {statsLoading ? (
          <div className="flex items-center gap-2 text-sm">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
          </div>
        ) : stats ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t('similarity.test.hashStatus')}:</span>
              <Badge variant={stats.completionPercentage >= 100 ? 'default' : 'secondary'}>
                {stats.completionPercentage >= 100 ? <CheckCircle className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />}
                {stats.imagesWithHash} / {stats.totalImages} ({stats.completionPercentage.toFixed(1)}%)
              </Badge>
            </div>

            {stats.completionPercentage < 100 ? (
              <div className="h-2 w-full rounded bg-muted">
                <div className="h-2 rounded bg-primary" style={{ width: `${stats.completionPercentage}%` }} />
              </div>
            ) : null}

            {stats.imagesWithoutHash > 0 ? (
              <Button variant="outline" size="sm" onClick={() => void handleRebuildHashes()} disabled={rebuildLoading}>
                <RefreshCw className="h-4 w-4" />
                {rebuildLoading
                  ? t('similarity.test.rebuild.rebuilding')
                  : t('similarity.test.rebuild.button', { count: stats.imagesWithoutHash })}
              </Button>
            ) : null}

            {rebuildMessage ? (
              <Alert variant={rebuildSuccess ? 'default' : 'destructive'}>
                <AlertDescription>{rebuildMessage}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-2 md:grid-cols-[1fr_180px] md:items-end">
          <div className="space-y-1">
            <label htmlFor="test-image-id" className="text-sm font-medium">
              {t('similarity.test.imageId')}
            </label>
            <Input
              id="test-image-id"
              value={testImageId}
              onChange={(event) => onSetTestImageId(event.target.value)}
              type="text"
              placeholder="e.g., a1b2c3d4e5f6... (48-character composite hash)"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="test-type" className="text-sm font-medium">
              {t('similarity.test.searchType')}
            </label>
            <select
              id="test-type"
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              value={testType}
              onChange={(event) => onSetTestType(event.target.value as 'duplicates' | 'similar' | 'color')}
            >
              <option value="duplicates">{t('similarity.test.types.duplicates')}</option>
              <option value="similar">{t('similarity.test.types.similar')}</option>
              <option value="color">{t('similarity.test.types.color')}</option>
            </select>
          </div>
        </div>

        <Button onClick={onTestSearch} disabled={testLoading || !testImageId}>
          {testLoading ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" /> : <Search className="h-4 w-4" />}
          {testLoading ? t('similarity.test.searching') : t('similarity.test.searchButton')}
        </Button>

        {queryImage ? (
          <SimilarityResultsDisplay queryImage={queryImage} testResults={testResults} />
        ) : null}

        {testResults.length === 0 && testImageId && !testLoading ? (
          <Alert>
            <AlertDescription>{t('similarity.test.noResults')}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}
