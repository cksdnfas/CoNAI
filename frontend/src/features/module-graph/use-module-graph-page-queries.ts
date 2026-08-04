import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getGraphExecution,
  getGraphWorkflow,
  getGraphWorkflowBrowseContent,
  getGraphWorkflowExecutions,
  getGraphExecutionStatus,
  getGraphWorkflowFolders,
  getGraphWorkflows,
  getModuleDefinitions,
  type GraphExecutionRecord,
} from '@/lib/api-module-graph'
import { getAppSettings } from '@/lib/api-settings'
import { DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import { resolveStreamFallbackInterval } from '@/features/runtime-events/runtime-event-fallback'
import { useRuntimeEventStream } from '@/features/runtime-events/use-runtime-event-stream'
import { useGlobalAppearanceSettingsQuery } from '@/lib/use-global-appearance-settings'

/** Own the data queries and lightweight derived query state used by the module-graph page. */
function isActiveExecutionStatus(status: GraphExecutionRecord['status'] | undefined) {
  return status === 'queued' || status === 'running'
}

function hasActiveGraphExecution(executions: GraphExecutionRecord[] | undefined) {
  return executions?.some((execution) => isActiveExecutionStatus(execution.status)) === true
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
  // SSE 가 살아 있으면 실행 폴링을 끄고, 끊기면 아래 5초 폴링이 그대로 되살아난다(WF-4).
  const { status: runtimeStreamStatus } = useRuntimeEventStream()

  const modulesQuery = useQuery({
    queryKey: ['module-graph-modules'],
    queryFn: () => getModuleDefinitions(true),
  })

  const settingsQuery = useQuery({
    queryKey: ['app-settings', 'module-graph-validation'],
    queryFn: getAppSettings,
  })
  const appearanceQuery = useGlobalAppearanceSettingsQuery()

  // WF-1: 목록은 요약만 받는다(그래프 문서 없음).
  const graphWorkflowsQuery = useQuery({
    queryKey: ['module-graph-workflows'],
    queryFn: () => getGraphWorkflows(true),
  })

  // WF-1: 선택된 워크플로우 하나만 전체 그래프를 by-id 로 받는다.
  const selectedGraphWorkflowQuery = useQuery({
    queryKey: ['module-graph-workflow-detail', selectedGraphId],
    queryFn: () => getGraphWorkflow(selectedGraphId as number),
    enabled: selectedGraphId !== null,
    // 저장/복제/폴더 이동 뒤에는 `refreshGraphWorkflows` 가 명시적으로 무효화하므로,
    // 그 외의 포커스 복귀마다 그래프 문서를 다시 받을 이유가 없다.
    staleTime: 30_000,
  })

  const graphWorkflowFoldersQuery = useQuery({
    queryKey: ['module-graph-workflow-folders'],
    queryFn: () => getGraphWorkflowFolders(),
  })

  const graphExecutionsQuery = useQuery({
    queryKey: ['module-graph-executions', selectedGraphId],
    queryFn: () => getGraphWorkflowExecutions(selectedGraphId as number),
    enabled: selectedGraphId !== null,
    refetchInterval: (query) => resolveStreamFallbackInterval(
      runtimeStreamStatus,
      hasActiveGraphExecution(query.state.data) ? 5_000 : false,
    ),
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

  /**
   * Refresh both the workflow list and the by-id graph documents.
   * WF-1: 저장/복제/폴더 이동 후에는 목록 요약뿐 아니라 by-id 그래프 캐시도 함께 낡는다.
   */
  const refreshGraphWorkflows = useCallback(async () => {
    await Promise.all([
      graphWorkflowsQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ['module-graph-workflow-detail'] }),
    ])
  }, [graphWorkflowsQuery, queryClient])

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
    selectedGraphWorkflowQuery,
    graphWorkflowFoldersQuery,
    graphExecutionsQuery,
    executionDetailQuery,
    browseContentQuery,
    appearanceQuery,
    refreshGraphWorkflows,
    modules: modulesQuery.data ?? [],
    executionList: graphExecutionsQuery.data ?? [],
    selectedGraphWorkflow: selectedGraphWorkflowQuery.data ?? null,
    reactFlowColorMode: appearanceQuery.data?.themeMode ?? settingsQuery.data?.appearance.themeMode ?? DEFAULT_APPEARANCE_SETTINGS.themeMode,
  }
}
