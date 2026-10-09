import { judgeSetupOf } from './chatJudge'
import { resolveProfileModel } from './chatModelRoles'
import { ChatProfileStore } from './chatProfiles'

/** A per-turn role that asks the chat's own server before or around each reply. */
export type SharedServerRole = 'judge' | 'translation'

/**
 * The LLM profiles whose reply and a per-turn helper (the judge, translation) go to the same connection, by connection.
 * On a server with one slot the helper's request pushes the chat's prompt out of its cache, so every reply reads the
 * whole prompt again (Settings → LLM warns at the connection's concurrent requests). Resolved as requests resolve them:
 * the default row, a role following the chat model, the judge preset's model.
 */
export function sharedServerProfiles(): Map<string, Array<{ id: number; name: string; roles: SharedServerRole[] }>> {
  const byConnection = new Map<string, Array<{ id: number; name: string; roles: SharedServerRole[] }>>()
  for (const profile of ChatProfileStore.list({ enabledOnly: true })) {
    if (profile.engine !== 'llm') continue
    try {
      const chat = resolveProfileModel(profile, 'chat')
      if (!chat) continue
      const roles: SharedServerRole[] = []
      if (judgeSetupOf(profile)?.providerName === chat.providerName) roles.push('judge')
      if (resolveProfileModel(profile, 'translation')?.providerName === chat.providerName) roles.push('translation')
      if (roles.length === 0) continue
      byConnection.set(chat.providerName, [...(byConnection.get(chat.providerName) ?? []), { id: profile.id, name: profile.name, roles }])
    } catch {
      // A profile whose models no longer resolve shares nothing.
    }
  }
  return byConnection
}
