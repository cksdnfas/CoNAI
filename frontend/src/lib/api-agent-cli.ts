import type { AgentCliName, AgentCliStatus, AgentCliUsage, AgentCliVersion, ClaudeLoginState, ClaudeModelList } from '@conai/shared'
import { requestApiData } from './api-request'

const route = (agent: AgentCliName) => `/api/settings/agent-cli/${agent}`
export const getAgentCliStatus = (agent: AgentCliName) => requestApiData<AgentCliStatus>(`${route(agent)}/status`)
export const getAgentCliUsage = (agent: AgentCliName, refresh = false) => requestApiData<AgentCliUsage>(`${route(agent)}/usage${refresh ? '?refresh=true' : ''}`)
export const getAgentCliVersion = (agent: AgentCliName, refresh = false) => requestApiData<AgentCliVersion>(`${route(agent)}/version${refresh ? '?refresh=true' : ''}`)
export const updateAgentCli = (agent: AgentCliName) => requestApiData<AgentCliVersion>(`${route(agent)}/update`, { method: 'POST' })
export const startClaudeLogin = () => requestApiData<ClaudeLoginState>(`${route('claude')}/login`, { method: 'POST' })
export const getClaudeLogin = () => requestApiData<ClaudeLoginState>(`${route('claude')}/login`)
export const cancelClaudeLogin = () => requestApiData<ClaudeLoginState>(`${route('claude')}/login`, { method: 'DELETE' })
export const submitClaudeLoginCode = (code: string) => requestApiData<ClaudeLoginState>(`${route('claude')}/login/code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
export const getClaudeModels = () => requestApiData<ClaudeModelList>(`${route('claude')}/models`)
