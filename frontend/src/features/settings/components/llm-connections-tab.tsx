import { Fragment, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plug, Plus } from 'lucide-react'
import { MODEL_SLOTS_QUERY_KEY, MODEL_USAGE_QUERY_KEY, getModelUsage, listModelSlots, updateModelRoute } from '@/lib/api-codex-chat'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { getExternalApiProviders } from '@/lib/api-external-api'
import { useI18n } from '@/i18n'
import { RowGroup } from '@/components/ui/row-group'
import { ResourceRow, ResourceRowStatus } from '@/components/ui/resource-row'
import { SettingsEmptyRow, SettingsRowsSkeleton } from './settings-rows'
import { AgentCliSettings } from './agent-cli-settings'
import { ExternalMcpSettings } from './external-mcp-settings'
import { useLlmConnectionsChatPage, type ExternalMcpDraftSeed } from './use-llm-connections-chat-page'
import { LlmConnectionEditorModal, LlmConnectionListItem } from './llm-connections-tab-modals'
import { ConnectionModelEditorModal, ConnectionModelRow, ModelRouteEditorModal, ModelRouteRow, useRefreshModelRows, type ModelRouteModalState } from './llm-connection-models'
import type { LlmConnectionModalState } from './llm-connections-tab-utils'

/**
 * Settings › LLM › 연결: Codex / Claude Code sign-in, the connections with their models, the representative models
 * (대표모델) that route each part to one of them, and outside MCP servers.
 */
