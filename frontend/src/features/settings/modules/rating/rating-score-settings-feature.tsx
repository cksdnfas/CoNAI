import { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
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
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  calculateRatingScore,
  createRatingTier,
  deleteRatingTier,
  getAllRatingTiers,
  getRatingWeights,
  saveRatingWeights,
  updateRatingTier,
  type RatingData,
  type RatingScoreResult,
  type RatingTier,
  type RatingTierInput,
  type RatingWeights,
  type RatingWeightsUpdate,
} from './rating-score-api'
import { RatingScoreRecalculation } from './rating-score-recalculation'

const EXAMPLE_RATING: RatingData = {
  general: 0.001,
  sensitive: 0.045,
  questionable: 0.735,
  explicit: 0.47,
}

interface TierDialogState {
  open: boolean
  mode: 'create' | 'edit'
  editId?: number
  tier: Partial<RatingTierInput>
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function getTierTextColor(color: string | null | undefined): string {
  if (!color || !/^#([0-9a-fA-F]{6})$/.test(color)) {
    return '#111827'
  }

  const hex = color.slice(1)
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255

  return luminance > 0.58 ? '#111827' : '#F9FAFB'
}

export default function RatingScoreSettingsFeature() {
  const { t } = useTranslation('settings')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [weights, setWeights] = useState<RatingWeights | null>(null)
  const [localWeights, setLocalWeights] = useState<RatingWeightsUpdate>({})
  const [tiers, setTiers] = useState<RatingTier[]>([])
  const [tierDialog, setTierDialog] = useState<TierDialogState>({
    open: false,
    mode: 'create',
    tier: {},
  })
  const [testRating, setTestRating] = useState<RatingData>(EXAMPLE_RATING)
  const [testResult, setTestResult] = useState<RatingScoreResult | null>(null)
  const [testLoading, setTestLoading] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [loadedWeights, loadedTiers] = await Promise.all([
          getRatingWeights(),
          getAllRatingTiers(),
        ])
        setWeights(loadedWeights)
        setTiers(loadedTiers)
      } catch {
        setMessage({ type: 'error', text: t('rating.weights.alerts.loadFailed') })
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [t])

  const currentWeights = useMemo(() => {
    if (!weights) {
      return {
        general: 25,
        sensitive: 25,
        questionable: 25,
        explicit: 25,
      }
    }

    return {
      general: localWeights.general_weight ?? weights.general_weight,
      sensitive: localWeights.sensitive_weight ?? weights.sensitive_weight,
      questionable: localWeights.questionable_weight ?? weights.questionable_weight,
      explicit: localWeights.explicit_weight ?? weights.explicit_weight,
    }
  }, [localWeights, weights])

  const totalWeight = useMemo(() => {
    return currentWeights.general + currentWeights.sensitive + currentWeights.questionable + currentWeights.explicit
  }, [currentWeights])

  const weightsHasChanges = useMemo(() => {
    return Object.values(localWeights).some((value) => value !== undefined)
  }, [localWeights])

  const updateWeight = (field: keyof RatingWeightsUpdate, value: string) => {
    const parsed = Number.parseInt(value, 10)
    if (Number.isNaN(parsed)) {
      return
    }

    setLocalWeights((previous) => ({
      ...previous,
      [field]: Math.max(0, Math.min(100, parsed)),
    }))
  }

