import type { ReactNode } from 'react'

interface ModuleWorkflowBrowseViewProps {
  isDesktopPageLayout: boolean
  workflowRunnerPanel: ReactNode
  graphExecutionPanel: ReactNode
  browseContentPanel?: ReactNode
}

/** Render the browse-mode content (the workflow list lives in the page sidebar): runner panel and execution results. */
export function ModuleWorkflowBrowseView({
  isDesktopPageLayout,
  workflowRunnerPanel,
  graphExecutionPanel,
  browseContentPanel,
}: ModuleWorkflowBrowseViewProps) {
  return (
    <div className={isDesktopPageLayout ? 'space-y-10' : 'space-y-8'}>
      {workflowRunnerPanel}
      {graphExecutionPanel ?? browseContentPanel}
    </div>
  )
}
