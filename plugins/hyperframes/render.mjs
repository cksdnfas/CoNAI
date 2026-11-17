import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateProject } from './project.mjs'
import { hostEnv, run } from './process.mjs'
import { packageStatus, rendererDir } from './installer.mjs'

// The CoNAI Docker image ships /usr/bin/chromium; a direct install uses the Chrome or Edge already on the machine.
function browserPath() {
  const candidates = process.env.PUPPETEER_EXECUTABLE_PATH ? [process.env.PUPPETEER_EXECUTABLE_PATH]
    : process.platform === 'win32' ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
      .flatMap(base => [path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe')])
    : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
  return candidates.find(file => existsSync(file))
}
// A packaged CoNAI executable is not a Node binary; it then needs node on PATH.
const NODE = /^node(\.exe)?$/i.test(path.basename(process.execPath)) ? process.execPath : 'node'

/** Whether a render can start now, and what is missing when it cannot. */
export async function rendererStatus(dataDir) {
  const file = browserPath(), browser = file ? { ok: true, path: file } : { ok: false }
  const installed = await packageStatus(dataDir)
  return { ready: browser.ok && installed.ok, browser, package: installed }
}
export async function cleanupInterruptedRenders(dataDir) {
  const root = path.join(dataDir, 'renders')
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue
    const target = path.join(root, entry.name), stat = await fs.lstat(target)
    // Renders have a hard 570s deadline. Never disturb a recently interrupted render still exiting.
    if (!stat.isSymbolicLink() && Date.now() - stat.mtimeMs > 20 * 60_000) await fs.rm(target, { recursive: true, force: true })
  }
}
export async function renderProject(conai, input, context) {
  const { signal, jobId, report } = context
  const project = validateProject(input.project)
  const work = path.join(conai.dataDir, 'renders', jobId), source = path.join(work, 'input')
  // UUID is supplied by the host, never by the project/model.
  if (!/^[a-f0-9-]{36}$/.test(jobId)) throw new Error('잘못된 작업 ID야.')
  for (const folder of [path.join(source, 'assets'), path.join(source, 'vendor'), path.join(work, 'output')]) await fs.mkdir(folder, { recursive: true })
  // Chromium profiles and the renderer's frame files. Chromium puts a Unix socket in its profile, whose path must stay
  // under about 100 characters, so this cannot live inside the (long) job folder.
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'hf-'))
  const references = []
  try {
    const status = await rendererStatus(conai.dataDir)
    if (!status.ready) throw new Error('렌더러가 준비되지 않았어. 영상 제작 화면에서 렌더러 상태를 확인해줘.')
    let total = 0
    for (const asset of project.assets) {
      signal.throwIfAborted()
      const resolved = await conai.media.resolve(asset.reference)
      if (!asset.fingerprint || asset.fingerprint !== resolved.fingerprint || asset.mimeType !== resolved.mimeType) throw new Error(`소재 ${asset.id}의 원본이 변경됐어. 다시 선택한 뒤 저장해줘.`)
      total += resolved.size
      if (resolved.size > 512 * 1024 * 1024 || total > 1536 * 1024 * 1024) throw new Error('소재는 개별 512MB·전체 1.5GB까지 지원해.')
      await fs.copyFile(resolved.path, path.join(source, asset.path))
      const current = await conai.media.resolve(asset.reference)
      if (current.fingerprint !== asset.fingerprint) throw new Error(`소재 ${asset.id}이 복사 중에 바뀌었어.`)
      references.push({ id: asset.id, reference: asset.reference, fingerprint: asset.fingerprint })
    }
    signal.throwIfAborted()
    await fs.writeFile(path.join(source, 'index.html'), project.html)
    await fs.copyFile(new URL('./vendor/gsap.min.js', import.meta.url), path.join(source, 'vendor', 'gsap.min.js'))
    await fs.writeFile(path.join(work, 'render.json'), JSON.stringify({ width: project.width, height: project.height, fps: project.fps, duration: project.duration, preview: input.preview === true }))
    // Node resolves the renderer package from the script's own folder, so the script runs from beside node_modules.
    const script = path.join(rendererDir(conai.dataDir), 'render.mjs')
    await fs.copyFile(new URL('./renderer/render.mjs', import.meta.url), script)
    await report({ percent: 1, phase: 'rendering', message: '내부 소재를 연결했어. 영상 렌더링 중…' })
    const env = hostEnv({
      TMPDIR: temp, TEMP: temp, TMP: temp, PUPPETEER_EXECUTABLE_PATH: status.browser.path,
      PRODUCER_CONCURRENCY: '1', PRODUCER_DISABLE_GPU: 'true', PRODUCER_FORCE_SCREENSHOT: 'true',
    })
    signal.throwIfAborted()
    await run(NODE, [script, work], {
      cwd: path.dirname(script), env, signal, timeoutMs: 570000, onLine: line => {
        try { const p = JSON.parse(line); if (typeof p.percent === 'number') void report({ percent: Math.min(95, 5 + p.percent * 0.9), phase: 'rendering' }).catch(() => {}) } catch { /* renderer log */ }
      },
    })
    signal.throwIfAborted()
    // Recheck rights and source identities before publishing a result built from them.
    for (const asset of project.assets) if ((await conai.media.resolve(asset.reference)).fingerprint !== asset.fingerprint) throw new Error(`소재 ${asset.id}이 변경됐어. 결과를 저장하지 않았어.`)
    await report({ percent: 96, phase: 'saving', message: '라이브러리에 결과 저장 중…' })
    const saved = await conai.media.save({ path: path.posix.join('renders', jobId, 'output', 'output.mp4'), groupPath: input.preview ? 'HyperFrames/미리보기' : 'HyperFrames/완성' })
    return { ...saved, projectFileId: input.fileId, projectRevision: input.revision, title: project.title, preview: !!input.preview, sources: references }
  } catch (error) {
    // Keep absolute data paths and renderer internals out of assistant/browser errors.
    throw new Error(String(error?.message ?? error).split(conai.dataDir).join('[플러그인 데이터]').slice(-2000))
  } finally {
    // A just-killed Chromium can hold its files for a moment on Windows.
    for (const folder of [work, temp]) await fs.rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
  }
}
