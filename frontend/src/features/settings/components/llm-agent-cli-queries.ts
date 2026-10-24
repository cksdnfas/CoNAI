import { useQuery } from '@tanstack/react-query'
import type { AgentRuntimeName } from '@conai/shared'
import { getAgentCliStatus, getAgentCliUsage } from '@/lib/api-agent-cli'

export const agentCliStatusQueryKey = (agent: AgentRuntimeName) => ['agent-cli-status', agent] as const
export const agentCliUsageQueryKey = (agent: AgentRuntimeName) => ['agent-cli-usage', agent] as const

/** Shared status, authentication gating and subscription polling for the rows, dashboard and page assistant. */
export function useAgentCliQueries(agent: AgentRuntimeName) {
  const status = useQuery({
    queryKey: agentCliStatusQueryKey(agent),
    queryFn: () => getAgentCliStatus(agent),
    retry: false,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
  const usage = useQuery({
    queryKey: agentCliUsageQueryKey(agent),
    queryFn: () => agent === 'pi' ? null : getAgentCliUsage(agent),
    enabled: agent !== 'pi' && status.data?.authenticated === true,
    retry: false,
    staleTime: 300_000,
    refetchInterval: 300_000,
  })
  return { status, usage }
}
