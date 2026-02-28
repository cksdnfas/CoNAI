import React from 'react'
import { CheckCircle, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { SimilarityStats } from '../../../../../services/similarityApi'

interface SimilaritySystemStatusProps {
  stats: SimilarityStats | null
  rebuilding: boolean
  rebuildProgress: number
  rebuildProcessed: number
  rebuildTotal: number
  autoGenerateHash: boolean
  onAutoGenerateHashChange: (checked: boolean) => void
  onRebuildHashes: () => void
  onRefreshStats: () => void
}

export const SimilaritySystemStatus: React.FC<SimilaritySystemStatusProps> = ({
  stats,
  rebuilding,
  rebuildProgress,
  rebuildProcessed,
  rebuildTotal,
  autoGenerateHash,
  onAutoGenerateHashChange,
  onRebuildHashes,
  onRefreshStats,
}) => {
  const { t } = useTranslation('settings')

  if (!stats) {
    return (
      <div className="flex justify-center py-6">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('similarity.systemStatus.title')}</CardTitle>
        <CardDescription>{t('similarity.systemStatus.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{t('similarity.systemStatus.totalImages', { count: stats.totalImages })}</Badge>
          <Badge>{t('similarity.systemStatus.withHash', { count: stats.imagesWithHash })}</Badge>
          <Badge variant="secondary">{t('similarity.systemStatus.withoutHash', { count: stats.imagesWithoutHash })}</Badge>
          <Badge variant="outline">{t('similarity.systemStatus.completion', { percent: stats.completionPercentage })}</Badge>
        </div>

        {rebuilding ? (
          <div className="space-y-1">
            <div className="text-sm">
              {t('similarity.systemStatus.rebuildProgress', {
                processed: rebuildProcessed,
                total: rebuildTotal,
                percent: rebuildProgress.toFixed(0),
              })}
            </div>
            <div className="h-2 w-full rounded bg-muted">
              <div className="h-2 rounded bg-primary" style={{ width: `${rebuildProgress}%` }} />
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Switch checked={autoGenerateHash} onCheckedChange={onAutoGenerateHashChange} />
          <span className="text-sm">{t('similarity.systemStatus.autoGenerateHash')}</span>
        </div>

        <div className="flex gap-2">
          <Button onClick={onRebuildHashes} disabled={rebuilding || stats.imagesWithoutHash === 0}>
            <RefreshCw className="h-4 w-4" />
            {rebuilding
              ? t('similarity.systemStatus.rebuildingButton')
              : t('similarity.systemStatus.rebuildButton', { count: stats.imagesWithoutHash })}
          </Button>
          <Button variant="outline" onClick={onRefreshStats}>
            <RefreshCw className="h-4 w-4" />
            {t('similarity.systemStatus.refreshButton')}
          </Button>
        </div>

        {stats.imagesWithoutHash === 0 ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Badge>
                    <CheckCircle className="h-3 w-3" />
                    {t('similarity.systemStatus.allCompleteShort')}
                  </Badge>
                </div>
              </TooltipTrigger>
              <TooltipContent>{t('similarity.systemStatus.allComplete')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </CardContent>
    </Card>
  )
}
