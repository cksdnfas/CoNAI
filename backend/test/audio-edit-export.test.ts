import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'

/**
 * Audio workspace, phase 3: edits (filter chain, render, preview, save), exports (loudnorm decisions, renders, names,
 * ZIPs, background jobs), the deletion plan, MCP edit/cleanup/export/download tools and their artifacts. The oracle is
 * backend/test/fixtures/av-golden/audio (outputs of the original SFX manager on the same inputs).
 */

const GOLDEN = path.join(__dirname, 'fixtures', 'av-golden')

type Levels = { window_frames: number; rms_dbfs_per_window?: Array<number | null> }

/** Filter chains compared by meaning: same filters and options; numbers equal (Python 0.0 vs JS 0, 1e-05 vs 0.00001). */
function assertSameChain(actual: string, expected: string, tolerance: (key: string) => number, label: string) {
  const parse = (chain: string) => chain.split(',').map((filter) => {
    const at = filter.indexOf('=')
    const name = at < 0 ? filter : filter.slice(0, at)
    const args = at < 0 ? [] : filter.slice(at + 1).split(':').map((part) => {
      const eq = part.indexOf('=')
      return eq < 0 ? ['', part] : [part.slice(0, eq), part.slice(eq + 1)]
    })
    return { name, args }
  })
  const a = parse(actual)
  const e = parse(expected)
  assert.deepEqual(a.map((f) => f.name), e.map((f) => f.name), `${label}: filters\n${actual}\n${expected}`)
  for (const [i, filter] of e.entries()) {
    assert.deepEqual(a[i].args.map(([key]) => key), filter.args.map(([key]) => key), `${label}: ${filter.name} options`)
    for (const [j, [key, value]] of filter.args.entries()) {
      const got = a[i].args[j][1]
      const number = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(dB)?$/i
      const ev = number.exec(value)
      const gv = number.exec(got)
      if (ev && gv && (ev[2] ?? '') === (gv[2] ?? '')) {
        const x = Number(gv[1]); const y = Number(ev[1])
        const tol = Math.max(tolerance(key), Math.abs(y) * 1e-9, 1e-12)
        assert.ok(Math.abs(x - y) <= tol, `${label}: ${filter.name}.${key} ${got} vs ${value}`)
      } else {
        assert.equal(got, value, `${label}: ${filter.name}.${key}`)
      }
    }
  }
}

