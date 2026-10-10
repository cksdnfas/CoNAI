import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/**
 * Assistants create and edit custom groups (with auto-collect rules) through MCP tools and the group page actions.
 * Rules must build the same filter the group editor's chip mode saves, so an assistant-made group opens as chips.
 */
test('group assistant tools: rules, page actions and MCP group create/update/run', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-group-assistant-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  process.env.FRONTEND_DIST_PATH = path.join(root, 'no-frontend')
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const runtimeJobs = await import('../src/services/runtimeJobs')
  runtimeJobs.registerRuntimeJobHandlers()

  const { createMcpServer } = await import('../src/mcp/server')
  const { Client } = await import('@modelcontextprotocol/client')
  const { InMemoryTransport } = await import('@modelcontextprotocol/client')
  const server = createMcpServer({ scopes: ['read', 'organize'], source: 'http' })
  const client = new Client({ name: 'group-assistant', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  const jobIds: string[] = []

  t.after(async () => {
    await client.close()
    await server.close()
    // Let started auto-collect jobs settle before the databases close.
    for (const jobId of jobIds) {
      for (let i = 0; i < 100 && !['completed', 'failed', 'cancelled'].includes(runtimeJobs.RuntimeJobStore.get(jobId)?.status ?? 'completed'); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
    authModule.getAuthDb().close()
    user.closeUserSettingsDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-group-assistant-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args })
    const text = (result.content as Array<{ text: string }>)[0].text
    return { isError: Boolean(result.isError), text, data: result.isError ? null : JSON.parse(text) }
  }

  await t.test('rules build the chip-mode filter and read back', async () => {
    const { buildGroupAutoCollectFilter, readGroupAutoCollectRules } = await import('@conai/shared')
    const filter = buildGroupAutoCollectFilter([
      { scope: 'auto_tag', operator: 'AND', value: ' misty_(pokemon) ' },
      { scope: 'negative', operator: 'NOT', value: 'lowres' },
      { scope: 'ai_tool', operator: 'OR', value: 'nai' },
    ])
    assert.deepEqual(filter, {
      exclude_group: [{ category: 'negative_prompt', type: 'negative_prompt_contains', value: 'lowres' }],
      or_group: [{ category: 'basic', type: 'ai_tool_group', value: 'nai' }],
      and_group: [{ category: 'auto_tag', type: 'auto_tag_any', value: 'misty_(pokemon)', min_score: 0, max_score: 1 }],
    })
    assert.deepEqual(readGroupAutoCollectRules(JSON.stringify(filter)), [
      { scope: 'negative', operator: 'NOT', value: 'lowres' },
      { scope: 'ai_tool', operator: 'OR', value: 'nai' },
      { scope: 'auto_tag', operator: 'AND', value: 'misty_(pokemon)' },
    ])
    assert.deepEqual(readGroupAutoCollectRules(null), [])
    // Anything the rules cannot express is reported, never silently dropped.
    assert.equal(readGroupAutoCollectRules(JSON.stringify({ and_group: [{ category: 'positive_prompt', type: 'prompt_regex', value: 'a.*' }] })), null)
    assert.equal(readGroupAutoCollectRules(JSON.stringify([{ type: 'prompt_contains', value: 'legacy' }])), null)
    assert.throws(() => buildGroupAutoCollectFilter([]))
    assert.throws(() => buildGroupAutoCollectFilter([{ scope: 'ai_tool', operator: 'AND', value: 'midjourney' }]))
  })

  await t.test('group page actions are registered for /groups only', async () => {
    const { chatPageActionAllowed, normalizeChatPageActions, CHAT_PAGE_ACTION_PERMISSIONS } = await import('@conai/shared')
    for (const id of ['group.select', 'group.create', 'group.update', 'group.auto_collect']) {
      assert.equal(chatPageActionAllowed('/groups', id), true)
      assert.equal(chatPageActionAllowed('/groups/12', id), true)
      assert.equal(chatPageActionAllowed('/prompts', id), false)
    }
    assert.equal(CHAT_PAGE_ACTION_PERMISSIONS['group.create'], 'images.edit')
    const schema = { type: 'object' as const, properties: { name: { type: 'string' as const } }, required: ['name'] }
    assert.equal(normalizeChatPageActions('/groups', [{ id: 'group.create', label: 'Create', description: '', effect: 'save', schema }]).length, 1)
    assert.throws(() => normalizeChatPageActions('/groups', [{ id: 'group.create', label: 'Create', description: '', effect: 'draft', schema }]))
  })

  await t.test('group routes keep their responses after moving onto the shared service', async () => {
    const express = (await import('express')).default
    const { groupMutationRoutes } = await import('../src/routes/groups.mutation.routes')
    const app = express()
    app.use(express.json())
    app.use('/api/groups', groupMutationRoutes)
    const listener = app.listen(0)
    try {
      const base = `http://127.0.0.1:${(listener.address() as { port: number }).port}/api/groups`
      const send = async (method: string, url: string, body: unknown) => {
        const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        return { status: response.status, body: await response.json() as { success: boolean; data?: { id?: number }; error?: string } }
      }
      const created = await send('POST', base, { name: 'Route group' })
      assert.equal(created.status, 201)
      const id = created.body.data!.id!
      assert.equal((await send('POST', base, { name: 'route GROUP' })).status, 400, 'name conflict')
      assert.equal((await send('POST', base, { name: '  ' })).status, 400, 'name required')
      const invalid = await send('POST', base, { name: 'Bad rules', auto_collect_enabled: true, auto_collect_conditions: { and_group: [{ category: 'positive_prompt', type: 'prompt_contains', value: '' }] } })
      assert.equal(invalid.status, 400)
      assert.match(invalid.body.error ?? '', /Invalid auto collection conditions/)
      assert.equal((await send('PUT', `${base}/${id}`, { description: 'changed' })).status, 200)
      assert.equal((await send('PUT', `${base}/${id}`, { parent_id: id })).status, 400, 'self parent')
      assert.equal((await send('PUT', `${base}/999999`, { description: 'missing' })).status, 404)
    } finally {
      await new Promise((resolve) => listener.close(resolve))
    }
  })

  await t.test('MCP creates, reads, updates and re-runs a group', async () => {
    const parent = await call('create_image_group', { name: 'Characters' })
    assert.equal(parent.isError, false, parent.text)
    assert.equal(parent.data.auto_collect.enabled, false)
    assert.equal(parent.data.auto_collect_job, null)

    const created = await call('create_image_group', {
      name: 'Misty', parent_path: 'Characters', description: 'pokemon',
      auto_collect_rules: [{ scope: 'auto_tag', value: 'misty_(pokemon)' }],
    })
    assert.equal(created.isError, false, created.text)
    assert.equal(created.data.path, 'Characters/Misty')
    assert.equal(created.data.parent_id, parent.data.group_id)
    assert.equal(created.data.auto_collect.enabled, true)
    assert.deepEqual(created.data.auto_collect.rules, [{ scope: 'auto_tag', operator: 'AND', value: 'misty_(pokemon)' }])
    assert.ok(created.data.auto_collect_job?.job_id)
    jobIds.push(created.data.auto_collect_job.job_id)

    assert.equal((await call('create_image_group', { name: 'misty', parent_path: 'Characters' })).isError, true, 'sibling names are unique')
    assert.equal((await call('create_image_group', { name: 'A/B' })).isError, true, 'names cannot contain a slash')
    assert.equal((await call('create_image_group', { name: 'Orphan', parent_path: 'Missing' })).isError, true, 'parent is never created')

    const read = await call('get_image_group', { group_path: 'Characters/Misty' })
    assert.equal(read.data.description, 'pokemon')

    const updated = await call('update_image_group', {
      group_id: created.data.group_id, description: '',
      auto_collect_rules: [{ scope: 'auto_tag', operator: 'AND', value: 'misty_(pokemon)' }, { scope: 'positive', operator: 'NOT', value: 'ash' }],
    })
    assert.equal(updated.isError, false, updated.text)
    assert.equal(updated.data.description, null)
    assert.equal(updated.data.auto_collect.rules.length, 2)
    if (updated.data.auto_collect_job) jobIds.push(updated.data.auto_collect_job.job_id)

    const disabled = await call('update_image_group', { group_id: created.data.group_id, auto_collect_enabled: false })
    assert.equal(disabled.data.auto_collect.enabled, false)
    assert.equal(disabled.data.auto_collect.rules.length, 2, 'disabling keeps the stored rules')
    assert.equal((await call('run_group_auto_collect', { group_id: created.data.group_id })).isError, true)

    const enabled = await call('update_image_group', { group_id: created.data.group_id, auto_collect_enabled: true })
    assert.equal(enabled.data.auto_collect.enabled, true)
    if (enabled.data.auto_collect_job) jobIds.push(enabled.data.auto_collect_job.job_id)
    const run = await call('run_group_auto_collect', { group_path: 'Characters/Misty' })
    assert.equal(run.isError, false, run.text)
    jobIds.push(run.data.auto_collect_job.job_id)

    assert.equal((await call('update_image_group', { group_id: parent.data.group_id, auto_collect_enabled: true })).isError, true, 'enabling needs rules')
    assert.equal((await call('update_image_group', { group_id: parent.data.group_id })).isError, true, 'nothing to update')
  })
})
