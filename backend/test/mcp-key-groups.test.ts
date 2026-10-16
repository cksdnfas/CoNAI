import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/** HTTP MCP keys hold the permissions of one permission group, like an account; there are no per-key permissions. */
test('mcp keys: a key holds its permission group\'s permissions and nothing else', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-mcp-key-groups-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  ;(await import('../src/database/authDb')).initializeAuthDb()
  const { AuthPermissionGroup } = await import('../src/models/AuthPermissionGroup')
  const { mcpHttpSettingsService, MCP_HTTP_SCOPES } = await import('../src/services/mcpHttpSettingsService')
  const { isContextToolAllowed, requireMcpToolAccess } = await import('../src/mcp/toolAccess')

  const viewers = AuthPermissionGroup.createCustomGroup({ name: '이미지 조회', permissionKeys: ['images.view'] })
  const keyContext = (keyGroup: string | null) => ({ scopes: [...MCP_HTTP_SCOPES], keyId: 'k', keyGroup })

  await t.test('a key is created and updated with an existing group only', () => {
    assert.throws(() => mcpHttpSettingsService.createApiKey('키', 'no-such-group'), /permission group/)
    assert.throws(() => mcpHttpSettingsService.createApiKey('키', ''), /permission group/)
    const settings = mcpHttpSettingsService.createApiKey('조회 키', viewers.group_key)
    const key = settings.keys.find((item) => item.name === '조회 키')!
    assert.equal(key.groupKey, viewers.group_key)
    assert.equal('scopes' in key, false, 'no per-key permissions are stored')
    const auth = mcpHttpSettingsService.authenticate(key.apiKey)!
    assert.equal(auth.keyGroup, viewers.group_key)
    assert.deepEqual(auth.scopes, [...MCP_HTTP_SCOPES], 'scopes no longer narrow a key; its group does')
    assert.throws(() => mcpHttpSettingsService.updateApiKey(key.id, '조회 키', 'no-such-group'), /permission group/)
    assert.equal(mcpHttpSettingsService.updateApiKey(key.id, '조회 키', 'guest').keys.find((item) => item.id === key.id)!.groupKey, 'guest')
  })

  await t.test('a key from before groups (per-key scopes) starts with no group', () => {
    const file = path.join(root, 'config', 'mcp-http.json')
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'))
    stored.keys = [{ id: 'mcpkey_legacy', name: '옛 키', apiKey: `conai_mcp_${'a'.repeat(43)}`, scopes: ['read', 'generate'], createdAt: stored.updatedAt, updatedAt: stored.updatedAt }]
    fs.writeFileSync(file, JSON.stringify(stored))
    ;(mcpHttpSettingsService as unknown as { settings: unknown }).settings = null
    const legacy = mcpHttpSettingsService.loadSettings().keys[0]
    assert.equal(legacy.groupKey, null)
    assert.equal('scopes' in legacy, false)
    assert.equal(mcpHttpSettingsService.authenticate(legacy.apiKey)!.keyGroup, null)
  })

  await t.test('tools follow the group: what it holds is offered and runs, the rest is refused', () => {
    const context = keyContext(viewers.group_key)
    assert.equal(isContextToolAllowed(context, 'search_images'), true)
    assert.doesNotThrow(() => requireMcpToolAccess(context, 'search_images'))
    assert.equal(isContextToolAllowed(context, 'generate_nai'), false, 'generation.execute is not in the group')
    assert.throws(() => requireMcpToolAccess(context, 'generate_nai'), /Permission required: generation\.execute/)
    assert.equal(isContextToolAllowed(context, 'list_files'), false)
    // Parameter-dependent keys apply to keys too: putting results in a group needs images.edit.
    const generator = AuthPermissionGroup.createCustomGroup({ name: '생성', permissionKeys: ['generation.execute'] })
    assert.doesNotThrow(() => requireMcpToolAccess(keyContext(generator.group_key), 'generate_nai', {}))
    assert.throws(() => requireMcpToolAccess(keyContext(generator.group_key), 'generate_nai', { group_id: 1 }), /Permission required: images\.edit/)
  })

  await t.test('no group, a deleted group, or chat setup: nothing', () => {
    assert.equal(isContextToolAllowed(keyContext(null), 'search_images'), false)
    assert.throws(() => requireMcpToolAccess(keyContext(null), 'search_images'), /Permission required/)
    const gone = AuthPermissionGroup.createCustomGroup({ name: '지울 그룹', permissionKeys: ['images.view'] })
    AuthPermissionGroup.deleteCustomGroup(gone.id)
    assert.equal(isContextToolAllowed(keyContext(gone.group_key), 'search_images'), false)
    assert.equal(isContextToolAllowed(keyContext('admin'), 'list_chat_profiles'), false, 'configure is chat-only, never a key')
  })

  await t.test('changing the group\'s permissions changes the key at once', () => {
    AuthPermissionGroup.updateCustomGroup(viewers.id, { name: '이미지 조회', permissionKeys: ['images.view', 'generation.execute'] })
    assert.equal(isContextToolAllowed(keyContext(viewers.group_key), 'generate_nai'), true)
  })
})
