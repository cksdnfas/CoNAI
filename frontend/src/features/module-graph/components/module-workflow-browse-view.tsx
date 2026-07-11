import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ModuleWorkflowBrowseViewProps {
  isDesktopPageLayout: boolean
  workflowListSidebar: ReactNode
  workflowRunnerPanel: ReactNode
  graphExecutionPanel: ReactNode
  browseContentPanel?: ReactNode
}

/** Render the browse-mode layout with workflow list, runner panel, and execution results. */
export function ModuleWorkflowBrowseView({
  isDesktopPageLayout,
  workflowListSidebar,
  workflowRunnerPanel,
  graphExecutionPanel,
  browseContentPanel,
}: ModuleWorkflowBrowseViewProps) {
  const hasSelectedWorkflow = Boolean(workflowRunnerPanel)

  return (
    <div className={cn('grid gap-6', isDesktopPageLayout ? 'grid-cols-[280px_minmax(0,1fr)]' : 'grid-cols-1')}>
      {workflowListSidebar}
      <div className={cn('grid gap-6', hasSelectedWorkflow && 'xl:grid-cols-[minmax(320px,0.9fr)_minmax(380px,1.1fr)]')}>
        {workflowRunnerPanel}
        {graphExecutionPanel ?? browseContentPanel}
      </div>
    </div>
  )
}
