import { CHAT_PAGE_TOOLS, CHAT_ROOM_TOOLS, CHAT_SETTINGS_TOOLS, getMcpToolScope } from '../../mcp/context'
import { TOOL_FEATURE_PERMISSIONS } from '../../mcp/toolAccess'
import { pluginServerTools } from './pluginServerTools'

// These handlers require an active chat/page, or recurse through this bridge. They are unavailable in a
// plugin execution, regardless of account permissions; do not advertise tools that can never run here.
const chatOnly = new Set([
  ...CHAT_PAGE_TOOLS, ...CHAT_ROOM_TOOLS, ...CHAT_SETTINGS_TOOLS,
  'propose_display_block', 'propose_chat_profile', 'propose_profile_update', 'propose_profile_assets',
  'get_asset_batch', 'posts_propose_knowledge', 'web_search', 'web_read',
  'list_plugin_drafts', 'create_plugin_draft', 'read_plugin_draft', 'edit_plugin_draft', 'prepare_plugin_install',
])
/** Enabled plugins are app features. The native tool checks the current account, scope and input. */
export function pluginAppToolScope(name: string) {
  if (chatOnly.has(name) || /^(?:list_plugin_|run_plugin_|get_plugin_|cancel_plugin_)/.test(name)) return null
  if (['workspace_list', 'workspace_read', 'workspace_search'].includes(name)) return 'read' as const
  if (name === 'workspace_apply') return 'organize' as const
  return getMcpToolScope(name)
}
export function pluginAppTools() {
  return [...Object.keys(TOOL_FEATURE_PERMISSIONS), ...pluginServerTools().map(tool => tool.name)].filter(name => pluginAppToolScope(name)).sort()
}
