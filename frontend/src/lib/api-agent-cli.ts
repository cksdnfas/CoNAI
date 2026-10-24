import type { AgentCliName, AgentCliStatus, AgentCliUsage, AgentCliVersion, AgentRuntimeName, ClaudeLoginState, ClaudeModelList } from '@conai/shared'
import { requestApiData } from './api-request'

const route = (agent: AgentRuntimeName) => `/api/settings/agent-cli/${agent}`
/** `check` (pi): load the runtime once so a broken install shows. */
export const getAgentCliStatus = (agent: AgentRuntimeName, check = false) => requestApiData<AgentCliStatus>(`${route(agent)}/status${check ? '?check=true' : ''}`, undefined, { timeoutMs: 60000 })
export const getAgentCliUsage = (agent: AgentCliName, refresh = false) => requestApiData<AgentCliUsage>(`${route(agent)}/usage${refresh ? '?refresh=true' : ''}`)
export const refreshAgentCliUsage = (agent: AgentCliName) => requestApiData<AgentCliUsage>(`${route(agent)}/usage/refresh`, { method: 'POST' }, { timeoutMs: 120000 })
export const getAgentCliVersion = (agent: AgentRuntimeName, refresh = false) => requestApiData<AgentCliVersion>(`${route(agent)}/version${refresh ? '?refresh=true' : ''}`, undefined, { timeoutMs: 60000 })
export const updateAgentCli = (agent: AgentRuntimeName) => requestApiData<AgentCliVersion>(`${route(agent)}/update`, { method: 'POST' }, { timeoutMs: 660000 })
export const startClaudeLogin = () => requestApiData<ClaudeLoginState>(`${route('claude')}/login`, { method: 'POST' })
export const getClaudeLogin = () => requestApiData<ClaudeLoginState>(`${route('claude')}/login`)
export const cancelClaudeLogin = () => requestApiData<ClaudeLoginState>(`${route('claude')}/login`, { method: 'DELETE' })
export const submitClaudeLoginCode = (code: string) => requestApiData<ClaudeLoginState>(`${route('claude')}/login/code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
export const getClaudeModels = () => requestApiData<ClaudeModelList>(`${route('claude')}/models`)
