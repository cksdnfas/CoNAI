import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'

/** Native endpoints remain authoritative; this only narrows the page's offered operations. */
export function useChatPagePermissions() {
  const auth = useAuthStatusQuery().data
  const has = (key: string) => !!auth?.authenticated && (auth.permissionKeys.includes(key) || auth.hasCredentials === false)
  return { canViewPrompts: has('prompts.view'), canCreatePrompts: has('prompts.create'), canUpdatePrompts: has('prompts.update'), canUpdateWorkflows: has('workflows.update') }
}

export function useChatPageDataPermissions() {
  const auth = useAuthStatusQuery().data
  const has = (key: string) => !!auth?.authenticated && (auth.permissionKeys.includes(key) || auth.hasCredentials === false)
  return { canReadImages: has('images.view'), canReadFiles: has('files.view') }
}
