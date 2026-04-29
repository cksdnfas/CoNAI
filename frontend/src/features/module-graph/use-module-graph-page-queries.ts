import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getAppSettings,
  getGraphExecution,
  getGraphWorkflowBrowseContent,
  getGraphWorkflowExecutions,
  getGraphExecutionStatus,
  getGraphWorkflowFolders,
  getGraphWorkflows,
  getModuleDefinitions,
  type GraphExecutionRecord,
} from '@/lib/api'
import { DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import { useGlobalAppearanceSettingsQuery } from '@/lib/use-global-appearance-settings'

/** Own the data queries and lightweight derived query state used by the module-graph page. */
function isActiveExecutionStatus(status: GraphExecutionRecord['status'] | undefined) {
  return status === 'queued' || status === 'running'
}

export function useModuleGraphPageQueries({
  selectedGraphId,
  selectedExecutionId,
  selectedFolderId,
  workflowView,
}: {
  selectedGraphId: number | null
  selectedExecutionId: number | null
  selectedFolderId: number | null
  workflowView: 'browse' | 'edit'
}) {
  const queryClient = useQueryClient()

  const modulesQuery = useQuery({
    queryKey: ['module-graph-modules'],
    queryFn: () => getModuleDefinitions(true),
  })

  const settingsQuery = useQuery({
    queryKey: ['app-settings', 'module-graph-validation'],
    queryFn: getAppSettings,
  })
  const appearanceQuery = useGlobalAppearanceSettingsQuery()

  const graphWorkflowsQuery = useQuery({
    queryKey: ['module-graph-workflows'],
    queryFn: () => getGraphWorkflows(true),
  })

  const graphWorkflowFoldersQuery = useQuery({
    queryKey: ['module-graph-workflow-folders'],
    queryFn: () => getGraphWorkflowFolders(),
  })

  const graphExecutionsQuery = useQuery({
    queryKey: ['module-graph-executions', selectedGraphId],
    queryFn: () => getGraphWorkflowExecutions(selectedGraphId as number),
    enabled: selectedGraphId !== null,
  })

  const executionDetailQuery = useQuery({
    queryKey: ['module-graph-execution-detail', selectedExecutionId],
    queryFn: () => getGraphExecution(selectedExecutionId as number),
    enabled: selectedExecutionId !== null,
  })

  const selectedExecutionStatus = executionDetailQuery.data?.execution.status
  const executionStatusQuery = useQuery({
    queryKey: ['module-graph-execution-status', selectedExecutionId],
    queryFn: () => getGraphExecutionStatus(selectedExecutionId as number),
    enabled: selectedExecutionId !== null && isActiveExecutionStatus(selectedExecutionStatus),
    refetchInterval: 10_000,
  })

  useEffect(() => {
    const status = executionStatusQuery.data?.status
    if (!selectedExecutionId || isActiveExecutionStatus(status)) {
      return
    }

    void queryClient.invalidateQueries({ queryKey: ['module-graph-execution-detail', selectedExecutionId] })
    if (selectedGraphId !== null) {
      void queryClient.invalidateQueries({ queryKey: ['module-graph-executions', selectedGraphId] })
    }
  }, [executionStatusQuery.data?.status, queryClient, selectedExecutionId, selectedGraphId])

  const browseContentQuery = useQuery({
    queryKey: ['module-graph-browse-content', selectedFolderId ?? 'root'],
    queryFn: () => getGraphWorkflowBrowseContent(selectedFolderId),
    enabled: workflowView === 'browse' && selectedGraphId === null,
    staleTime: 10_000,
  })

  return {
    modulesQuery,
    settingsQuery,
    graphWorkflowsQuery,
    graphWorkflowFoldersQuery,
    graphExecutionsQuery,
    executionDetailQuery,
    browseContentQuery,
    appearanceQuery,
    modules: modulesQuery.data ?? [],
    executionList: graphExecutionsQuery.data ?? [],
    reactFlowColorMode: appearanceQuery.data?.themeMode ?? settingsQuery.data?.appearance.themeMode ?? DEFAULT_APPEARANCE_SETTINGS.themeMode,
  }
}