test('audio workspace: edits, exports, deletion plan and MCP tools', { timeout: 300000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-audio-edit-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  }
  process.env.FRONTEND_DIST_PATH = path.join(root, 'no-frontend')

  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const auth = authModule.getAuthDb()
  const main = await import('../src/database/init')
  await main.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const audioDbModule = await import('../src/database/audioDb')
  const audioDb = audioDbModule.initializeAudioDb()
  const { registerAudioExportJobHandlers } = await import('../src/services/audio/audioExportJob')
  registerAudioExportJobHandlers()
  t.after(async () => {
    auth.close()
    user.closeUserSettingsDb()
    audioDbModule.closeAudioDb()
    main.closeDatabase()
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-audio-edit-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const service = await import('../src/services/audio/audioService')
  const store = await import('../src/services/audio/audioStore')
  const editing = await import('../src/services/audio/audioEdit')
  const exporting = await import('../src/services/audio/audioExport')
  const manifest = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'manifest.json'), 'utf8')).audio as {
    edit_filter_strings: Array<{ id: string; request_json: string; duration_arg: number; filter_chain?: string; raises?: string; exception?: string }>
    edit_renders: Array<{ id: string; input: string; request_json: string; input_probe: { duration: number }; output_wav: { frames: number; channels: number; levels: Levels } }>
    exports: Array<{ id: string; input: string; options: Record<string, unknown>; meta_arg: { duration: number; sample_rate: number }; loudnorm_measured?: Record<string, string>; decision?: { branch: string }; final_filter_chain: string; output_decoded: { frames: number; channels: number; levels: Levels } }>
    naming: { collision_vectors: Array<{ id: string; format: string; groups_in_creation_order: Array<{ name: string; label: string; selected_count: number }>; status_code?: number; detail?: string; files?: Array<{ group_label: string; filename: string }> }> }
  }

  const ffmpeg = createRequire(__filename)('ffmpeg-static') as string
  const scratch = path.join(root, 'scratch')
  fs.mkdirSync(scratch, { recursive: true })
  /** Decoded PCM: frame count and the original generator's per-window RMS (dBFS over all channel samples, null = silence). */
  const levels = (file: string, channels: number, windowFrames: number) => {
    const raw = execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-f', 'f32le', '-acodec', 'pcm_f32le', '-'], { maxBuffer: 256 * 1024 * 1024 })
    const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
    const frames = samples.length / channels
    const rms: Array<number | null> = []
    for (let start = 0; start < frames; start += windowFrames) {
      const end = Math.min(frames, start + windowFrames)
      let sum = 0
      for (let i = start * channels; i < end * channels; i += 1) sum += samples[i] * samples[i]
      const value = Math.sqrt(sum / ((end - start) * channels))
      rms.push(value > 0 ? 20 * Math.log10(value) : null)
    }
    return { frames, rms }
  }
  const assertLevels = (actual: Array<number | null>, expected: Array<number | null> | undefined, label: string) => {
    if (!expected) return
    assert.equal(actual.length, expected.length, `${label}: windows`)
    for (const [i, value] of expected.entries()) {
      if (value === null) {
        assert.ok(actual[i] === null || (actual[i] as number) < -90, `${label}: window ${i} should be silent, got ${actual[i]}`)
      } else {
        assert.ok(actual[i] !== null && Math.abs((actual[i] as number) - value) <= 0.5, `${label}: window ${i} ${actual[i]} vs ${value}`)
      }
    }
  }
  const staged = (source: string, ext = path.extname(source)) => {
    const copy = path.join(scratch, `staged-${crypto.randomUUID()}${ext}`)
    fs.copyFileSync(source, copy)
    return copy
  }
  const tone = (name: string, frequency: number, seconds = 0.5) => {
    const target = path.join(scratch, name)
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${seconds}`, '-ac', '1', '-ar', '22050', target])
    return target
  }

  // ---------------------------------------------------------------- golden: edit filter strings
  await t.test('edit filter chains match the original for all 19 recorded requests (incl. errors)', () => {
    assert.equal(manifest.edit_filter_strings.length, 19)
    for (const entry of manifest.edit_filter_strings) {
      const body = JSON.parse(entry.request_json)
      if (entry.filter_chain) {
        const chain = editing.buildAudioEditFilterChain(editing.parseAudioEditParams(body), entry.duration_arg)
        assertSameChain(chain, entry.filter_chain, () => 0, entry.id)
      } else {
        assert.throws(() => editing.buildAudioEditFilterChain(editing.parseAudioEditParams(body), entry.duration_arg),
          (error: unknown) => error instanceof service.AudioServiceError && error.status === 422, entry.id)
      }
    }
  })

  // ---------------------------------------------------------------- golden: renders
  await t.test('edit renders match the original by frame count and per-50 ms loudness (±0.5 dB)', async () => {
    assert.equal(manifest.edit_renders.length, 3)
    for (const entry of manifest.edit_renders) {
      const target = path.join(scratch, `${entry.id}.wav`)
      await editing.renderAudioEdit(path.join(GOLDEN, entry.input), target, editing.parseAudioEditParams(JSON.parse(entry.request_json)), entry.input_probe.duration)
      const got = levels(target, entry.output_wav.channels, entry.output_wav.levels.window_frames)
      assert.equal(got.frames, entry.output_wav.frames, `${entry.id}: frames`)
      assertLevels(got.rms, entry.output_wav.levels.rms_dbfs_per_window, entry.id)
    }
  })

  // ---------------------------------------------------------------- golden: exports
  await t.test('export decisions, chains and outputs match the original for all 8 recorded exports', async () => {
    assert.equal(manifest.exports.length, 8)
    const branches = new Set<string>()
    for (const entry of manifest.exports) {
      const options = { ...exporting.DEFAULT_AUDIO_EXPORT_OPTIONS, ...exporting.parseAudioExportOverrides(entry.options) }
      const meta = { duration: entry.meta_arg.duration, sampleRate: entry.meta_arg.sample_rate }
      const source = path.join(GOLDEN, entry.input)
      const plan = await exporting.planAudioFileExport(source, options, meta)
      const expectedBranch = entry.decision?.branch ?? 'no_normalize'
      assert.equal(plan.branch, expectedBranch, entry.id)
      branches.add(plan.branch)
      // Measurements may move by a hundredth between ffmpeg builds; everything else is exact.
      assertSameChain(plan.chain, entry.final_filter_chain, (key) => (key.startsWith('measured_') || key === 'offset' || key === 'volume' ? 0.06 : 0), entry.id)
      if (entry.loudnorm_measured) {
        // The decision itself, replayed on the original's own measurement.
        const base = plan.chain.split(',').filter((part) => part.startsWith('aresample') || part.startsWith('aformat'))
        const decided = exporting.decideAudioExportChain(options, base, entry.loudnorm_measured, meta.duration)
        assert.equal(decided.branch, expectedBranch, `${entry.id}: replayed decision`)
        assertSameChain(decided.chain.join(','), entry.final_filter_chain, () => 0, `${entry.id}: replayed chain`)
      }
      const target = path.join(scratch, `${entry.id}.${options.format}`)
      await exporting.renderAudioFileExport(source, target, options, meta)
      const got = levels(target, entry.output_decoded.channels, entry.output_decoded.levels.window_frames)
      assert.equal(got.frames, entry.output_decoded.frames, `${entry.id}: frames`)
      assertLevels(got.rms, entry.output_decoded.levels.rms_dbfs_per_window, entry.id)
      if (options.format === 'ogg') {
        const again = path.join(scratch, `${entry.id}-again.ogg`)
        await exporting.renderAudioFileExport(source, again, options, meta)
        assert.deepEqual(fs.readFileSync(again), fs.readFileSync(target), `${entry.id}: +bitexact makes OGG exports deterministic`)
      }
    }
    assert.deepEqual([...branches].sort(), ['linear_gain_fallback', 'no_normalize', 'two_pass_linear_loudnorm', 'unmeasurable_no_gain'])
  })

  // ---------------------------------------------------------------- fixtures for the workspace tests
  const project = service.createAudioProject({ name: '게임 A' }, null)
  const snow = service.createAudioGroup(project.id, { name: '발자국 · 눈', label: 'footstep_snow_[00]' })
  const stone = service.createAudioGroup(project.id, { name: '발자국 · 돌', label: 'stone' })
  const sweep = path.join(GOLDEN, 'audio', 'inputs', 'sweep_noise_mono44k.wav')
  const source = await service.importAudioUpload({ groupId: snow.id }, staged(sweep), 'take one.wav', null)
  audioDb.prepare('UPDATE audio_candidates SET provenance_json = ? WHERE id = ?')
    .run(JSON.stringify({ prompt: 'soft footstep', seed: 88410, workflow_id: 3 }), source.id)

  await t.test('saving an edit creates a pending child with inherited provenance; request_key makes it repeat-safe', async () => {
    const child = await editing.saveAudioEdit(source.id, { start: 0.2, end: 1.1, gain_db: 2 }, { accountId: null, requestKey: 'edit-key-0001' })
    assert.equal(child.origin, 'edited')
    assert.equal(child.parent_id, source.id)
    assert.equal(child.group_id, snow.id)
    assert.equal(child.review, 'pending')
    assert.equal(child.name, 'take one · 편집')
    assert.deepEqual(child.provenance, { prompt: 'soft footstep', seed: 88410, workflow_id: 3, edited_from: source.id })
    assert.deepEqual(child.edit, { start: 0.2, end: 1.1, gain_db: 2, pitch_semitones: 0, speed: 1, fade_in: 0.005, fade_out: 0.01 })
    assert.equal(child.file.ext, 'wav')
    assert.ok(Math.abs((child.file.duration ?? 0) - 0.9) < 0.01)
    assert.ok(fs.existsSync(store.audioBlobPath(child.file_hash, 'wav')))
    const again = await editing.saveAudioEdit(source.id, { start: 0.2, end: 1.1, gain_db: 2 }, { accountId: null, requestKey: 'edit-key-0001' })
    assert.equal(again.id, child.id)
    await assert.rejects(editing.saveAudioEdit(source.id, { start: 0.3, end: 1.1 }, { accountId: null, requestKey: 'edit-key-0001' }), /request_key/)
    await assert.rejects(editing.saveAudioEdit(source.id, { start: 1.4, end: 1.0 }, { accountId: null }), (error: unknown) => (error as { status?: number }).status === 422)
    assert.equal(fs.readdirSync(path.join(root, 'temp', 'audio-incoming')).length, 0, 'no staged render is left behind')
  })

  // ---------------------------------------------------------------- HTTP
  const { invalidateConfiguredAuthCache } = await import('../src/routes/auth-route-helpers')
  const { AuthPermissionGroup } = await import('../src/models/AuthPermissionGroup')
  const adminId = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('admin-audio', 'unused', 'admin')").run().lastInsertRowid)
  auth.prepare("INSERT INTO auth_account_group_memberships (account_id, group_id) SELECT ?, id FROM auth_permission_groups WHERE group_key = 'admin'").run(adminId)
  const listenerGroup = AuthPermissionGroup.createCustomGroup({ name: 'audio-listener', permissionKeys: ['audio.view', 'images.view'] })
  const listenerId = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('listener', 'unused', 'guest')").run().lastInsertRowid)
  AuthPermissionGroup.addAccountMembership(listenerGroup.id, listenerId)
  const editorGroup = AuthPermissionGroup.createCustomGroup({ name: 'audio-editor', permissionKeys: ['audio.view', 'audio.edit', 'images.view'] })
  const editorId = Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES ('editor', 'unused', 'guest')").run().lastInsertRowid)
  AuthPermissionGroup.addAccountMembership(editorGroup.id, editorId)
  invalidateConfiguredAuthCache()

  const express = (await import('express')).default
  const { registerAppRoutes } = await import('../src/startup/registerAppRoutes')
  const app = express()
  const sessions = new Map<string, Record<string, unknown>>()
  app.use(express.json())
  app.use((req, _res, next) => {
    const id = Number(req.header('x-test-account')) || undefined
    const sid = `test-${id ?? 'anonymous'}`
    if (!sessions.has(sid)) sessions.set(sid, { authenticated: Boolean(id), accountId: id, accountType: id === adminId ? 'admin' : id ? 'guest' : undefined })
    Object.assign(req, { sessionID: sid, session: sessions.get(sid) })
    next()
  })
  const pass = (_req: unknown, _res: unknown, next: () => void) => next()
  registerAppRoutes(app, { uploadsDir: path.join(root, 'uploads'), tempDir: path.join(root, 'temp'), saveDir: path.join(root, 'save'), mcpLimiter: pass, readOnlyLimiter: pass, uploadLimiter: pass })
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const call = async (url: string, accountId?: number, init: RequestInit = {}) => {
    const response = await fetch(origin + url, { ...init, headers: { ...(accountId ? { 'x-test-account': String(accountId) } : {}), ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) } })
    const buffer = Buffer.from(await response.arrayBuffer())
    return { status: response.status, headers: response.headers, buffer, json: () => JSON.parse(buffer.toString('utf8')) }
  }
  const select = (id: string) => service.setAudioCandidateReview(id, { review: 'selected' })
  const zipNames = async (buffer: Buffer) => {
    const AdmZip = (await import('adm-zip')).default
    return new AdmZip(buffer).getEntries().map((entry) => entry.entryName)
  }

  await t.test('preview streams a temp render that is removed afterwards; edits need audio.edit', async () => {
    const preview = await call(`/api/audio/candidates/${source.id}/preview`, editorId, { method: 'POST', body: JSON.stringify({ end: 1.2, pitch_semitones: 3 }) })
    assert.equal(preview.status, 200, preview.buffer.toString().slice(0, 200))
    assert.equal(preview.headers.get('content-type'), 'audio/wav')
    assert.equal(preview.buffer.subarray(0, 4).toString('ascii'), 'RIFF')
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.deepEqual(fs.readdirSync(path.join(root, 'temp', 'audio-preview')), [], 'the preview file is deleted after streaming')
    assert.equal((await call(`/api/audio/candidates/${source.id}/preview`, listenerId, { method: 'POST', body: JSON.stringify({ end: 1 }) })).status, 403)
    assert.equal((await call(`/api/audio/candidates/${source.id}/edit`, listenerId, { method: 'POST', body: JSON.stringify({ end: 1 }) })).status, 403)
    const bad = await call(`/api/audio/candidates/${source.id}/edit`, editorId, { method: 'POST', body: JSON.stringify({ end: 1, speed: 5 }) })
    assert.equal(bad.status, 422)
    const saved = await call(`/api/audio/candidates/${source.id}/edit`, editorId, { method: 'POST', body: JSON.stringify({ end: 1.0, fade_out: 0.1, request_key: 'http-edit-0001' }) })
    assert.equal(saved.status, 201)
    assert.equal(saved.json().data.parent_id, source.id)
  })

  await t.test('export settings: defaults, saved values and audio.edit to change them', async () => {
    assert.deepEqual((await call('/api/audio/settings/export', listenerId)).json().data, exporting.DEFAULT_AUDIO_EXPORT_OPTIONS)
    assert.equal((await call('/api/audio/settings/export', listenerId, { method: 'PUT', body: JSON.stringify({ format: 'wav' }) })).status, 403)
    assert.equal((await call('/api/audio/settings/export', editorId, { method: 'PUT', body: JSON.stringify({ sample_rate: 12345 }) })).status, 422)
    const saved = (await call('/api/audio/settings/export', editorId, { method: 'PUT', body: JSON.stringify({ format: 'wav', normalize: false }) })).json().data
    assert.equal(saved.format, 'wav')
    assert.equal(saved.normalize, false)
    assert.equal(saved.target_lufs, -16)
    assert.deepEqual(exporting.resolveAudioExportOptions({ format: 'ogg' }), { ...saved, format: 'ogg' }, 'request options override the saved ones')
  })

  await t.test('single export: a selected take is named by its group label, others by their own name', async () => {
    const plain = await call(`/api/audio/candidates/${source.id}/export?format=wav&normalize=false`, listenerId)
    assert.equal(plain.status, 200)
    assert.match(plain.headers.get('content-disposition') ?? '', /take%20one\.wav/)
    assert.deepEqual(plain.buffer, fs.readFileSync(sweep), 'a stored WAV exported as plain WAV is the stored file')
    select(source.id)
    const labelled = await call(`/api/audio/candidates/${source.id}/export?format=ogg`, listenerId)
    assert.equal(labelled.status, 200)
    assert.equal(labelled.headers.get('content-type'), 'audio/ogg')
    assert.match(labelled.headers.get('content-disposition') ?? '', /footstep_snow_01\.ogg/)
    assert.equal(labelled.buffer.subarray(0, 4).toString('ascii'), 'OggS')
  })

  await t.test('group / project export: 409 without selections, one file direct, several as a ZIP, manifest shape', async () => {
    assert.equal((await call(`/api/audio/groups/${stone.id}/export`, listenerId)).status, 409)
    const one = await call(`/api/audio/groups/${snow.id}/export?format=wav&normalize=false`, listenerId)
    assert.equal(one.status, 200)
    assert.match(one.headers.get('content-disposition') ?? '', /footstep_snow_01\.wav/)
    const second = await service.importAudioUpload({ groupId: snow.id }, staged(tone('two.wav', 550)), 'take two.wav', null)
    select(second.id)
    const third = await service.importAudioUpload({ groupId: stone.id }, staged(tone('three.wav', 660)), 'stone take.wav', null)
    select(third.id)
    const zip = await call(`/api/audio/projects/${project.id}/export?format=wav&normalize=false`, listenerId)
    assert.equal(zip.status, 200)
    assert.equal(zip.headers.get('content-type'), 'application/zip')
    assert.match(zip.headers.get('content-disposition') ?? '', /%EA%B2%8C%EC%9E%84%20A-selected\.zip/)
    assert.deepEqual(await zipNames(zip.buffer), ['footstep_snow_01.wav', 'footstep_snow_02.wav', 'stone.wav'])
    const groupZip = await call(`/api/audio/groups/${snow.id}/export?format=ogg`, listenerId)
    assert.deepEqual(await zipNames(groupZip.buffer), ['footstep_snow_01.ogg', 'footstep_snow_02.ogg'])

    const plan = (await call(`/api/audio/projects/${project.id}/export/manifest?format=wav`, listenerId)).json().data
    assert.deepEqual(Object.keys(plan).sort(), ['count', 'download_url', 'files', 'options', 'project_name'])
    assert.equal(plan.count, 3)
    assert.deepEqual(Object.keys(plan.files[0]).sort(), ['filename', 'group_id', 'group_name', 'id', 'label'])
    assert.match(plan.download_url, new RegExp(`^/api/audio/projects/${project.id}/export\\?format=wav&quality=3&normalize=false`))
    const groupPlan = (await call(`/api/audio/projects/${project.id}/export/manifest?group_id=${stone.id}`, listenerId)).json().data
    assert.match(groupPlan.download_url, new RegExp(`^/api/audio/groups/${stone.id}/export\\?`))
    assert.equal((await call(`/api/audio/projects/${project.id}/export`)).status, 401)
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(fs.readdirSync(path.join(root, 'temp', 'audio-exports')).length, 0, 'inline exports leave no workspace')
  })

  await t.test('export names follow the original collision vectors (409 never overwrites)', () => {
    for (const vector of manifest.naming.collision_vectors) {
      const owner = service.createAudioProject({ name: `collide ${vector.id}` }, null)
      for (const spec of vector.groups_in_creation_order) {
        const group = service.createAudioGroup(owner.id, { name: spec.name, label: spec.label })
        for (let i = 0; i < spec.selected_count; i += 1) {
          const file = store.getAudioFile(source.file_hash)!
          audioDb.prepare(`INSERT INTO audio_candidates (id, group_id, file_hash, origin, name, review, notes, created_at, updated_at)
            VALUES (?, ?, ?, 'uploaded', ?, 'selected', '', ?, ?)`).run(crypto.randomUUID(), group.id, file.hash, `${spec.name} ${i}`, new Date().toISOString(), new Date().toISOString())
        }
      }
      const options = { ...exporting.DEFAULT_AUDIO_EXPORT_OPTIONS, format: vector.format as 'wav' | 'ogg' }
      if (vector.status_code) {
        assert.throws(() => exporting.audioExportPlan(owner.id, null, options),
          (error: unknown) => error instanceof service.AudioServiceError && error.status === 409 && error.message === vector.detail, vector.id)
      } else {
        assert.deepEqual(exporting.audioExportPlan(owner.id, null, options).files.map((file) => file.filename), vector.files!.map((file) => file.filename), vector.id)
      }
    }
  })

  await t.test(`more than ${20} files export as a background job, downloadable by its starter only`, async () => {
    const bulk = service.createAudioProject({ name: 'bulk' }, null)
    const group = service.createAudioGroup(bulk.id, { name: 'UI', label: 'ui_[00]' })
    const blip = path.join(GOLDEN, 'audio', 'inputs', 'short_blip_mono22k.wav')
    for (let i = 0; i < 21; i += 1) {
      const candidate = await service.importAudioUpload({ groupId: group.id }, staged(blip), `blip ${i}.wav`, null)
      select(candidate.id)
    }
    const started = await call(`/api/audio/groups/${group.id}/export?format=wav&normalize=false`, editorId)
    assert.equal(started.status, 202)
    const jobId = started.json().data.job.jobId as string
    let job: { status: string; result: { export_id: string; file_name: string; count: number } } | null = null
    for (let tries = 0; tries < 200; tries += 1) {
      job = (await call(`/api/jobs/${jobId}`, editorId)).json().data
      if (job && ['completed', 'failed', 'cancelled'].includes(job.status)) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(job?.status, 'completed', JSON.stringify(job))
    assert.equal(job!.result.count, 21)
    const download = await call(`/api/audio/exports/${job!.result.export_id}/download`, editorId)
    assert.equal(download.status, 200)
    const names = await zipNames(download.buffer)
    assert.equal(names.length, 21)
    assert.equal(names[0], 'ui_01.wav')
    assert.equal(names[20], 'ui_21.wav')
    assert.equal((await call(`/api/audio/exports/${job!.result.export_id}/download`, listenerId)).status, 404, 'another account cannot fetch it')
    assert.equal((await call(`/api/audio/exports/${job!.result.export_id}/download`, adminId)).status, 200, 'admins can')
  })

  await t.test('deletion plan freezes ids; a take selected in the meantime stops an unselected-only delete', async () => {
    const group = service.createAudioGroup(project.id, { name: '정리', label: 'cleanup_[00]' })
    const a = await service.importAudioUpload({ groupId: group.id }, staged(tone('d1.wav', 300)), 'a.wav', null)
    const b = await service.importAudioUpload({ groupId: group.id }, staged(tone('d2.wav', 310)), 'b.wav', null)
    const c = await service.importAudioUpload({ groupId: group.id }, staged(tone('d3.wav', 320)), 'c.wav', null)
    select(c.id)
    const plan = (await call(`/api/audio/groups/${group.id}/candidates/deletion?scope=unselected`, listenerId)).json().data
    assert.deepEqual(plan, { candidate_ids: [a.id, b.id], count: 2, selected_count: 0 })
    assert.equal((await call(`/api/audio/groups/${group.id}/candidates/deletion?scope=all`, listenerId)).json().data.selected_count, 1)
    assert.equal((await call(`/api/audio/groups/${group.id}/candidates/deletion?scope=bad`, listenerId)).status, 422)
    select(b.id)
    const refused = await call(`/api/audio/groups/${group.id}/candidates/delete`, editorId, { method: 'POST', body: JSON.stringify({ candidate_ids: plan.candidate_ids }) })
    assert.equal(refused.status, 409)
    assert.equal(service.getAudioCandidate(a.id).deleted_at, null, 'nothing was deleted')
    assert.equal((await call(`/api/audio/groups/${group.id}/candidates/delete`, listenerId, { method: 'POST', body: JSON.stringify({ candidate_ids: [a.id] }) })).status, 403)
    assert.equal((await call(`/api/audio/groups/${stone.id}/candidates/delete`, editorId, { method: 'POST', body: JSON.stringify({ candidate_ids: [a.id] }) })).status, 404, 'ids must belong to the group')
    const done = await call(`/api/audio/groups/${group.id}/candidates/delete`, editorId, { method: 'POST', body: JSON.stringify({ candidate_ids: plan.candidate_ids, include_selected: true }) })
    assert.deepEqual(done.json().data, { deleted: 2 })
    assert.ok(service.getAudioCandidate(b.id).deleted_at)
  })

  // ---------------------------------------------------------------- MCP
  await t.test('MCP: edit / cleanup / export / download tools, artifact ownership, review still people-only', async () => {
    const { createMcpServer } = await import('../src/mcp/server')
    const { ALL_MCP_HTTP_SCOPES } = await import('../src/mcp/context')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
    const connect = async (requester?: { accountId: number; accountType: 'admin' | 'guest' }) => {
      const mcp = createMcpServer({ scopes: [...ALL_MCP_HTTP_SCOPES], source: 'http', baseUrl: origin, ...(requester ? { requester } : {}) })
      const client = new Client({ name: 'audio-edit-test', version: '1' })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)])
      t.after(async () => { await client.close(); await mcp.close() })
      return client
    }
    type ToolReply = { isError?: boolean; content: Array<{ text: string }> }
    const tool = async (client: Awaited<ReturnType<typeof connect>>, name: string, args: Record<string, unknown>) => {
      const reply = await client.callTool({ name, arguments: args }) as ToolReply
      return { error: reply.isError === true, text: reply.content[0]?.text ?? '', json: () => JSON.parse(reply.content[0].text) }
    }
    const names = async (client: Awaited<ReturnType<typeof connect>>) => (await client.listTools()).tools.map((entry) => entry.name)

    const listener = await connect({ accountId: listenerId, accountType: 'guest' })
    const editor = await connect({ accountId: editorId, accountType: 'guest' })
    const listenerTools = await names(listener)
    assert.ok(listenerTools.includes('get_audio_download') && listenerTools.includes('export_audio_selected'))
    assert.ok(!listenerTools.includes('edit_audio_candidate') && !listenerTools.includes('delete_unselected_audio_candidates'))
    const editorTools = await names(editor)
    assert.ok(editorTools.includes('edit_audio_candidate') && editorTools.includes('delete_unselected_audio_candidates'))
    assert.deepEqual(editorTools.filter((name) => /review|restore_audio|create_audio_group_comment|delete_audio/.test(name)), [], 'no review tool, no unrestricted delete')

    const edited = await tool(editor, 'edit_audio_candidate', { candidate_id: source.id, start: 0.1, end: 0.9, speed: 1.5, request_key: 'mcp-edit-0001' })
    assert.equal(edited.error, false, edited.text)
    assert.equal(edited.json().parent_candidate_id, source.id)
    assert.equal(edited.json().origin, 'edited')
    assert.equal((await tool(listener, 'edit_audio_candidate', { candidate_id: source.id, end: 0.9 })).error, true)

    const refused = await tool(editor, 'delete_unselected_audio_candidates', { group_id: snow.id, candidate_ids: [source.id] })
    assert.equal(refused.error, true)
    assert.match(refused.text, /채택/)
    const cleared = await tool(editor, 'delete_unselected_audio_candidates', { group_id: snow.id, candidate_ids: [edited.json().candidate_id] })
    assert.deepEqual(cleared.json(), { deleted: 1 })

    const exported = await tool(editor, 'export_audio_selected', { project_id: project.id, audio_group_id: snow.id, format: 'wav', normalize: false })
    assert.equal(exported.error, false, exported.text)
    const reply = exported.json()
    assert.deepEqual(reply.manifest.files.map((file: { filename: string }) => file.filename), ['footstep_snow_01.wav', 'footstep_snow_02.wav'])
    assert.equal(reply.artifact.mime_type, 'application/zip')
    assert.match(reply.artifact.download_url, /\/api\/audio\/exports\/[0-9a-f-]+\/download$/)
    const downloaded = await fetch(reply.artifact.download_url, { headers: { 'x-test-account': String(editorId) } })
    assert.equal(downloaded.status, 200)
    assert.equal((await fetch(reply.artifact.download_url, { headers: { 'x-test-account': String(listenerId) } })).status, 404)
    const refreshedByOther = await tool(listener, 'refresh_artifact_download', { artifact_id: reply.artifact.artifact_id })
    assert.equal(refreshedByOther.error, true, 'another account cannot refresh the export artifact')
    const refreshed = await tool(editor, 'refresh_artifact_download', { artifact_id: reply.artifact.artifact_id })
    assert.equal(refreshed.error, false, refreshed.text)

    const single = await tool(listener, 'get_audio_download', { candidate_id: source.id })
    assert.equal(single.error, false, single.text)
    assert.match(single.json().artifact.download_url, new RegExp(`/api/audio/candidates/${source.id}/file\\?download=1$`))
    assert.equal(single.json().artifact.sha256, crypto.createHash('sha256').update(fs.readFileSync(sweep)).digest('hex'))
    const keyClient = await connect()
    const signed = await tool(keyClient, 'get_audio_download', { candidate_id: source.id })
    assert.match(signed.json().artifact.download_url, /\/mcp\/artifacts\//, 'unbound keys get the signed artifact URL')
    assert.equal((await tool(listener, 'get_audio_download', {})).error, true)
  })
})
