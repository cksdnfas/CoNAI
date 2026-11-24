import type { ChatProposal, ChatToolCall } from '../types/chat'

/** The tool whose call leaves each kind of card (a stored proposal) under the reply. */
export const CHAT_PROPOSAL_TOOLS: Record<ChatProposal['kind'], string> = {
  display_block: 'propose_display_block',
  skill: 'propose_skill',
  profile: 'propose_chat_profile',
  profile_update: 'propose_profile_update',
  profile_folder: 'manage_chat_profile_folders',
  chat_settings: 'propose_chat_settings',
  profile_assets: 'propose_profile_assets',
  character_assets: 'propose_profile_assets',
  character_library: 'propose_character_library',
  art_style: 'propose_art_style',
  lore: 'save_lore',
  page_fields: 'propose_page_changes',
  workflow_graph: 'propose_workflow_changes',
  page_action: 'propose_page_action',
  task_plan: 'task_propose',
  choice: 'offer_choices',
  form: 'show_form',
}

/** Tools whose call leaves a proposal card under the reply. */
export function isProposalTool(tool: string) {
  return tool.startsWith('propose_') || tool === 'manage_chat_profile_folders' || tool === 'save_lore' || tool === 'offer_choices' || tool === 'show_form'
}

/** A card with no recorded call of its own (a live `card` event, a Codex reply kept as a summary), as a call. */
export function chatProposalCall(proposal: ChatProposal): ChatToolCall {
  return { id: `proposal-${proposal.id}`, tool: CHAT_PROPOSAL_TOOLS[proposal.kind], status: 'completed', arguments: null, summary: null, historyIds: [], compositeHashes: [], proposal }
}
