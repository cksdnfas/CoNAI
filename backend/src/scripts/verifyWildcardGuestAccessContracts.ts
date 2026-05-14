import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.RUNTIME_BASE_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-wildcard-guest-access-'))
process.env.RUNTIME_DATABASE_DIR = path.join(process.env.RUNTIME_BASE_PATH, 'database')

type AuthDbModule = typeof import('../database/authDb')
type AuthPermissionGroupModule = typeof import('../models/AuthPermissionGroup')

const WILDCARD_VIEW_PERMISSION = 'page.wildcards.view'
const WILDCARD_EDIT_PERMISSION = 'wildcards.edit'
const WILDCARD_DELETE_PERMISSION = 'wildcards.delete'
const WILDCARD_LORA_SCAN_PERMISSION = 'wildcards.lora.scan'

function assertIncludes(source: string, expected: string, message: string) {
  assert.ok(source.includes(expected), `${message}: missing ${expected}`)
}

function assertNotIncludes(source: string, unexpected: string, message: string) {
  assert.ok(!source.includes(unexpected), `${message}: found ${unexpected}`)
}

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

function assertWildcardRouteGuards() {
  const readRoutes = readSource('src/routes/wildcards.read.routes.ts')
  const mutationRoutes = readSource('src/routes/wildcards.mutation.routes.ts')
  const utilityRoutes = readSource('src/routes/wildcards.utility.routes.ts')
  const registerRoutes = readSource('src/startup/registerAppRoutes.ts')

  assertIncludes(readRoutes, `router.use(requirePermission('${WILDCARD_VIEW_PERMISSION}'))`, 'wildcard read routes should be guarded by standalone wildcard view permission')
  assertIncludes(utilityRoutes, `router.post('/parse', requirePermission('${WILDCARD_VIEW_PERMISSION}')`, 'wildcard parse preview should be available to wildcard page viewers')
  assertIncludes(utilityRoutes, `router.post('/scan-lora-folder', requirePermission('${WILDCARD_LORA_SCAN_PERMISSION}')`, 'LoRA scan should require the dedicated scan permission')
  assertIncludes(mutationRoutes, `router.post('/', requirePermission('${WILDCARD_EDIT_PERMISSION}')`, 'wildcard create should require edit permission')
  assertIncludes(mutationRoutes, `router.put('/:id', requirePermission('${WILDCARD_EDIT_PERMISSION}')`, 'wildcard update should require edit permission')
  assertIncludes(mutationRoutes, `router.delete('/:id', requirePermission('${WILDCARD_DELETE_PERMISSION}')`, 'wildcard delete should require delete permission')

  assertIncludes(registerRoutes, "app.use('/api/wildcards', optionalAuth, wildcardUtilityRoutes);", 'wildcard utility routes should mount independently under optional auth')
  assertIncludes(registerRoutes, "app.use('/api/wildcards', optionalAuth, wildcardMutationRoutes);", 'wildcard mutation routes should mount independently under optional auth')
  assertIncludes(registerRoutes, "app.use('/api/wildcards', optionalAuth, wildcardReadRoutes);", 'wildcard read routes should mount independently under optional auth')

  assertNotIncludes(readRoutes, "page.generation.view", 'wildcard read routes must not depend on generation page permission')
  assertNotIncludes(mutationRoutes, "page.generation.view", 'wildcard mutation routes must not depend on generation page permission')
  assertNotIncludes(utilityRoutes, "page.generation.view", 'wildcard utility routes must not depend on generation page permission')
}

function getPermissionKeys(records: Array<{ permission_key: string }>) {
  return records.map((record) => record.permission_key)
}

function assertHasPermission(keys: string[], permissionKey: string, message: string) {
  assert.ok(keys.includes(permissionKey), message)
}

function assertLacksPermission(keys: string[], permissionKey: string, message: string) {
  assert.ok(!keys.includes(permissionKey), message)
}

function assertPermissionCatalog(AuthPermissionGroup: AuthPermissionGroupModule['AuthPermissionGroup']) {
  const pagePermissionKeys = getPermissionKeys(AuthPermissionGroup.listPagePermissions())
  assertHasPermission(pagePermissionKeys, WILDCARD_VIEW_PERMISSION, 'permission catalog should include wildcard page view permission')

  const editablePermissionKeys = getPermissionKeys(AuthPermissionGroup.listBuiltInEditablePermissions())
  assertHasPermission(editablePermissionKeys, WILDCARD_VIEW_PERMISSION, 'guest built-in editor should expose wildcard page view')
  assertHasPermission(editablePermissionKeys, WILDCARD_EDIT_PERMISSION, 'guest built-in editor should expose wildcard edit')
  assertHasPermission(editablePermissionKeys, WILDCARD_DELETE_PERMISSION, 'guest built-in editor should expose wildcard delete')
  assertLacksPermission(editablePermissionKeys, WILDCARD_LORA_SCAN_PERMISSION, 'guest built-in editor should not expose LoRA scan')
}

function assertBuiltInGroupRules(AuthPermissionGroup: AuthPermissionGroupModule['AuthPermissionGroup']) {
  const guestAccess = AuthPermissionGroup.replaceBuiltInPageAccess('guest', [
    WILDCARD_VIEW_PERMISSION,
    WILDCARD_EDIT_PERMISSION,
    WILDCARD_DELETE_PERMISSION,
  ])
  assert.deepEqual(
    new Set(guestAccess.permission_keys),
    new Set([WILDCARD_VIEW_PERMISSION, WILDCARD_EDIT_PERMISSION, WILDCARD_DELETE_PERMISSION]),
    'guest group should accept wildcard view/edit/delete toggles',
  )

  assert.throws(
    () => AuthPermissionGroup.replaceBuiltInPageAccess('guest', [WILDCARD_LORA_SCAN_PERMISSION]),
    /One or more permission keys are invalid/,
    'guest built-in editor should reject LoRA scan permission',
  )

  assert.throws(
    () => AuthPermissionGroup.replaceBuiltInPageAccess('anonymous', [WILDCARD_VIEW_PERMISSION]),
    /Anonymous access can only include the wallpaper runtime page/,
    'anonymous access should not be able to expose the wildcard workspace',
  )
}

function main() {
  const tempRoot = process.env.RUNTIME_BASE_PATH
  assert.ok(tempRoot, 'Expected temporary runtime root')

  const authDbModule = require('../database/authDb') as AuthDbModule
  const { AuthPermissionGroup } = require('../models/AuthPermissionGroup') as AuthPermissionGroupModule

  fs.mkdirSync(process.env.RUNTIME_DATABASE_DIR!, { recursive: true })
  authDbModule.initializeAuthDb()

  try {
    assertWildcardRouteGuards()
    assertPermissionCatalog(AuthPermissionGroup)
    assertBuiltInGroupRules(AuthPermissionGroup)
  } finally {
    authDbModule.getAuthDb().close()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }

  console.log('Wildcard guest access backend contracts verified.')
}

main()
