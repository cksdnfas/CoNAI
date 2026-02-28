import React from 'react'
import { Edit, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { RatingTier } from '../../../../../types/rating'

interface TierManagementProps {
  tiers: RatingTier[]
  saving: boolean
  onOpenTierDialog: (mode: 'create' | 'edit', tier?: RatingTier) => void
  onDeleteTier: (id: number) => void
}

export const TierManagement: React.FC<TierManagementProps> = ({
  tiers,
  saving,
  onOpenTierDialog,
  onDeleteTier,
}) => {
  const { t } = useTranslation('settings')

  const handleDelete = (id: number) => {
    if (window.confirm(t('rating.tiers.alerts.deleteConfirm'))) {
      onDeleteTier(id)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{t('rating.tiers.title')}</CardTitle>
          <CardDescription>{t('rating.tiers.description')}</CardDescription>
        </div>
        <Button onClick={() => onOpenTierDialog('create')}>
          <Plus className="h-4 w-4" />
          {t('rating.tiers.addButton')}
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('rating.tiers.table.order')}</TableHead>
              <TableHead>{t('rating.tiers.table.name')}</TableHead>
              <TableHead>{t('rating.tiers.table.scoreRange')}</TableHead>
              <TableHead>{t('rating.tiers.table.color')}</TableHead>
              <TableHead className="text-right">{t('rating.tiers.table.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tiers.map((tier) => (
              <TableRow key={tier.id}>
                <TableCell>{tier.tier_order}</TableCell>
                <TableCell>
                  <Badge style={{ backgroundColor: tier.color || undefined, color: '#fff' }}>
                    {tier.tier_name}
                  </Badge>
                </TableCell>
                <TableCell>
                  {t('rating.tiers.table.scoreFormat', {
                    min: tier.min_score,
                    max: tier.max_score !== null ? tier.max_score : t('rating.tiers.table.infinity'),
                  })}
                </TableCell>
                <TableCell>
                  <div
                    className="h-6 w-6 rounded"
                    style={{ backgroundColor: tier.color || '#ccc' }}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => onOpenTierDialog('edit', tier)}
                      disabled={saving}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => handleDelete(tier.id)}
                      disabled={saving}
                      className="text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {tiers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center">
                  {t('rating.tiers.table.empty')}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
