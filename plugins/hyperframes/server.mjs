import { validateProject, assetPath, reference, MAX_DOCUMENT, starter } from './project.mjs'
import { renderProject, rendererStatus, cleanupInterruptedRenders } from './render.mjs'
import { projectCatalog } from './catalog.mjs'
import { rendererInstaller } from './installer.mjs'

function textResult(result) {
  const text = result?.content?.filter(p => p.type === 'text').map(p => p.text).join('\n') ?? ''
  if (result?.isError) throw new Error(text || '앱 도구 실행에 실패했어.')
  try { return JSON.parse(text) } catch { throw new Error(text.slice(0, 1000) || '앱 도구 결과가 없어.') }
}
const objectSchema = properties => ({ type: 'object', properties, additionalProperties: false })
const idSchema = { type: 'string', pattern: '^[a-f0-9]{32}$' }
const revisionSchema = { type: 'string', pattern: '^[a-f0-9]{64}$' }
const requestSchema = { type: 'string', minLength: 8, maxLength: 80, pattern: '^[a-zA-Z0-9_-]+$' }
function fileId(id) { if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('파일 ID를 확인해줘.'); return id }
function requestId(id) { if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) throw new Error('재시도에 사용할 requestId가 필요해.'); return id }

export async function activate(conai) {
  await cleanupInterruptedRenders(conai.dataDir)
  const catalog = projectCatalog(conai.db)
  const installer = rendererInstaller(conai.dataDir)
  // Installing downloads npm packages that then run on the host, so only administrators may start or cancel it.
  const requireAdmin = account => { if (account?.type !== 'admin') throw new Error('렌더러 설치는 관리자만 할 수 있어.') }
  const status = async account => ({ ...await rendererStatus(conai.dataDir), install: installer.snapshot(), canInstall: account?.type === 'admin' })
  const call = async (name, args) => textResult(await conai.tools.call(name, args))
  async function readProject(id, expectedRevision) {
    fileId(id)
    let text = '', offset = 0, revision
    do {
      let part
      try {
        part = await call('read_file_text', { file_id: id, offset, limit: 16000, source: 'original', ...(revision || expectedRevision ? { revision: revision ?? expectedRevision } : {}) })
      } catch (error) {
        // The native MCP contract currently carries errors as text. Only its exact not-found
        // response may evict derived references; permission/network/revision failures keep them.
        if (error.message === '파일 또는 폴더를 찾을 수 없어.') catalog.forgetMissing(id)
        throw error
      }
      if (!revision) revision = part.revision
      text += part.text
      if (new TextEncoder().encode(text).length > MAX_DOCUMENT) throw new Error('프로젝트가 64KB를 넘었어.')
      offset = part.nextOffset
    } while (offset !== null && offset !== undefined)
    const saved = { fileId: id, revision, project: validateProject(text) }
    catalog.remember(saved)
    return saved
  }
  async function bindAssets(assets) {
    if (!Array.isArray(assets) || assets.length > 24) throw new Error('소재는 24개까지 선택해줘.')
    const result = []
    for (const a of assets) {
      const ref = reference(a.reference), media = await conai.media.resolve(ref)
      if (a.fingerprint && a.fingerprint !== media.fingerprint) throw new Error(`소재 ${a.id}이 바뀌었어. 다시 선택해줘.`)
      result.push({ id: a.id, reference: ref, ...(a.label ? { label: a.label } : {}), fingerprint: media.fingerprint, mimeType: media.mimeType, path: assetPath(a.id, media.mimeType) })
    }
    return result
  }
  async function saveProject(args) {
    requestId(args.requestId)
    const project = validateProject(args.document)
    project.assets = await bindAssets(project.assets)
    const text = JSON.stringify(project, null, 2)
    validateProject(text)
    let saved
    if (args.fileId) {
      fileId(args.fileId)
      if (!/^[a-f0-9]{64}$/.test(args.revision)) throw new Error('수정할 파일의 최신 revision이 필요해.')
      await readProject(args.fileId, args.revision)
      saved = await call('update_file_text', { file_id: args.fileId, text, expected_revision: args.revision })
    } else {
      const title = project.title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
      let filenameTitle = ''
      for (const character of title) { if (Buffer.byteLength(filenameTitle + character) > 120) break; filenameTitle += character }
      saved = await call('write_text_file', { name: `HyperFrames-${args.requestId}-${filenameTitle}.json`, text, overwrite: false })
    }
    const result = { fileId: saved.id, revision: saved.revision, project }
    catalog.remember(result)
    return result
  }
  async function startRender(args, { account }) {
    requestId(args.requestId)
    if (!/^[a-f0-9]{64}$/.test(args.revision)) throw new Error('저장한 프로젝트의 revision이 필요해.')
    const saved = await readProject(args.fileId, args.revision)
    const input = { ...saved, preview: args.preview === true }
    const job = await conai.jobs.start({ requestId: args.requestId, data: input })
    catalog.started(input, job.jobId, account)
    return job
  }
  async function listProjects(args) {
    await call('list_files', { limit: 1 }) // Recheck native shared-file access before returning index data.
    return catalog.list(args)
  }
  async function history(id, account) {
    await call('get_file_info', { file_id: fileId(id) })
    return { items: catalog.history(id, account) }
  }
  async function jobStatus(jobId) {
    const job = await conai.jobs.get(jobId)
    catalog.finished(jobId, job.status, job.result?.compositeHash)
    return job
  }
  const guide = () => ({
    workflow: 'Search existing CoNAI media first. Use search_images (media_type image/video/animated, prompt search, group_id), search_images_by_tags, or search_images_by_meaning (only if embeddings are available); search_files for shared files and list_audio_candidates for audio. Inspect candidates with get_image_metadata/view_images/view_media_frames when available. Never invent IDs, paths, URLs or visual content. inspect_assets binds chosen IDs to immutable source fingerprints and returns exact local asset paths. Build a HyperFrames JSON document and save_project. Revisions are mandatory for edits and renders. render returns a durable jobId immediately; use job_status/cancel_render. Report success only after completed. Outputs go into the native library.',
    project: starter('영상 제목'),
    management: 'list_projects searches indexed projects by title and stage (draft/completed/archived). read_project registers older files in the index; search_files can discover older HyperFrames JSON files. Rename or change stage through save_project with the current revision. Duplicate by saving a document with a new requestId and no fileId. project_history returns your latest 20 output references per project. Files are shared; job history is account-scoped. Stage is an editorial label, not proof of a successful render.',
    authoring: 'HTML composition must have data-composition-id="main", data-start="0", data-duration equal to project.duration, data-width and data-height. Mark timed scenes with class="clip", data-start, data-duration and data-track-index. Use local asset.path values in img/video/audio src. Use muted playsinline on video when its audio is not wanted. Available animation library: vendor/gsap.min.js; create a paused GSAP timeline and set window.__timelines={main:timeline}. No external URLs, imports, package installs or credentials: a render uses only files of the project. Fonts include Noto Sans CJK KR. Keep projects <=64KB, 24 assets, 120s, 1080p, 24/30fps. Keep code in html, media references in assets. A media source must be selected again when its fingerprint changes. Optional scenes [{asset, seconds, caption}] is the editor storyboard; the page rebuilds html from it only when the user asks, so when you change scene order or timing in html, update scenes to match or omit them. A scene may also carry motion (zoom-in default, zoom-out, pan-left, pan-right, none), transition (0-2 seconds of cross-fade from the scene before) and captionPosition (center default, top, bottom); project.style {captionSize 3-25 (percent of the short side), accent "#rrggbb", musicVolume 0-1} applies to html built from scenes. Give each asset a short label (<=40 characters): the user refers to sources by that name. When you write html yourself, expose the values the user is likely to tune as project.controls, at most 12: {id, label, type:"range", min, max, step, value, unit?} | {id, label, type:"toggle", value:true|false} | {id, label, type:"color", value:"#rrggbb"}. Each is the CSS custom property --<id> on :root (a toggle is 1 or 0, a range is a bare number: write calc(var(--speed) * 1s)); read it in CSS with var(--id) or in script with getComputedStyle(document.documentElement).getPropertyValue("--id"). Saving writes the current values into a <style id="hf-controls"> block in html, so never hard-code a value that has a control and never write that block yourself.',
    sourceExamples: [{ id: 'photo', reference: { source: 'library', compositeHash: '<hash returned by search_images>' } }, { id: 'clip', reference: { source: 'files', fileId: '<id returned by search_files>' } }, { id: 'music', reference: { source: 'audio', candidateId: '<id returned by list_audio_candidates>' } }],
  })
  const definitions = [
    { name: 'list_projects', description: 'Search saved HyperFrames projects, newest first, 20 per page. Archived projects are hidden by default. Documents stay in shared files; read_project registers legacy files.', scope: 'read', inputSchema: objectSchema({ query: { type: 'string', maxLength: 100 }, stage: { type: 'string', enum: ['active', 'all', 'draft', 'completed', 'archived'] }, offset: { type: 'integer', minimum: 0, maximum: 1000000 } }), handler: listProjects },
    { name: 'project_history', description: 'Read your latest 20 rendering jobs and saved output references for a HyperFrames project. Use job_status for live state; library output remains available after job expiry.', scope: 'read', inputSchema: { ...objectSchema({ fileId: idSchema }), required: ['fileId'] }, handler: (args, context) => history(args.fileId, context.account) },
    { name: 'guide', description: 'Read the HyperFrames project format, local media search workflow, rendering limits and HTML animation example before creating/editing a video.', scope: 'read', inputSchema: objectSchema({}), handler: guide },
    { name: 'inspect_assets', description: 'Validate chosen INTERNAL image/video/audio IDs and return exact asset paths and source fingerprints for a HyperFrames project. Search with native search_images/search_files first; this does not copy or modify originals.', scope: 'read', inputSchema: { ...objectSchema({ assets: { type: 'array', maxItems: 24, items: { type: 'object', properties: { id: { type: 'string' }, reference: { type: 'object' } }, required: ['id', 'reference'] } } }), required: ['assets'] }, handler: async args => ({ assets: await bindAssets(args.assets) }) },
    { name: 'read_project', description: 'Read a saved HyperFrames JSON project and its revision from the native shared file store.', scope: 'read', inputSchema: { ...objectSchema({ fileId: idSchema }), required: ['fileId'] }, handler: args => readProject(args.fileId) },
    { name: 'save_project', description: 'Save a validated HyperFrames document to shared files, binding its internal media sources. Pass fileId and revision for conflict-safe edits. New documents require a unique stable requestId; never overwrite another project.', scope: 'organize', inputSchema: { ...objectSchema({ document: { type: 'string', maxLength: MAX_DOCUMENT }, fileId: idSchema, revision: revisionSchema, requestId: requestSchema }), required: ['document', 'requestId'] }, handler: saveProject },
    { name: 'render', description: 'Render a SAVED HyperFrames project with its exact revision and internal media. Returns a durable jobId, NOT a completed video. Reuse requestId only for an identical retry. Preview uses draft quality. Read job_status for completion, library result and source provenance.', scope: 'generate', inputSchema: { ...objectSchema({ fileId: idSchema, revision: revisionSchema, requestId: requestSchema, preview: { type: 'boolean' } }), required: ['fileId', 'revision', 'requestId'] }, handler: startRender },
    { name: 'job_status', description: 'Read your HyperFrames render progress, errors, result library hash and source references. Does not restart failed renders.', scope: 'read', inputSchema: { ...objectSchema({ jobId: { type: 'string', format: 'uuid' } }), required: ['jobId'] }, handler: args => jobStatus(args.jobId) },
    { name: 'cancel_render', description: 'Cancel your running HyperFrames render. Does not delete already saved library output.', scope: 'generate', inputSchema: { ...objectSchema({ jobId: { type: 'string', format: 'uuid' } }), required: ['jobId'] }, handler: args => conai.jobs.cancel(args.jobId) },
    { name: 'renderer_status', description: 'Check whether the HyperFrames renderer can run: a Chromium browser on the host and the installed renderer package, plus the progress of a renderer install.', scope: 'read', inputSchema: objectSchema({}), handler: (args, context) => status(context.account) },
    { name: 'install_renderer', description: 'Install the HyperFrames renderer package with npm into the plugin data folder (a few minutes, needs network and npm). Returns at once without a job ID (task_wait cannot wait on it): do not poll, tell the user it is installing and check renderer_status once in a later turn. Administrators only.', scope: 'configure', inputSchema: objectSchema({}), handler: async (args, context) => {
      requireAdmin(context.account)
      // Installing replaces the renderer folder, which a running render is using.
      if ((await rendererStatus(conai.dataDir)).package.ok) throw new Error('렌더러 패키지는 이미 설치돼 있어.')
      return installer.start()
    } },
    { name: 'cancel_renderer_install', description: 'Cancel a running HyperFrames renderer install. Administrators only.', scope: 'configure', inputSchema: objectSchema({}), handler: (args, context) => { requireAdmin(context.account); return installer.cancel() } },
  ]
  for (const definition of definitions) conai.tools.register(definition)
  conai.onRequest(async ({ body, account }) => {
    // Page requests are read-only. Mutations use app.call (the account's permissions and request-ID idempotency); assistant review comes from the commit-tier page actions.
    if (body?.op === 'guide') return guide()
    if (body?.op === 'status') return status(account)
    if (body?.op === 'read') return readProject(body.fileId)
    if (body?.op === 'inspect') return { assets: await bindAssets(body.assets) }
    if (body?.op === 'list') return listProjects({ query: body.query, stage: body.stage, offset: body.offset })
    if (body?.op === 'history') return history(body.fileId, account)
    if (body?.op === 'job') return jobStatus(body.jobId)
    throw new Error('지원하지 않는 요청이야.')
  })
  conai.onJob(async (input, context) => {
    catalog.started(input, context.jobId, context.account, 'running')
    try {
      const result = await renderProject(conai, input, context)
      catalog.finished(context.jobId, 'completed', result.compositeHash)
      return result
    } catch (error) {
      catalog.finished(context.jobId, context.signal.aborted ? 'cancelled' : 'failed')
      throw error
    }
  })
}
