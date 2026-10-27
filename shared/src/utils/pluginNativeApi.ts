/** Native feature APIs plugins may use. Authentication, credentials and host administration stay outside this bridge. */
export const PLUGIN_NATIVE_API_ROOTS = [
  '/api/images', '/api/groups', '/api/files', '/api/workspaces', '/api/posts', '/api/audio', '/api/sprite',
  '/api/prompt-collection', '/api/prompt-groups', '/api/negative-prompt-groups', '/api/prompt-presets', '/api/wildcards',
  '/api/workflows', '/api/graph-workflows', '/api/module-definitions', '/api/custom-dropdown-lists',
  '/api/workflow-input-assets', '/api/generation-history', '/api/generation-queue', '/api/image-editor',
  '/api/jobs', '/api/page-settings', '/api/runtime-appearance', '/api/runtime-media-settings',
  '/api/settings/general', '/api/settings/appearance',
  '/api/codex-chat/profiles', '/api/codex-chat/threads', '/api/codex-chat/lorebooks',
  '/api/codex-chat/admin/profiles', '/api/codex-chat/admin/lorebooks', '/api/codex-chat/admin/blocks', '/api/codex-chat/admin/chat-assets',
  '/api/chat-routines', '/api/character-library',
] as const

/** Check the original path before URL normalization, so encoded traversal cannot cross a feature boundary. */
export function pluginNativeApiPath(input: string, origins: readonly string[]): string {
  if (typeof input !== 'string' || input.length > 4000 || /[\\\u0000-\u0020#]/.test(input)) throw new Error('앱 API 경로가 올바르지 않아.')
  const rawPath = input.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
  if (!rawPath.startsWith('/api/')) throw new Error('앱의 /api 경로만 사용할 수 있어.')
  for (const part of rawPath.split('/')) {
    const decoded = decodeURIComponent(part)
    if (decoded === '.' || decoded === '..' || /[/\\%\u0000-\u001f]/.test(decoded)) throw new Error('허용하지 않는 앱 API 경로야.')
  }
  const url = new URL(input, origins[0])
  if (!origins.includes(url.origin) || url.username || url.password) throw new Error('다른 서버로 요청할 수 없어.')
  if (!PLUGIN_NATIVE_API_ROOTS.some(root => url.pathname === root || url.pathname.startsWith(`${root}/`))) throw new Error('이 경로는 앱 기능 API가 아니야. 로그인·인증정보·서버 관리는 앱에서 열어줘.')
  return `${url.pathname}${url.search}`
}

export const PLUGIN_REQUEST_TIMEOUT_MS = 10 * 60_000
export const PLUGIN_SDK_FEATURES = ['app.fetch', 'app.cancel', 'app.wait', 'media.open', 'preview', 'storage', 'events', 'navigation', 'request.abort', 'errors.structured', 'llm.asset', 'llm.profile', 'llm.judge', 'llm.decide', 'llm.measure', 'llm.room', 'llm.forgetRooms', 'llm.discard', 'page.form'] as const
