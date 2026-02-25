import { FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GroupWithStats } from '@comfyui-image-manager/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

interface GroupAssignmentProps {
  selectedGroup: GroupWithStats | null
  onOpenModal: () => void
  onRemove: () => void
}

export function GroupAssignment({ selectedGroup, onOpenModal, onRemove }: GroupAssignmentProps) {
  const { t } = useTranslation(['workflows'])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('workflows:groupAssignment.title')}</CardTitle>
      </CardHeader>
      <Separator />
      <CardContent className="space-y-2 pt-4">
        {selectedGroup ? (
          <div className="flex items-center gap-2">
            <Badge className="gap-1">
              <FolderOpen className="h-3.5 w-3.5" />
              {selectedGroup.name}
            </Badge>
            <Button type="button" variant="outline" size="sm" onClick={onRemove}>
              Remove
            </Button>
          </div>
        ) : (
          <Button type="button" variant="outline" onClick={onOpenModal} className="w-full">
            <FolderOpen className="h-4 w-4" />
            {t('workflows:groupAssignment.selectGroup')}
          </Button>
        )}
        <p className="text-xs text-muted-foreground">{t('workflows:groupAssignment.autoAddDescription')}</p>
      </CardContent>
    </Card>
  )
}
