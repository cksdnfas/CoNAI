import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Workflow } from '@/services/workflow-api'

interface WorkflowHeaderProps {
  workflow: Workflow
}

export function WorkflowHeader({ workflow }: WorkflowHeaderProps) {
  const navigate = useNavigate()
  const { t } = useTranslation(['workflows'])

  return (
    <div className="mb-3 flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => navigate('/image-generation?tab=workflows')}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <div className="flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">{workflow.name}</h1>
        {workflow.description ? (
          <p className="text-sm text-muted-foreground">
            {workflow.description}
          </p>
        ) : null}
      </div>
      {!workflow.is_active ? <Badge variant="secondary">{t('workflows:card.inactive')}</Badge> : null}
    </div>
  )
}
