import fs from 'node:fs/promises'
import path from 'node:path'
import { hostEnv, run } from './process.mjs'

// The renderer package is installed with npm into the plugin's data folder, one folder per pinned version.
export const VERSION = '0.8.163'
export const rendererDir = dataDir => path.join(dataDir, 'renderer', VERSION)
// Written only after npm succeeds, so a cancelled or failed install never counts as installed.
const marker = dataDir => path.join(rendererDir(dataDir), 'installed.json')
export const packageStatus = async dataDir => ({ ok: await fs.access(marker(dataDir)).then(() => true, () => false), version: VERSION })

/** One background install per server module. It survives closed pages. */
export function rendererInstaller(dataDir) {
  let state = { status: 'idle' }, controller = null
  const note = line => { state.log = [...state.log, line.slice(0, 300)].slice(-6) }
  async function install(signal) {
    try {
      const root = rendererDir(dataDir)
      // Also drops other versions and whatever an interrupted install left behind.
      await fs.rm(path.dirname(root), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      await fs.mkdir(root, { recursive: true })
      await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
      // The browser comes from the host (see render.mjs), so Puppeteer must not download its own.
      await run(`npm install --omit=dev --save-exact --no-audit --no-fund @hyperframes/producer@${VERSION}`, [], { cwd: root, shell: true, signal, timeoutMs: 30 * 60_000, env: hostEnv({ PUPPETEER_SKIP_DOWNLOAD: 'true' }), onLine: note })
      await fs.writeFile(marker(dataDir), JSON.stringify({ version: VERSION }))
      state = { ...state, status: 'completed', finishedAt: Date.now() }
    } catch (error) {
      state = { ...state, status: signal.aborted ? 'cancelled' : 'failed', error: String(error?.message ?? error).slice(-600), finishedAt: Date.now() }
    } finally { controller = null }
  }
  return {
    start() {
      if (controller) return this.snapshot()
      controller = new AbortController()
      state = { status: 'running', log: [], startedAt: Date.now() }
      void install(controller.signal)
      return this.snapshot()
    },
    cancel() { controller?.abort(new Error('설치를 취소했어.')); return this.snapshot() },
    snapshot() { return { ...state, log: [...(state.log ?? [])] } },
  }
}
