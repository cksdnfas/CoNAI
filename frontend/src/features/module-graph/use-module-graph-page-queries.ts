import { useQuery } from '@tanstack/react-query'
import {
  getAppSettings,
  getGraphExecution,
  getGraphWorkflowBrowseContent,
  getGraphWorkflowExecutions,
  getGraphWorkflowFolders,
  getGraphWorkflows,
  getModuleDefinitions,
  type GraphExecutionRecord,
} from '@/lib/api'
import { DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import { useGlobalAppearanceSettingsQuery } from '@/lib/use-global-appearance-settings'

/** Own the data queries and lightweight derived query state used by the module-graph page. */
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
    refetchInterval: (query) => {
      const records = (query.state.data as GraphExecutionRecord[] | undefined) ?? []
      return records.some((record) => record.status === 'queued' || record.status === 'running') ? 1500 : false
    },
  })

  const executionDetailQuery = useQuery({
    queryKey: ['module-graph-execution-detail', selectedExecutionId],
    queryFn: () => getGraphExecution(selectedExecutionId as number),
    enabled: selectedExecutionId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.execution.status
      return status === 'queued' || status === 'running' ? 1500 : false
    },
  })

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
