import type { McpRequester } from '../mcp/context'
import { AuthAccount } from '../models/AuthAccount'
import { hasConfiguredAuth } from '../routes/auth-route-helpers'
import { AuthAccessControlService } from './authAccessControlService'

export type AutomationRunAs =
  | { ok: true; requester: McpRequester }
  | { ok: false; code: 'run_as_missing' | 'run_as_unavailable' | 'run_as_forbidden'; message: string }

/**
 * The account a schedule or routine acts as: the person who last saved it. It has to be active and still hold every
 * key in `permissionKeys` at run time, so a demoted or disabled account's automations stop instead of running on.
 * `null` is the bootstrap owner, valid only while no accounts are configured.
 */
export function resolveAutomationRunAs(accountId: number | null | undefined, permissionKeys: string[]): AutomationRunAs {
  if (accountId === null || accountId === undefined) {
    return hasConfiguredAuth()
      ? { ok: false, code: 'run_as_missing', message: '실행 계정이 없어. 다시 저장하면 저장한 계정으로 실행돼.' }
      : { ok: true, requester: { accountId: null, accountType: 'admin' } }
  }
  const account = AuthAccount.findById(accountId)
  if (!account || account.status !== 'active') {
    return { ok: false, code: 'run_as_unavailable', message: '실행 계정을 쓸 수 없어서 멈췄어. 다른 계정으로 다시 저장해줘.' }
  }
  const missing = permissionKeys.filter((key) => !AuthAccessControlService.hasPermission(accountId, key))
  if (missing.length > 0) {
    return { ok: false, code: 'run_as_forbidden', message: `실행 계정에 권한이 없어서 멈췄어: ${missing.join(', ')}` }
  }
  return { ok: true, requester: { accountId, accountType: account.account_type } }
}
