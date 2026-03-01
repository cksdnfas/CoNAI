import { useState } from 'react'
import axios from 'axios'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function RatingScoreRecalculation() {
  const { t } = useTranslation('settings')
  const [confirmDialog, setConfirmDialog] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const handleRecalculate = async () => {
    setConfirmDialog(false)
    setError(null)
    setSuccessMessage(null)

    try {
      const response = await axios.post('/api/images/recalculate-rating-scores')
      if (response.data.success) {
        const { total, success_count, fail_count } = response.data.data
        setSuccessMessage(t('rating.recalculation.success', { total, success: success_count, failed: fail_count }))
        return
      }

      setError(response.data.error || t('rating.recalculation.failed'))
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const message = (err.response?.data as { error?: string } | undefined)?.error || t('rating.recalculation.failed')
        setError(message)
        return
      }
      setError(t('rating.recalculation.failed'))
    }
  }

  return (
    <section>
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

      <Button type="button" onClick={() => setConfirmDialog(true)}>
        {t('rating.recalculation.buttons.recalculate')}
      </Button>

      <Dialog open={confirmDialog} onOpenChange={setConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('rating.recalculation.confirmDialog.title')}</DialogTitle>
            <DialogDescription>{t('rating.recalculation.confirmDialog.message')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDialog(false)}>
              {t('rating.recalculation.confirmDialog.cancel')}
            </Button>
            <Button type="button" onClick={handleRecalculate}>
              {t('rating.recalculation.confirmDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
