import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface ModuleWorkflowBrowseViewProps {
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
  return (
    <div className={cn('grid gap-6', isDesktopPageLayout ? 'grid-cols-[320px_minmax(0,1fr)]' : 'grid-cols-1')}>
      {workflowListSidebar}

      <div className="space-y-6">
        {workflowRunnerPanel}
        {graphExecutionPanel ?? browseContentPanel}
      </div>
    </div>
  )
}
