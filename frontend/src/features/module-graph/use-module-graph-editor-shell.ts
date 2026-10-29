import type { Dispatch, SetStateAction } from 'react'
import { useCallback } from 'react'
import type { Location } from 'react-router-dom'
import { useUnsavedSettingsGuard } from '@/features/settings/use-unsaved-settings-guard'
import { parseImageGenerationTab } from '@/features/image-generation/image-generation-tabs'
import type { WorkflowValidationIssue } from './module-graph-types'
import type { ModuleGraphNode } from './module-graph-shared'

/**
 * Only leaving the workflows tab (another route or tab) is guarded here. Moves inside the tab (graph/edit params, back
 * and forward) go through the workspace, which asks through its own discard confirmation.
 */
function leavesWorkflowsTab(current: Location, next: Location) {
  return current.pathname !== next.pathname || parseImageGenerationTab(new URLSearchParams(current.search).get('tab')) !== parseImageGenerationTab(new URLSearchParams(next.search).get('tab'))
}

/** Own editor navigation, validation focus, and unsaved-change blocking for the module-graph page. */
export function useModuleGraphEditorShell({
  nodes,
  workflowView,
  shouldBlockGraphExit,
  reactFlow,
  confirmMessage,
  setWorkflowView,
  setSelectedNodeId,
  setSelectedEdgeId,
  setSelectedValidationPortKey,
}: {
  nodes: ModuleGraphNode[]
  workflowView: 'browse' | 'edit'
  shouldBlockGraphExit: boolean
  reactFlow: {
    setCenter: (x: number, y: number, options?: { zoom?: number; duration?: number }) => Promise<unknown> | unknown
  }
  confirmMessage: string
  setWorkflowView: (value: 'browse' | 'edit') => void
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>
  setSelectedEdgeId: Dispatch<SetStateAction<string | null>>
  setSelectedValidationPortKey: Dispatch<SetStateAction<string | null>>
}) {
  const enterWorkflowEditor = useCallback(() => {
    setWorkflowView('edit')
  }, [setWorkflowView])

  const focusValidationIssue = useCallback((issue: WorkflowValidationIssue) => {
    if (!issue.nodeId) {
      return
    }

    const focusNode = () => {
      const targetNode = nodes.find((node) => node.id === issue.nodeId)
      if (!targetNode) {
        return
      }

      setSelectedNodeId(targetNode.id)
      setSelectedEdgeId(null)
      setSelectedValidationPortKey(issue.portKey ?? null)
      void reactFlow.setCenter(targetNode.position.x + 180, targetNode.position.y + 80, { zoom: 1.1, duration: 220 })
    }

    if (workflowView !== 'edit') {
      setWorkflowView('edit')
      requestAnimationFrame(() => requestAnimationFrame(focusNode))
      return
    }

    focusNode()
  }, [nodes, reactFlow, setSelectedEdgeId, setSelectedNodeId, setSelectedValidationPortKey, setWorkflowView, workflowView])

  useUnsavedSettingsGuard(shouldBlockGraphExit, confirmMessage, leavesWorkflowsTab)

  return {
    enterWorkflowEditor,
    focusValidationIssue,
  }
}