export function LlmConnectionsTab() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const [connectionModalState, setConnectionModalState] = useState<LlmConnectionModalState>(null)
  const [editingSlotId, setEditingSlotId] = useState<number | null>(null)
  const [routeModalState, setRouteModalState] = useState<ModelRouteModalState>(null)
  const [mcpSeed, setMcpSeed] = useState<ExternalMcpDraftSeed | null>(null)
  const refreshModelRows = useRefreshModelRows()

  const slotsQuery = useQuery({ queryKey: MODEL_SLOTS_QUERY_KEY, queryFn: listModelSlots })
  const usageQuery = useQuery({ queryKey: MODEL_USAGE_QUERY_KEY, queryFn: getModelUsage })
  const pointRouteMutation = useMutation({
    mutationFn: ({ routeId, targetSlotId }: { routeId: number; targetSlotId: number | null }) => updateModelRoute(routeId, { targetSlotId }),
    onSuccess: () => refreshModelRows(),
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '대표모델을 바꾸지 못했어.', en: 'Could not change the representative model.' }), tone: 'error' })
    },
  })

  const providersQuery = useQuery({
    queryKey: ['external-api-providers', 'settings-llm-connections'],
    queryFn: getExternalApiProviders,
  })

  const refreshProviders = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['external-api-providers'] }),
      queryClient.invalidateQueries({ queryKey: ['external-api-llm-options'] }),
      queryClient.invalidateQueries({ queryKey: ['module-definitions'] }),
      queryClient.invalidateQueries({ queryKey: MODEL_USAGE_QUERY_KEY }),
      refreshModelRows(),
    ])
  }

  const llmProviders = useMemo(
    () => (providersQuery.data ?? []).filter((provider) => provider.provider_type === 'llm_openai_compatible' || provider.provider_type === 'llm_ollama' || provider.provider_type === 'decision_typesafe'),
    [providersQuery.data],
  )

  const slots = slotsQuery.data ?? []
  const models = slots.filter((slot) => slot.kind === 'model')
  const routes = slots.filter((slot) => slot.kind === 'route')
  const slotsOf = (providerName: string) => models.filter((slot) => slot.providerName === providerName)
  const orphanProviders = [...new Set(models.map((slot) => slot.providerName))].filter((name) => providersQuery.isSuccess && !llmProviders.some((provider) => provider.provider_name === name))
  const nodesOf = (slotId: number | undefined) => usageQuery.data?.slots.find((entry) => entry.id === slotId)?.workflowNodes ?? 0
  const editingSlot = models.find((slot) => slot.id === editingSlotId) ?? null
  useLlmConnectionsChatPage({
    providers: llmProviders,
    slots,
    onPointRoute: (routeId, targetSlotId) => pointRouteMutation.mutateAsync({ routeId, targetSlotId }),
    onDraftMcpServer: setMcpSeed,
  })
  const modelRow = (slot: (typeof models)[number]) => (
    <ConnectionModelRow key={slot.id} slot={slot} workflowNodes={nodesOf(slot.id)} onOpen={(next) => setEditingSlotId(next.id)} />
  )

  return (
    <div className="space-y-8">
      <AgentCliSettings />
      <RowGroup
        heading={t('llmConnectionsTab.llmConnections')}
        count={providersQuery.isSuccess ? llmProviders.length : undefined}
        actions={
          <IconButton
            size="icon-sm"
            variant="ghost"
            onClick={() => setConnectionModalState({ mode: 'create' })}
            label={t('llmConnectionsTab.addConnection')}
          >
            <Plus className="h-4 w-4" />
          </IconButton>
        }
      >
        {providersQuery.isLoading ? (
          <SettingsRowsSkeleton rows={3} />
        ) : llmProviders.length === 0 ? (
          <SettingsEmptyRow>{t({ ko: '연결된 LLM이 아직 없어.', en: 'No connected LLMs yet.' })}</SettingsEmptyRow>
        ) : (
          <>
            {llmProviders.map((provider) => (
              <Fragment key={provider.id}>
                <LlmConnectionListItem
                  provider={provider}
                  modelCount={slotsOf(provider.provider_name).length}
                  onOpenOptions={(nextProvider) => setConnectionModalState({ mode: 'edit', provider: nextProvider })}
                />
                {slotsOf(provider.provider_name).map(modelRow)}
              </Fragment>
            ))}
            {/* Models whose connection is gone (only ever left over): listed so they can be seen and replaced. */}
            {orphanProviders.map((providerName) => (
              <Fragment key={providerName}>
                <ResourceRow leading={<Plug />} name={providerName} extra={<ResourceRowStatus tone="destructive">{t({ ko: '연결 없음', en: 'Connection gone' })}</ResourceRowStatus>} />
                {slotsOf(providerName).map(modelRow)}
              </Fragment>
            ))}
          </>
        )}
      </RowGroup>

      <RowGroup
        heading={t({ ko: '대표모델', en: 'Representative models' })}
        count={slotsQuery.isSuccess ? routes.length : undefined}
        actions={
          <IconButton size="icon-sm" variant="ghost" onClick={() => setRouteModalState({ mode: 'create' })} label={t({ ko: '대표모델 추가', en: 'Add representative model' })}>
            <Plus className="h-4 w-4" />
          </IconButton>
        }
      >
        {slotsQuery.isLoading ? <SettingsRowsSkeleton rows={5} /> : routes.map((slot) => (
          <ModelRouteRow key={slot.id} slot={slot} workflowNodes={nodesOf(slot.id)} onOpen={(next) => setRouteModalState({ mode: 'edit', slot: next })} />
        ))}
      </RowGroup>

      <ExternalMcpSettings seed={mcpSeed} onSeedClose={() => setMcpSeed(null)} />

      <ConnectionModelEditorModal slot={editingSlot} workflowNodes={nodesOf(editingSlot?.id)} onClose={() => setEditingSlotId(null)} />

      <ModelRouteEditorModal
        state={routeModalState}
        slots={slots}
        workflowNodes={routeModalState?.mode === 'edit' ? nodesOf(routeModalState.slot.id) : 0}
        onClose={() => setRouteModalState(null)}
      />

      <LlmConnectionEditorModal
        state={connectionModalState}
        onClose={() => setConnectionModalState(null)}
        onChanged={refreshProviders}
      />
    </div>
  )
}
