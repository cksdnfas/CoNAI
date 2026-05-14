import { resolveRoutePermissionKey } from '../features/auth/auth-route-permissions'
import { PAGE_ACCESS_CATALOG, listAccessiblePageAccessItems } from '../features/auth/page-access-catalog'
import {
  canCreateWorkspaceTabItem,
  getWildcardPromptSyntax,
  getWildcardPromptSyntaxLabel,
  getWildcardWorkspacePermissions,
  getWorkspaceTabRecordType,
  isReadonlyWorkspaceTab,
} from '../features/image-generation/components/wildcard-generation-panel-helpers'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function assertDeepEqual<T>(actual: T, expected: T, message: string) {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`)
  }
}

function assertWildcardRoutePermissionSplit() {
  assertEqual(resolveRoutePermissionKey('/wildcards'), 'page.wildcards.view', 'wildcards page should use its standalone page permission')
  assertEqual(resolveRoutePermissionKey('/generation'), 'page.generation.view', 'generation page should keep its own page permission')
  assert(resolveRoutePermissionKey('/wildcards') !== resolveRoutePermissionKey('/generation'), 'wildcards page access must not depend on generation page access')

  const wildcardCatalogEntry = PAGE_ACCESS_CATALOG.find((item) => item.path === '/wildcards')
  assert(wildcardCatalogEntry, 'page access catalog should expose the standalone wildcard page')
  assertEqual(wildcardCatalogEntry.permissionKey, 'page.wildcards.view', 'wildcard catalog entry should use the wildcard page permission')
  assertEqual(wildcardCatalogEntry.category, 'derived', 'wildcard page should stay a derived destination')

  const wildcardOnlyPages = listAccessiblePageAccessItems(['page.wildcards.view']).map((item) => item.path)
  assertDeepEqual(wildcardOnlyPages, ['/wildcards'], 'a guest with only wildcard page permission should open wildcard page without generation access')
}

function assertWildcardActionPermissions() {
  assertDeepEqual(
    getWildcardWorkspacePermissions(['page.wildcards.view']),
    {
      canEditWildcardEntries: false,
      canDeleteWildcardEntries: false,
      canScanLora: false,
    },
    'view-only wildcard permission should not unlock edit, delete, or LoRA scan actions',
  )

  assertDeepEqual(
    getWildcardWorkspacePermissions(['wildcards.edit', 'wildcards.delete']),
    {
      canEditWildcardEntries: true,
      canDeleteWildcardEntries: true,
      canScanLora: false,
    },
    'guest wildcard edit/delete toggles should only unlock wildcard/preprocess mutations',
  )

  assertDeepEqual(
    getWildcardWorkspacePermissions(['wildcards.lora.scan']),
    {
      canEditWildcardEntries: false,
      canDeleteWildcardEntries: false,
      canScanLora: true,
    },
    'LoRA scan must stay isolated behind its dedicated permission',
  )
}

function assertWorkspaceTabContracts() {
  assertEqual(getWorkspaceTabRecordType('wildcards'), 'wildcard', 'wildcards tab should create wildcard records')
  assertEqual(getWorkspaceTabRecordType('preprocess'), 'chain', 'preprocess tab should create chain records')
  assertEqual(getWorkspaceTabRecordType('lora'), 'wildcard', 'LoRA tab should continue reading wildcard records')

  assertEqual(canCreateWorkspaceTabItem('wildcards'), true, 'wildcards tab should allow create controls when edit permission exists')
  assertEqual(canCreateWorkspaceTabItem('preprocess'), true, 'preprocess tab should allow create controls when edit permission exists')
  assertEqual(canCreateWorkspaceTabItem('lora'), false, 'LoRA tab is auto-collected and should not expose create controls')

  assertEqual(isReadonlyWorkspaceTab('wildcards'), false, 'wildcards tab should not be inherently read-only')
  assertEqual(isReadonlyWorkspaceTab('preprocess'), false, 'preprocess tab should not be inherently read-only')
  assertEqual(isReadonlyWorkspaceTab('lora'), true, 'LoRA tab should stay read-only except for the dedicated scan action')

  assertEqual(getWildcardPromptSyntax('subject'), '++subject++', 'wildcard syntax should keep ++name++ wrapping')
  assertEqual(getWildcardPromptSyntax('normalize_subject', { tab: 'preprocess' }), 'normalize_subject', 'preprocess entries should use raw chain syntax')
  assertEqual(getWildcardPromptSyntax('normalize_subject', { type: 'chain' }), 'normalize_subject', 'chain entries should use raw chain syntax')
  assertEqual(
    getWildcardPromptSyntaxLabel({ tab: 'preprocess' }, { preprocess: 'Preprocess keyword', wildcard: 'Wildcard syntax' }),
    'Preprocess keyword',
    'preprocess syntax label should use the preprocess label',
  )
}

assertWildcardRoutePermissionSplit()
assertWildcardActionPermissions()
assertWorkspaceTabContracts()

console.log('Wildcard guest access frontend contracts verified.')
