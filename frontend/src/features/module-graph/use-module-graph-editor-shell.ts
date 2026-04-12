import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { useBeforeUnload, useBlocker } from 'react-router-dom'
import type { WorkflowValidationIssue } from './components/workflow-validation-panel'
import type { EditorSupportSectionKey } from './components/module-workflow-editor-support-panel'
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
      if (!shouldBlockGraphExit) {
        return
      }

      event.preventDefault()
      event.returnValue = ''
    }, [shouldBlockGraphExit]),
  )

  const graphExitBlocker = useBlocker(useCallback(() => shouldBlockGraphExit, [shouldBlockGraphExit]))

  useEffect(() => {
    if (graphExitBlocker.state !== 'blocked') {
      return
    }

    if (window.confirm(confirmMessage)) {
      graphExitBlocker.proceed()
      return
    }

    graphExitBlocker.reset()
  }, [confirmMessage, graphExitBlocker])

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