  const handleSave = async () => {
    if (!weights) {
      return
    }

    if (totalWeight !== 100) {
      setMessage({ type: 'error', text: 'Total weight must equal 100.' })
      return
    }

    if (!weightsHasChanges) {
      return
    }

    setSaving(true)
    try {
      const updated = await saveRatingWeights(localWeights)
      setWeights(updated)
      setLocalWeights({})
      setMessage({ type: 'success', text: t('rating.weights.alerts.saveSuccess') })
    } catch {
      setMessage({ type: 'error', text: t('rating.weights.alerts.saveFailed') })
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setLocalWeights({})
  }

  const handleOpenTierDialog = (mode: 'create' | 'edit', tier?: RatingTier) => {
    if (mode === 'edit' && tier) {
      setTierDialog({
        open: true,
        mode,
        editId: tier.id,
        tier: {
          tier_name: tier.tier_name,
          min_score: tier.min_score,
          max_score: tier.max_score,
          tier_order: tier.tier_order,
          color: tier.color,
        },
      })
      return
    }

    const nextOrder = tiers.length > 0 ? Math.max(...tiers.map((item) => item.tier_order)) + 1 : 1
    setTierDialog({
      open: true,
      mode,
      tier: {
        tier_name: '',
        min_score: 0,
        max_score: null,
        tier_order: nextOrder,
        color: '#2196f3',
      },
    })
  }

  const handleSaveTier = async () => {
    const candidate = tierDialog.tier
    if (!candidate.tier_name || !isFiniteNumber(candidate.min_score) || !isFiniteNumber(candidate.tier_order)) {
      setMessage({ type: 'error', text: t('rating.tiers.dialog.requiredFields') })
      return
    }

    setSaving(true)
    try {
      if (tierDialog.mode === 'create') {
        const created = await createRatingTier({
          tier_name: candidate.tier_name,
          min_score: candidate.min_score,
          max_score: candidate.max_score ?? null,
          tier_order: candidate.tier_order,
          color: candidate.color ?? null,
        })
        setTiers((previous) => [...previous, created].sort((a, b) => a.tier_order - b.tier_order))
        setMessage({ type: 'success', text: t('rating.tiers.alerts.created') })
      } else if (tierDialog.editId) {
        const updated = await updateRatingTier(tierDialog.editId, {
          tier_name: candidate.tier_name,
          min_score: candidate.min_score,
          max_score: candidate.max_score ?? null,
          tier_order: candidate.tier_order,
          color: candidate.color ?? null,
        })

        setTiers((previous) => previous.map((item) => (item.id === updated.id ? updated : item)).sort((a, b) => a.tier_order - b.tier_order))
        setMessage({ type: 'success', text: t('rating.tiers.alerts.updated') })
      }

      setTierDialog({ open: false, mode: 'create', tier: {} })
    } catch {
      setMessage({ type: 'error', text: t('rating.tiers.alerts.saveFailed') })
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteTier = async (tierId: number) => {
    if (!window.confirm(t('rating.tiers.alerts.deleteConfirm'))) {
      return
    }

    setSaving(true)
    try {
      await deleteRatingTier(tierId)
      setTiers((previous) => previous.filter((item) => item.id !== tierId))
      setMessage({ type: 'success', text: t('rating.tiers.alerts.deleted') })
    } catch {
      setMessage({ type: 'error', text: t('rating.tiers.alerts.deleteFailed') })
    } finally {
      setSaving(false)
    }
  }

  const handleCalculate = async () => {
    setTestLoading(true)
    try {
      const result = await calculateRatingScore(testRating)
      setTestResult(result)
    } catch {
      setMessage({ type: 'error', text: t('rating.calculator.failed') })
    } finally {
      setTestLoading(false)
    }
  }

  const updateTestRating = (field: keyof RatingData, value: string) => {
    const parsed = Number.parseFloat(value)
    if (Number.isNaN(parsed)) {
      return
    }

    setTestRating((previous) => ({
      ...previous,
      [field]: Math.max(0, Math.min(1, parsed)),
    }))
  }

  return (
    <div className="space-y-6">
      {message ? (
        <Alert variant={message.type === 'error' ? 'destructive' : 'default'}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('rating.weights.title')}</CardTitle>
          <CardDescription>{t('rating.weights.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}

          <div className="grid gap-4 md:grid-cols-2">
            <label htmlFor="rating-weight-general" className="grid gap-2 text-sm">
              <span className="font-medium leading-none">{t('rating.weights.general', { value: currentWeights.general })}</span>
              <input
                id="rating-weight-general"
                type="range"
                min={0}
                max={100}
                step={1}
                value={currentWeights.general}
                onChange={(event) => updateWeight('general_weight', event.target.value)}
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>0</span>
                <span>{currentWeights.general}</span>
                <span>100</span>
              </div>
            </label>
            <label htmlFor="rating-weight-sensitive" className="grid gap-2 text-sm">
              <span className="font-medium leading-none">{t('rating.weights.sensitive', { value: currentWeights.sensitive })}</span>
              <input
                id="rating-weight-sensitive"
                type="range"
                min={0}
                max={100}
                step={1}
                value={currentWeights.sensitive}
                onChange={(event) => updateWeight('sensitive_weight', event.target.value)}
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>0</span>
                <span>{currentWeights.sensitive}</span>
                <span>100</span>
              </div>
            </label>
            <label htmlFor="rating-weight-questionable" className="grid gap-2 text-sm">
              <span className="font-medium leading-none">{t('rating.weights.questionable', { value: currentWeights.questionable })}</span>
              <input
                id="rating-weight-questionable"
                type="range"
                min={0}
                max={100}
                step={1}
                value={currentWeights.questionable}
                onChange={(event) => updateWeight('questionable_weight', event.target.value)}
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>0</span>
                <span>{currentWeights.questionable}</span>
                <span>100</span>
              </div>
            </label>
            <label htmlFor="rating-weight-explicit" className="grid gap-2 text-sm">
              <span className="font-medium leading-none">{t('rating.weights.explicit', { value: currentWeights.explicit })}</span>
              <input
                id="rating-weight-explicit"
                type="range"
                min={0}
                max={100}
                step={1}
                value={currentWeights.explicit}
                onChange={(event) => updateWeight('explicit_weight', event.target.value)}
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>0</span>
                <span>{currentWeights.explicit}</span>
                <span>100</span>
              </div>
            </label>
          </div>

          <p className="text-xs text-muted-foreground">Total: {totalWeight} / 100</p>

          <div className="flex gap-2 pt-1">
            <Button type="button" onClick={() => void handleSave()} disabled={!weightsHasChanges || saving}>{t('rating.weights.buttons.save')}</Button>
            <Button type="button" variant="outline" onClick={handleReset} disabled={!weightsHasChanges || saving}>{t('rating.weights.buttons.cancel')}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('rating.tiers.title')}</CardTitle>
          <CardDescription>{t('rating.tiers.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-end">
            <Button type="button" onClick={() => handleOpenTierDialog('create')}>{t('rating.tiers.addButton')}</Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('rating.tiers.table.order')}</TableHead>
                <TableHead>{t('rating.tiers.table.name')}</TableHead>
                <TableHead>{t('rating.tiers.table.scoreRange')}</TableHead>
                <TableHead>{t('rating.tiers.table.color')}</TableHead>
                <TableHead>{t('rating.tiers.table.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tiers.map((tier) => (
                <TableRow key={tier.id}>
                  <TableCell>{tier.tier_order}</TableCell>
                  <TableCell>
                    <Badge
                      className="border-0 font-semibold"
                      style={{
                        backgroundColor: tier.color || '#9CA3AF',
                        color: getTierTextColor(tier.color),
                      }}
                    >
                      {tier.tier_name}
                    </Badge>
                  </TableCell>
                  <TableCell>{t('rating.tiers.table.scoreFormat', { min: tier.min_score, max: tier.max_score ?? t('rating.tiers.table.infinity') })}</TableCell>
                  <TableCell>
                    <div className="h-5 w-5 rounded" style={{ backgroundColor: tier.color || '#ccc' }} />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button type="button" variant="outline" size="sm" onClick={() => handleOpenTierDialog('edit', tier)} disabled={saving}>{t('rating.tiers.dialog.editTitle')}</Button>
                      <Button type="button" variant="destructive" size="sm" onClick={() => void handleDeleteTier(tier.id)} disabled={saving}>{t('common.delete')}</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {tiers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">{t('rating.tiers.table.empty')}</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('rating.calculator.title')}</CardTitle>
          <CardDescription>{t('rating.calculator.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label htmlFor="rating-calc-general" className="grid gap-2 text-sm">
              <span className="font-medium leading-none">{t('rating.calculator.general', { value: testRating.general.toFixed(3) })}</span>
              <Input id="rating-calc-general" type="number" min={0} max={1} step={0.001} value={testRating.general} onChange={(event) => updateTestRating('general', event.target.value)} />
            </label>
            <label htmlFor="rating-calc-sensitive" className="grid gap-2 text-sm">
              <span className="font-medium leading-none">{t('rating.calculator.sensitive', { value: testRating.sensitive.toFixed(3) })}</span>
              <Input id="rating-calc-sensitive" type="number" min={0} max={1} step={0.001} value={testRating.sensitive} onChange={(event) => updateTestRating('sensitive', event.target.value)} />
            </label>
            <label htmlFor="rating-calc-questionable" className="grid gap-2 text-sm">
              <span className="font-medium leading-none">{t('rating.calculator.questionable', { value: testRating.questionable.toFixed(3) })}</span>
              <Input id="rating-calc-questionable" type="number" min={0} max={1} step={0.001} value={testRating.questionable} onChange={(event) => updateTestRating('questionable', event.target.value)} />
            </label>
            <label htmlFor="rating-calc-explicit" className="grid gap-2 text-sm">
              <span className="font-medium leading-none">{t('rating.calculator.explicit', { value: testRating.explicit.toFixed(3) })}</span>
              <Input id="rating-calc-explicit" type="number" min={0} max={1} step={0.001} value={testRating.explicit} onChange={(event) => updateTestRating('explicit', event.target.value)} />
            </label>
          </div>

          <Button type="button" onClick={() => void handleCalculate()} disabled={testLoading}>
            {testLoading ? t('rating.calculator.calculating') : t('rating.calculator.calculate')}
          </Button>

          {testResult ? (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <p>
                <Trans
                  ns="settings"
                  i18nKey="rating.calculator.result.score"
                  values={{ score: testResult.score.toFixed(2) }}
                  components={{ strong: <strong className="font-semibold text-foreground" /> }}
                />
              </p>
              {testResult.tier ? (
                <Badge
                  className="border-0 font-semibold"
                  style={{
                    backgroundColor: testResult.tier.color || '#9CA3AF',
                    color: getTierTextColor(testResult.tier.color),
                  }}
                >
                  {testResult.tier.tier_name}
                </Badge>
              ) : null}
              <div className="space-y-1 pt-1">
                <p className="text-xs font-medium text-muted-foreground">{t('rating.calculator.result.breakdown')}</p>
                <p className="text-xs text-muted-foreground">{t('rating.calculator.result.generalScore', { score: testResult.breakdown.general.toFixed(3) })}</p>
                <p className="text-xs text-muted-foreground">{t('rating.calculator.result.sensitiveScore', { score: testResult.breakdown.sensitive.toFixed(3) })}</p>
                <p className="text-xs text-muted-foreground">{t('rating.calculator.result.questionableScore', { score: testResult.breakdown.questionable.toFixed(3) })}</p>
                <p className="text-xs text-muted-foreground">{t('rating.calculator.result.explicitScore', { score: testResult.breakdown.explicit.toFixed(3) })}</p>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={tierDialog.open} onOpenChange={(open) => setTierDialog((previous) => ({ ...previous, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tierDialog.mode === 'create' ? t('rating.tiers.dialog.createTitle') : t('rating.tiers.dialog.editTitle')}</DialogTitle>
            <DialogDescription>{t('rating.tiers.description')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <label htmlFor="rating-tier-name" className="grid gap-2 text-sm">
              <span className="font-medium leading-none">{t('rating.tiers.dialog.tierName')}</span>
              <Input
                id="rating-tier-name"
                value={tierDialog.tier.tier_name || ''}
                onChange={(event) => setTierDialog((previous) => ({ ...previous, tier: { ...previous.tier, tier_name: event.target.value } }))}
              />
            </label>
            <label htmlFor="rating-tier-min" className="grid gap-2 text-sm">
              <span className="font-medium leading-none">{t('rating.tiers.dialog.minScore')}</span>
              <Input
                id="rating-tier-min"
                type="number"
                value={tierDialog.tier.min_score ?? ''}
                onChange={(event) => setTierDialog((previous) => ({ ...previous, tier: { ...previous.tier, min_score: Number.parseFloat(event.target.value) } }))}
              />
            </label>
            <label htmlFor="rating-tier-max" className="grid gap-2 text-sm">
              <span className="font-medium leading-none">{t('rating.tiers.dialog.maxScore')}</span>
              <Input
                id="rating-tier-max"
                type="number"
                value={tierDialog.tier.max_score ?? ''}
                onChange={(event) => setTierDialog((previous) => ({
                  ...previous,
                  tier: {
                    ...previous.tier,
                    max_score: event.target.value.trim().length === 0 ? null : Number.parseFloat(event.target.value),
                  },
                }))}
              />
            </label>
            <label htmlFor="rating-tier-order" className="grid gap-2 text-sm">
              <span className="font-medium leading-none">{t('rating.tiers.dialog.order')}</span>
              <Input
                id="rating-tier-order"
                type="number"
                value={tierDialog.tier.tier_order ?? ''}
                onChange={(event) => setTierDialog((previous) => ({ ...previous, tier: { ...previous.tier, tier_order: Number.parseInt(event.target.value, 10) } }))}
              />
            </label>
            <label htmlFor="rating-tier-color" className="grid gap-2 text-sm">
              <span className="font-medium leading-none">{t('rating.tiers.dialog.color')}</span>
              <Input
                id="rating-tier-color"
                value={tierDialog.tier.color || ''}
                placeholder={t('rating.tiers.dialog.colorPlaceholder')}
                onChange={(event) => setTierDialog((previous) => ({ ...previous, tier: { ...previous.tier, color: event.target.value } }))}
              />
            </label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTierDialog((previous) => ({ ...previous, open: false }))}>{t('rating.tiers.dialog.cancel')}</Button>
            <Button type="button" onClick={() => void handleSaveTier()} disabled={saving}>{t('rating.tiers.dialog.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RatingScoreRecalculation />
    </div>
  )
}
