import './support/testTemp'
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

  await t.test('recursive root merges deduplicate resources, require exact preview and roll back conflicts', async () => {
    const { GroupModel } = await import('../src/models/Group')
    const { moveCustomGroups } = await import('../src/services/groupMutationService')
    const container = GroupModel.create({ name: 'Merge container' })
    const destination = GroupModel.create({ name: 'Merge root', emoticon_enabled: true })
    const source = GroupModel.create({ name: 'merge ROOT', parent_id: container })
    const child = GroupModel.create({ name: 'Child', parent_id: source })
    const targetChild = GroupModel.create({ name: 'child', parent_id: destination })
    const unique = GroupModel.create({ name: 'Unique', parent_id: source })
    const insert = main.db.prepare('INSERT INTO group_resources(group_id,resource_key,reference,label) VALUES(?,?,?,?)')
    for (const id of [source, destination]) insert.run(id, 'files:abc', '{"source":"files","fileId":"abc","label":"A"}', 'A')
    const hash = 'a'.repeat(32)
    main.db.prepare('INSERT INTO media_metadata(composite_hash) VALUES(?)').run(hash)
    const membership = main.db.prepare('INSERT INTO image_groups(group_id,composite_hash,collection_type,emote_keywords) VALUES(?,?,?,?)')
    membership.run(source, hash, 'manual', '["happy"]')
    membership.run(destination, hash, 'auto', '["smile"]')
    assert.throws(() => moveCustomGroups([source], null, null), /preview/)
    const preview = moveCustomGroups([source, child], null, null, { preview: true })
    assert.equal(preview.moved, 1, 'selected descendants travel with their selected ancestor')
    assert.equal(preview.conflicts.length, 2)
    assert.ok(GroupModel.findById(source), 'preview must not persist')
    GroupModel.update(destination, { description: 'changed after preview' })
    assert.throws(() => moveCustomGroups([source], null, null, { merge_token: preview.merge_token! }), /stale/)
    assert.equal(GroupModel.findById(child)?.parent_id, source, 'stale execution rolls back recursively')
    const fresh = moveCustomGroups([source], null, null, { preview: true })
    const result = moveCustomGroups([source], null, null, { merge_token: fresh.merge_token! })
    assert.equal(result.merged[source], destination)
    assert.equal(result.merged[child], targetChild)
    assert.equal(GroupModel.findById(source), null)
    assert.deepEqual(main.db.prepare("PRAGMA foreign_key_check('image_groups')").all(), [])
    assert.equal((main.db.prepare('SELECT COUNT(*) AS n FROM image_groups WHERE group_id=?').get(source) as { n: number }).n, 0)
    assert.equal(GroupModel.findById(unique)?.parent_id, destination)
    assert.equal((main.db.prepare('SELECT COUNT(*) AS n FROM group_resources WHERE group_id=?').get(destination) as { n: number }).n, 1)
    const memberships = main.db.prepare('SELECT collection_type,emote_keywords FROM image_groups WHERE group_id=?').all(destination) as { collection_type: string; emote_keywords: string }[]
    assert.equal(memberships.length, 1)
    assert.equal(memberships[0].collection_type, 'manual')
    assert.deepEqual(JSON.parse(memberships[0].emote_keywords), ['smile', 'happy'])
    assert.throws(() => moveCustomGroups([destination], unique, null), /Circular/)

    const otherParent = GroupModel.create({ name: 'Other merge container' })
    const otherSource = GroupModel.create({ name: 'Merge root', parent_id: otherParent })
    const batchSource = GroupModel.create({ name: 'Merge root', parent_id: container })
    const batchPreview = moveCustomGroups([batchSource, otherSource], null, null, { preview: true })
    assert.equal(batchPreview.conflicts.length, 2)
    assert.equal(moveCustomGroups([batchSource, otherSource], null, null, { merge_token: batchPreview.merge_token! }).moved, 2)

    const collisionSource = GroupModel.create({ name: 'Merge root', parent_id: container })
    const secondHash = 'b'.repeat(32)
    main.db.prepare('INSERT INTO media_metadata(composite_hash) VALUES(?)').run(secondHash)
    membership.run(collisionSource, secondHash, 'manual', '["happy"]')
    assert.throws(() => moveCustomGroups([collisionSource], null, null, { preview: true }), /multiple media/)
    assert.ok(GroupModel.findById(collisionSource))
    assert.equal((main.db.prepare('SELECT COUNT(*) AS n FROM image_groups WHERE group_id=?').get(destination) as { n: number }).n, 1)
    user.getUserSettingsDb().prepare('INSERT INTO runtime_jobs(job_id,kind,params) VALUES(?,?,?)')
      .run('merge-reference-test', 'group-auto-collect', JSON.stringify({ groupId: collisionSource }))
    assert.throws(() => moveCustomGroups([collisionSource], null, null, { preview: true }), /referenced/)
  })

  await t.test('ancestor/descendant merge chains reject without losing child media or resources', async () => {
    const { GroupModel } = await import('../src/models/Group')
    const { moveCustomGroups } = await import('../src/services/groupMutationService')
    const top = GroupModel.create({ name: 'Ancestor chain' })
    const source = GroupModel.create({ name: 'Ancestor chain', parent_id: top })
    const child = GroupModel.create({ name: 'Ancestor chain', parent_id: source })
    const hash = 'c'.repeat(32)
    main.db.prepare('INSERT INTO media_metadata(composite_hash) VALUES(?)').run(hash)
    main.db.prepare('INSERT INTO image_groups(group_id,composite_hash) VALUES(?,?)').run(child, hash)
    main.db.prepare('INSERT INTO group_resources(group_id,resource_key,reference,label) VALUES(?,?,?,?)')
      .run(child, 'files:chain', '{"source":"files","fileId":"chain","label":"chain"}', 'chain')
    assert.throws(() => moveCustomGroups([source], null, null, { preview: true }), /ancestor/)
    assert.throws(() => moveCustomGroups([source], null, null, { merge_token: '0'.repeat(64) }), /ancestor/)
    assert.throws(() => moveCustomGroups([top], child, null, { preview: true }), /Circular/)
    assert.equal(GroupModel.findById(source)?.parent_id, top)
    assert.equal(GroupModel.findById(child)?.parent_id, source)
    assert.ok(main.db.prepare('SELECT 1 FROM image_groups WHERE group_id=? AND composite_hash=?').get(child, hash))
    assert.ok(main.db.prepare('SELECT 1 FROM group_resources WHERE group_id=?').get(child))
  })

  await t.test('merge preserves stored keyword semantics and auto contributions survive the next rematch', async () => {
    const { GroupModel, ImageGroupModel } = await import('../src/models/Group')
    const { moveCustomGroups } = await import('../src/services/groupMutationService')
    const container = GroupModel.create({ name: 'Keyword container' })
    const destination = GroupModel.create({ name: 'Keyword target', emoticon_enabled: true })
    const source = GroupModel.create({ name: 'Keyword target', parent_id: container })
    user.getUserSettingsDb().prepare("INSERT INTO llm_chat_profiles(name,chat_style) VALUES('Malformed stored style','not json')").run()
    const folder = Number(main.db.prepare("INSERT INTO watched_folders(folder_path,folder_name) VALUES('/merge-keywords','merge-keywords')").run().lastInsertRowid)
    const hashes = [11, 12, 13, 14, 15, 16, 17].map(n => n.toString(16).padStart(32, '0'))
    for (const hash of hashes) {
      main.db.prepare('INSERT INTO media_metadata(composite_hash) VALUES(?)').run(hash)
      main.db.prepare("INSERT INTO image_files(composite_hash,original_file_path,folder_id,file_status,file_size,mime_type) VALUES(?,?,?,'active',1,'image/png')")
        .run(hash, `/merge-keywords/${hash}/same.png`, folder)
    }
    const add = main.db.prepare('INSERT INTO image_groups(group_id,composite_hash,collection_type,emote_keywords) VALUES(?,?,?,?)')
    add.run(destination, hashes[0], 'manual', null)
    add.run(destination, hashes[1], 'manual', null)
    add.run(source, hashes[2], 'auto', null)
    add.run(source, hashes[0], 'auto', '[]')
    add.run(destination, hashes[3], 'auto', '[ "keep" ]')
    add.run(source, hashes[3], 'auto', '["KEEP"]')
    add.run(destination, hashes[4], 'auto', '["OLD"]')
    add.run(source, hashes[4], 'auto', '["new","old"]')
    add.run(destination, hashes[5], 'auto', '[]')
    const preview = moveCustomGroups([source], null, null, { preview: true })
    moveCustomGroups([source], null, null, { merge_token: preview.merge_token! })
    const keyword = (hash: string) => (main.db.prepare('SELECT emote_keywords FROM image_groups WHERE group_id=? AND composite_hash=?').get(destination, hash) as { emote_keywords: string | null }).emote_keywords
    assert.equal(keyword(hashes[0]), null)
    assert.equal(keyword(hashes[1]), null)
    assert.equal(keyword(hashes[2]), null, 'copied fallback must stay a fallback')
    assert.equal(keyword(hashes[3]), '[ "keep" ]', 'equivalent contributed words must not rewrite stored target words')
    assert.deepEqual(JSON.parse(keyword(hashes[4])!), ['OLD', 'new'])
    const rematch = await ImageGroupModel.replaceAutoCollectedImagesStaged(destination, () => {})
    assert.equal(rematch.removedCount, 1, 'only unrelated target auto membership is removed')
    for (const hash of [hashes[2], hashes[3], hashes[4]]) {
      assert.equal((main.db.prepare('SELECT collection_type FROM image_groups WHERE group_id=? AND composite_hash=?').get(destination, hash) as { collection_type: string }).collection_type, 'manual')
    }
    const badSource = GroupModel.create({ name: 'Keyword target', parent_id: container })
    add.run(badSource, hashes[6], 'auto', '["same"]')
    assert.throws(() => moveCustomGroups([badSource], null, null, { preview: true }), /multiple media/)
    assert.ok(GroupModel.findById(badSource))
  })

  await t.test('move/edit previews, cancellation and stale execution never partially save fields', async () => {
    const { GroupModel } = await import('../src/models/Group')
    const { moveCustomGroups } = await import('../src/services/groupMutationService')
    const container = GroupModel.create({ name: 'Editor container' })
    const destination = GroupModel.create({ name: 'Editor target', description: 'destination settings' })
    const source = GroupModel.create({ name: 'Editor source', parent_id: container, description: 'original' })
    const options = { edit: { name: 'Editor target', description: 'draft edit' } }
    const preview = moveCustomGroups([source], null, null, { ...options, preview: true })
    assert.equal(GroupModel.findById(source)?.description, 'original')
    assert.equal(GroupModel.findById(source)?.name, 'Editor source')
    assert.equal(preview.conflicts[0].source_path, 'Editor container/Editor target')
    GroupModel.update(destination, { description: 'concurrent change' })
    assert.throws(() => moveCustomGroups([source], null, null, { ...options, merge_token: preview.merge_token! }), /stale/)
    assert.equal(GroupModel.findById(source)?.description, 'original')
    assert.equal(GroupModel.findById(source)?.parent_id, container)
    const fresh = moveCustomGroups([source], null, null, { ...options, preview: true })
    moveCustomGroups([source], null, null, { ...options, merge_token: fresh.merge_token! })
    assert.equal(GroupModel.findById(destination)?.description, 'concurrent change', 'source edit must not overwrite destination settings')
    const plain = GroupModel.create({ name: 'Editor ordinary', description: 'before' })
    moveCustomGroups([plain], container, null, { edit: { description: 'after' } })
    assert.equal(GroupModel.findById(plain)?.description, 'after')
    assert.equal(GroupModel.findById(plain)?.parent_id, container)
  })

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
    for (const id of ['group.select', 'group.create', 'group.update', 'group.auto_collect', 'group.move', 'group.delete']) {
      assert.equal(chatPageActionAllowed('/groups', id), true)
      assert.equal(chatPageActionAllowed('/groups/12', id), true)
      assert.equal(chatPageActionAllowed('/prompts', id), false)
    }
    assert.equal(CHAT_PAGE_ACTION_PERMISSIONS['group.create'], 'images.edit')
    assert.equal(CHAT_PAGE_ACTION_PERMISSIONS['group.delete'], 'images.delete')
    const schema = { type: 'object' as const, properties: { name: { type: 'string' as const } }, required: ['name'] }
    assert.equal(normalizeChatPageActions('/groups', [{ id: 'group.create', label: 'Create', description: '', effect: 'save', schema }]).length, 1)
    assert.throws(() => normalizeChatPageActions('/groups', [{ id: 'group.create', label: 'Create', description: '', effect: 'draft', schema }]))
  })

  await t.test('group routes keep their responses after moving onto the shared service', async () => {
    const express = (await import('express')).default
    const { groupMutationRoutes } = await import('../src/routes/groups.mutation.routes')
    const { groupHierarchyRoutes } = await import('../src/routes/groups.hierarchy.routes')
    const app = express()
    app.use(express.json())
    app.use('/api/groups', groupMutationRoutes)
    app.use('/api/groups', groupHierarchyRoutes)
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

      // Bulk move / delete: one transaction each; child groups survive a delete unless cascade is picked.
      const { GroupModel } = await import('../src/models/Group')
      const parent = (await send('POST', base, { name: 'Bulk parent' })).body.data!.id!
      const child = (await send('POST', base, { name: 'Bulk child', parent_id: parent })).body.data!.id!
      assert.equal((await send('POST', `${base}/${child}/move`, { parent_id: null, edit: { description: 'atomic route edit' }, preview: true })).status, 200)
      assert.equal(GroupModel.findById(child)?.parent_id, parent)
      assert.equal(GroupModel.findById(child)?.description, null)
      assert.equal((await send('POST', `${base}/${child}/move`, { parent_id: null, edit: { description: 'atomic route edit' } })).status, 200)
      assert.equal(GroupModel.findById(child)?.parent_id, null)
      assert.equal(GroupModel.findById(child)?.description, 'atomic route edit')
      assert.equal((await send('POST', `${base}/${child}/move`, { parent_id: parent })).status, 200)
      const other = (await send('POST', base, { name: 'Bulk other' })).body.data!.id!
      const loose = (await send('POST', base, { name: 'Bulk loose' })).body.data!.id!
      assert.equal((await send('POST', `${base}/bulk-move`, { ids: [other], parent_id: child })).status, 200)
      assert.equal((await send('POST', `${base}/bulk-move`, { ids: [loose, parent], parent_id: other })).status, 400, 'a group cannot move under its own descendant')
      assert.equal(GroupModel.findById(loose)!.parent_id, null, 'a failed batch moves nothing')
      assert.equal((await send('POST', `${base}/bulk-delete`, { ids: [] })).status, 400)
      const kept = await send('POST', `${base}/bulk-delete`, { ids: [parent] })
      assert.equal(kept.status, 200)
      assert.equal((kept.body.data as { deleted?: number }).deleted, 1)
      assert.equal(GroupModel.findById(child)!.parent_id, null, 'children move to the top level by default')
      assert.equal(GroupModel.findById(other)!.parent_id, child)
      const cascaded = await send('POST', `${base}/bulk-delete`, { ids: [child, other, loose], cascade: true })
      assert.equal((cascaded.body.data as { deleted?: number }).deleted, 3, 'a selected descendant is deleted once')
      assert.equal(GroupModel.findById(other), null)
      assert.equal((await send('POST', `${base}/bulk-delete`, { ids: [child] })).status, 404)
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

  await t.test('MCP merge preview reports coherent current source IDs and paths', async () => {
    await call('create_image_group', { name: 'Preview container' })
    const destination = await call('create_image_group', { name: 'Preview collision' })
    const source = await call('create_image_group', { name: 'Preview collision', parent_path: 'Preview container' })
    const preview = await call('move_image_groups', { group_ids: [source.data.group_id], preview: true })
    assert.equal(preview.isError, false, preview.text)
    assert.equal(preview.data.conflicts[0].destination_id, destination.data.group_id)
    assert.equal(preview.data.groups[0].group_id, source.data.group_id)
    assert.equal(preview.data.groups[0].path, 'Preview container/Preview collision')
    assert.equal((await call('get_image_group', { group_id: preview.data.groups[0].group_id })).data.path, preview.data.groups[0].path)
  })

  await t.test('MCP moves groups and deletes them only by their confirmed names', async () => {
    const top = await call('create_image_group', { name: 'Cleanup' })
    const inner = await call('create_image_group', { name: 'Inner', parent_path: 'Cleanup' })
    const loose = await call('create_image_group', { name: 'Loose' })
    const moved = await call('move_image_groups', { group_ids: [loose.data.group_id], parent_path: 'Cleanup' })
    assert.equal(moved.isError, false, moved.text)
    assert.equal(moved.data.groups[0].path, 'Cleanup/Loose')

    assert.equal((await call('delete_image_groups', { group_ids: [top.data.group_id], confirm_names: ['Clean'] })).isError, true, 'a wrong name is refused')
    const deleted = await call('delete_image_groups', { group_ids: [top.data.group_id], confirm_names: ['Cleanup'] })
    assert.equal(deleted.isError, false, deleted.text)
    assert.equal(deleted.data.deleted, 1)
    assert.equal((await call('get_image_group', { group_id: inner.data.group_id })).data.path, 'Inner', 'children move to the top level by default')

    const cascade = await call('delete_image_groups', { group_ids: [inner.data.group_id, loose.data.group_id], confirm_names: ['Inner', 'Loose'], cascade: true })
    assert.equal(cascade.data.deleted, 2)
  })
})
