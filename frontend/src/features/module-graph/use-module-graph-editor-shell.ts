import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { useBeforeUnload, useBlocker } from 'react-router-dom'
import { useBlockerConfirm } from '@/components/ui/use-blocker-confirm'
import { shouldBypassOverlayHistoryBackNavigation } from '@/components/ui/use-overlay-back-close'
import type { WorkflowValidationIssue } from './module-graph-types'
import type { EditorSupportSectionKey } from './module-graph-types'
import type { ModuleGraphNode } from './module-graph-shared'

/** Own editor-support navigation, validation focus, and unsaved-change blocking for the module-graph page. */
export function useModuleGraphEditorShell({
  nodes,
  workflowView,
  shouldBlockGraphExit,
  reactFlow,
  confirmMessage,
  setWorkflowView,
  setIsEditorSupportOpen,
  setActiveEditorSupportSection,
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
  setIsEditorSupportOpen: (value: boolean) => void
  setActiveEditorSupportSection: (section: EditorSupportSectionKey) => void
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>
  setSelectedEdgeId: Dispatch<SetStateAction<string | null>>
  setSelectedValidationPortKey: Dispatch<SetStateAction<string | null>>
}) {
  const editorSupportSectionRefs = useRef<Record<EditorSupportSectionKey, HTMLDivElement | null>>({
    setup: null,
    inspector: null,
    inputs: null,
    validation: null,
    results: null,
  })

  const scrollToEditorSupportSection = useCallback((section: EditorSupportSectionKey, behavior: ScrollBehavior = 'smooth') => {
    setActiveEditorSupportSection(section)
    const target = editorSupportSectionRefs.current[section]
    if (!target) {
      return
    }

    target.scrollIntoView({ behavior, block: 'start' })
  }, [setActiveEditorSupportSection])

  const openEditorSupport = useCallback((section: EditorSupportSectionKey = 'setup') => {
    setIsEditorSupportOpen(true)
    setActiveEditorSupportSection(section)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToEditorSupportSection(section)
      })
    })
  }, [scrollToEditorSupportSection, setActiveEditorSupportSection, setIsEditorSupportOpen])

  const closeEditorSupport = useCallback(() => {
    setIsEditorSupportOpen(false)
  }, [setIsEditorSupportOpen])

  const enterWorkflowEditor = useCallback((section: EditorSupportSectionKey = 'setup') => {
    setWorkflowView('edit')
    setActiveEditorSupportSection(section)
    setIsEditorSupportOpen(false)
  }, [setActiveEditorSupportSection, setIsEditorSupportOpen, setWorkflowView])

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
      setIsEditorSupportOpen(false)
      requestAnimationFrame(() => requestAnimationFrame(focusNode))
      return
    }

    focusNode()
  }, [nodes, reactFlow, setIsEditorSupportOpen, setSelectedEdgeId, setSelectedNodeId, setSelectedValidationPortKey, setWorkflowView, workflowView])

  useEffect(() => {
    if (workflowView !== 'edit') {
      setIsEditorSupportOpen(false)
    }
  }, [setIsEditorSupportOpen, workflowView])

  useBeforeUnload(
    useCallback((event) => {
      if (!shouldBlockGraphExit || shouldBypassOverlayHistoryBackNavigation()) {
        return
      }

      event.preventDefault()
      event.returnValue = ''
    }, [shouldBlockGraphExit]),
  )

  // Only leaving the workflows tab (another route or tab) is blocked here. Moves inside the tab (graph/edit params, back
  // and forward) go through the workspace, which asks through its own discard confirmation.
  const graphExitBlocker = useBlocker(useCallback(({ currentLocation, nextLocation }: { currentLocation: { pathname: string; search: string }; nextLocation: { pathname: string; search: string } }) => {
    if (!shouldBlockGraphExit || shouldBypassOverlayHistoryBackNavigation()) {
      return false
    }
    const currentTab = new URLSearchParams(currentLocation.search).get('tab')
    const nextTab = new URLSearchParams(nextLocation.search).get('tab')
    return currentLocation.pathname !== nextLocation.pathname || currentTab !== nextTab
  }, [shouldBlockGraphExit]))
  useBlockerConfirm(graphExitBlocker, confirmMessage)

  const setEditorSupportSectionRef = useCallback((section: EditorSupportSectionKey, node: HTMLDivElement | null) => {
    editorSupportSectionRefs.current[section] = node
  }, [])

  return {
    closeEditorSupport,
    enterWorkflowEditor,
    focusValidationIssue,
    openEditorSupport,
    scrollToEditorSupportSection,
    setEditorSupportSectionRef,
  }
}
