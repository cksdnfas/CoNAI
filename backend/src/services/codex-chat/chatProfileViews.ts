import { requesterHasRight } from '../../middleware/featureAccess'
import type { ChatProfile } from './chatProfiles'
import { chatExpressionGroupId } from './chatEmoticons'
import { effectiveModelOf, modelLabelOf } from './chatModelRoles'
import { profileAssetFields } from './chatProfileAssets'
import { canSuggest } from './chatSuggestions'

/** Changes whenever the background does, so the image URL can be cached for good. Null: no background. */
export function backgroundVersionOf(profile: ChatProfile) {
  return profile.background || profile.backgroundHash ? `${profile.id}-${profile.backgroundHash?.slice(0, 8) ?? ''}-${Date.parse(profile.updatedDate) || 0}` : null
}

/**
 * What a chat user sees of a profile: enough to pick it and show who is talking (the profile list and the plugin
 * profile reads of a non-admin). `canViewLibrary`: the reader may see the character library, so the library setting
 * the profile looks like is named (its folders and name); others only see the profile.
 */
export function toPublicProfile(profile: ChatProfile, accountId: number | null, canViewLibrary: boolean, hidden?: ReadonlySet<string>) {
  const canViewImages = requesterHasRight({ accountId, accountType: null }, 'read')
  const link = canViewLibrary ? profile.characterLink : null
  return {
    id: profile.id,
    name: profile.name,
    tagline: profile.tagline,
    agentEnabled: profile.agentEnabled,
    agentDescription: profile.agentDescription,
    model: effectiveModelOf(profile),
    modelLabel: modelLabelOf(profile),
    ...profileAssetFields(profile, canViewImages, hidden),
    engine: profile.engine,
    isEnabled: profile.isEnabled,
    contextTurns: profile.contextTurns,
    summaryEnabled: profile.summaryEnabled,
    reactionEnabled: profile.reactionEnabled,
    reactionSlotId: profile.reactionSlotId,
    removedModelRoles: profile.removedModelRoles,
    maxTokens: profile.maxTokens,
    reasoningEffort: profile.reasoningEffort,
    reasoningBudgetTokens: profile.reasoningBudgetTokens,
    loreDepth: profile.loreDepth,
    authorNote: profile.authorNote,
    style: profile.style,
    expressionGroupId: canViewImages ? chatExpressionGroupId(profile) : null,
    backgroundVersion: canViewImages ? backgroundVersionOf(profile) : null,
    // The composer shows the suggestion button only when someone can answer it.
    suggestEnabled: canSuggest(profile, accountId),
    pageAssist: profile.pageAssist,
    characterLink: link ? { settingId: link.settingId, synced: link.synced, settingName: link.settingName, path: link.path } : null,
  }
}
