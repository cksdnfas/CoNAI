import { getUserSettingsDb } from '../../database/userSettingsDb'
import { ExternalApiProvider } from '../../models/ExternalApiProvider'
import { resolveProfileModel } from './chatModelRoles'
import { ChatProfileStore } from './chatProfiles'
import { MODEL_ROLES, ModelSlotStore, type ModelRole } from './modelSlots'

type UsedBy = Array<{ id: number; name: string; roles: ModelRole[] }>

export type ModelUsage = {
  connections: Array<{
    providerName: string
    slots: Array<{ id: number; name: string }>
    /** Profiles that name the connection themselves (a role with no slot). */
    directProfiles: UsedBy
    /** Saved workflow LLM nodes whose profile chats through this connection. */
    workflowNodes: number
  }>
  slots: Array<{ id: number; name: string; profiles: UsedBy; workflowNodes: number }>
}

/** Saved graph-workflow LLM nodes (system.call_llm) per chat profile id; the graphs are JSON documents, so they are parsed. */
function workflowNodesByProfile(): Map<number, number> {
  const db = getUserSettingsDb()
  const counts = new Map<number, number>()
  const llmModules = new Set(
    (db.prepare('SELECT id, internal_fixed_values FROM module_definitions WHERE internal_fixed_values LIKE ?').all('%system.call_llm%') as Array<{ id: number; internal_fixed_values: string | null }>)
      .filter((row) => {
        try { return JSON.parse(row.internal_fixed_values ?? '{}')?.operation_key === 'system.call_llm' } catch { return false }
      })
      .map((row) => row.id),
  )
  if (llmModules.size === 0) return counts
  for (const row of db.prepare('SELECT graph_json FROM graph_workflows WHERE graph_json LIKE ?').iterate('%profile_id%') as Iterable<{ graph_json: string }>) {
    let nodes: unknown
    try { nodes = JSON.parse(row.graph_json)?.nodes } catch { continue }
    if (!Array.isArray(nodes)) continue
    for (const node of nodes) {
      if (!node || !llmModules.has(Number(node.module_id))) continue
      const profileId = Number(node.input_values?.profile_id)
      if (Number.isSafeInteger(profileId) && profileId > 0) counts.set(profileId, (counts.get(profileId) ?? 0) + 1)
    }
  }
  return counts
}

/** Where each LLM connection and model slot is used: by slots, by profiles (per role) and by saved workflow nodes. */
export function buildModelUsage(): ModelUsage {
  const profiles = ChatProfileStore.list()
  const slots = ModelSlotStore.list()
  const nodesByProfile = workflowNodesByProfile()

  const slotNodes = new Map<number, number>()
  const connectionNodes = new Map<string, number>()
  const directByConnection = new Map<string, Map<number, { id: number; name: string; roles: ModelRole[] }>>()
  for (const profile of profiles) {
    const nodes = nodesByProfile.get(profile.id) ?? 0
    const chat = profile.engine === 'llm' ? resolveProfileModel(profile, 'chat') : null
    if (chat && nodes > 0) {
      connectionNodes.set(chat.providerName, (connectionNodes.get(chat.providerName) ?? 0) + nodes)
      if (chat.slotId !== null) slotNodes.set(chat.slotId, (slotNodes.get(chat.slotId) ?? 0) + nodes)
    }
    for (const role of MODEL_ROLES) {
      const resolved = resolveProfileModel(profile, role)
      if (!resolved || resolved.via !== 'direct') continue
      const byProfile = directByConnection.get(resolved.providerName) ?? new Map()
      const entry = byProfile.get(profile.id) ?? { id: profile.id, name: profile.name, roles: [] }
      entry.roles.push(role)
      byProfile.set(profile.id, entry)
      directByConnection.set(resolved.providerName, byProfile)
    }
  }

  const llmConnections = ExternalApiProvider.findAll().filter((provider) => provider.provider_type === 'llm_openai_compatible' || provider.provider_type === 'llm_ollama')
  return {
    connections: llmConnections.map((provider) => ({
      providerName: provider.provider_name,
      slots: slots.filter((slot) => slot.providerName === provider.provider_name).map(({ id, name }) => ({ id, name })),
      directProfiles: [...(directByConnection.get(provider.provider_name)?.values() ?? [])],
      workflowNodes: connectionNodes.get(provider.provider_name) ?? 0,
    })),
    slots: slots.map((slot) => ({ id: slot.id, name: slot.name, profiles: slot.profiles, workflowNodes: slotNodes.get(slot.id) ?? 0 })),
  }
}
