import { getMcpToolScope } from '../../mcp/context'
import { TOOL_FEATURE_PERMISSIONS } from '../../mcp/toolAccess'
import { pluginServerTools } from './pluginServerTools'

// Reuse classified native app tools. Private chat/admin/configuration, arbitrary external servers,
// recursive plugin calls and raw backup/restore are not part of the extension grant.
const excluded = /^(?:workspace_|linked_|room_|chat_|get_chat_|list_chat_|propose_|save_lore|read_lore|edit_lore|list_display_|get_display_|get_asset_|offer_choices|page_|get_current_page|read_page_data|workflow_edit|list_workflow_modules|get_workflow_editor|list_plugin_|run_plugin_|get_plugin_|cancel_plugin_|web_|wait_|backup_|restore_|list_backups|import_workflow_definition|export_workflow_definition)/
/**
 * File-store tools (list_files, read_file_text, write_text_file …) are never app tools: `files.read` gives a plugin
 * only the files the person picked when opening it, and a file tool would read or change the whole store behind that.
 */
function isFileStoreTool(name: string) {
  const permissions = TOOL_FEATURE_PERMISSIONS[name as keyof typeof TOOL_FEATURE_PERMISSIONS] as string | readonly string[] | undefined
  return [permissions ?? []].flat().some(permission => permission.startsWith('files.'))
}
/** Trusted plugins (a server module) reach every app tool the requester may use; only the plugin bridge itself stays out. */
const TRUSTED_EXCLUDED = /^(?:list_plugin_|run_plugin_|get_plugin_|cancel_plugin_)/
export function trustedAppToolScope(name: string) {
  return TRUSTED_EXCLUDED.test(name) ? null : getMcpToolScope(name)
}
export function trustedAppTools() {
  return [...Object.keys(TOOL_FEATURE_PERMISSIONS), ...pluginServerTools().map(tool => tool.name)].filter(name => trustedAppToolScope(name)).sort()
}
export function pluginAppToolScope(name: string, trusted = false) {
  if (trusted) return trustedAppToolScope(name)
  if (['workspace_list', 'workspace_read', 'workspace_search'].includes(name)) return 'read' as const
  if (name === 'workspace_apply') return 'organize' as const
  const scope = getMcpToolScope(name)
  if (excluded.test(name) || isFileStoreTool(name) || !Object.prototype.hasOwnProperty.call(TOOL_FEATURE_PERMISSIONS, name) || !['read', 'organize', 'generate'].includes(scope ?? '')) return null
  // Chat-owned proposals need a live chat execution; plugins use their own host review instead.
  if (name === 'posts_propose_knowledge') return null
  return scope as 'read' | 'organize' | 'generate'
}
/** The capability a package must declare to list this app tool (project tools only). */
export function pluginAppToolCapability(name: string) {
  if (name === 'workspace_apply') return 'workspace.write' as const
  return name.startsWith('workspace_') ? 'workspace.read' as const : null
}
export function pluginAppTools() {
  return Object.keys(TOOL_FEATURE_PERMISSIONS).filter(name => pluginAppToolScope(name)).sort()
}
