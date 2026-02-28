import React, { useState } from 'react'
import { RefreshCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import axios from 'axios'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export const RatingScoreRecalculation: React.FC = () => {
  const { t } = useTranslation('settings')
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [total, setTotal] = useState(0)
  const [confirmDialog, setConfirmDialog] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const handleRecalculate = async () => {
    setConfirmDialog(false)
    setProcessing(true)
    setError(null)
    setSuccessMessage(null)
    setProgress(0)
    setTotal(0)

    try {
      const response = await axios.post('/api/images/recalculate-rating-scores')

      if (response.data.success) {
        const { total: responseTotal, success_count, fail_count } = response.data.data
        setTotal(responseTotal)
        setProgress(responseTotal)
        setSuccessMessage(
          t('rating.recalculation.success', {
            total: responseTotal,
            success: success_count,
            failed: fail_count,
          })
        )
      } else {
        setError(response.data.error || t('rating.recalculation.failed'))
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        setError((err.response?.data as { error?: string } | undefined)?.error || t('rating.recalculation.failed'))
      } else {
        setError(t('rating.recalculation.failed'))
      }
    } finally {
      setProcessing(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('rating.recalculation.title')}</CardTitle>
        <CardDescription>{t('rating.recalculation.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {successMessage ? (
          <Alert>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        ) : null}

        {processing && total > 0 ? (
          <div className="space-y-2">
            <div className="text-sm">{t('rating.recalculation.progress', { current: progress, total })}</div>
            <div className="h-2 w-full rounded bg-muted">
              <div
                className="h-2 rounded bg-primary transition-all"
                style={{ width: `${(progress / total) * 100}%` }}
              />
            </div>
          </div>
        ) : null}

        <Button
          onClick={() => setConfirmDialog(true)}
          disabled={processing}
          className="w-full"
        >
          {processing ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" /> : <RefreshCcw className="h-4 w-4" />}
          {processing ? t('rating.recalculation.buttons.processing') : t('rating.recalculation.buttons.recalculate')}
        </Button>

        <Dialog open={confirmDialog} onOpenChange={setConfirmDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('rating.recalculation.confirmDialog.title')}</DialogTitle>
              <DialogDescription>{t('rating.recalculation.confirmDialog.message')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDialog(false)}>
                {t('rating.recalculation.confirmDialog.cancel')}
              </Button>
              <Button onClick={handleRecalculate}>
                {t('rating.recalculation.confirmDialog.confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
