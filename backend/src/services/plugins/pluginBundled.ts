import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { installPlugin, unpackPlugin } from './pluginRegistry'
import { pluginDb } from './pluginStore'
import type { BundledPluginFailure } from '@conai/shared'

/** Where the build left the official packages (`scripts/build-plugin.mjs --bundled`); null when this run has none, e.g. an unbuilt dev checkout. */
function bundledFolder() {
  const candidates = [
    path.join(__dirname, 'bundled-plugins'),
    path.join(__dirname, '../../../../bundled-plugins'),
    path.join(__dirname, '../../../dist/bundled-plugins'),
    path.join(path.dirname(process.execPath), 'bundled-plugins'),
  ]
  return candidates.find(candidate => fs.existsSync(candidate)) ?? null
}

/** The source checkout this server runs from, if it is one; a packaged or Docker runtime has none. */
function sourceRoot() {
  let folder = __dirname
  for (let depth = 0; depth < 7; depth++, folder = path.dirname(folder)) {
    if (fs.existsSync(path.join(folder, 'scripts', 'build-plugin.mjs')) && fs.existsSync(path.join(folder, 'plugins', 'sdk'))) return folder
  }
  return null
}
function newestChange(target: string): number {
  const stats = fs.statSync(target)
  return stats.isDirectory() ? Math.max(stats.mtimeMs, ...fs.readdirSync(target).map(name => newestChange(path.join(target, name)))) : stats.mtimeMs
}
/**
 * In a source checkout the packages are a build output, and neither the dev server nor a plugin-only change rebuilds them.
 * So before a sync, a package older than its `plugins/<name>` folder or the SDK is packed again; one that cannot be built is
 * returned as failed and left out of this sync.
 */
async function rebuildFromSource(folder: string) {
  const root = sourceRoot(), failed = new Set<string>()
  if (!root || path.resolve(folder) !== path.join(root, 'backend', 'dist', 'bundled-plugins')) return failed
  for (const file of fs.readdirSync(folder).filter(name => name.endsWith('.zip'))) {
    const name = file.slice(0, -4), source = path.join(root, 'plugins', name)
    if (!fs.existsSync(source)) continue
    if (Math.max(newestChange(source), newestChange(path.join(root, 'plugins', 'sdk'))) <= fs.statSync(path.join(folder, file)).mtimeMs) continue
    try { await promisify(execFile)(process.execPath, [path.join(root, 'scripts', 'build-plugin.mjs'), '--bundled', name], { cwd: root }) }
    catch (error) {
      const text = String((error as { stderr?: string }).stderr || (error instanceof Error ? error.message : error))
      failures.set(file, { file, pluginId: name, error: text.split(/\r?\n/).find(line => line.startsWith('Error: '))?.slice(7) ?? text.trim().slice(-500) })
      failed.add(file)
    }
  }
  return failed
}

// What this process's syncs did, for plugin management: nothing here survives a restart, where the sync runs again.
const updatedThisStart = new Set<string>()
const failures = new Map<string, BundledPluginFailure>()
let running: Promise<string[]> | null = null

/** Official packages this app start replaced with a newer build. */
export const bundledUpdatedThisStart = (pluginId: string) => updatedThisStart.has(pluginId)
/** Official packages the last sync could not install or update, with the reason. */
export const bundledPluginFailures = () => [...failures.values()]

/**
 * Brings the official packages that ship with this build in line with the install: a missing one is installed (off), a
 * different build of an installed one replaces it in place and keeps its on/off state and data. One broken package never
 * stops the others or startup; it is kept as a failure that management shows and can retry. Concurrent calls share one run.
 * Resolves with the ids this run installed or replaced.
 */
export function syncBundledPlugins(folder = bundledFolder()) {
  running ??= sync(folder).finally(() => { running = null })
  return running
}
async function sync(folder: string | null) {
  const changed: string[] = []
  if (!folder) return changed
  const db = pluginDb(), unbuilt = await rebuildFromSource(folder)
  for (const file of fs.readdirSync(folder).filter(name => name.endsWith('.zip') && !unbuilt.has(name)).sort()) {
    let pluginId: string | null = null
    try {
      const bytes = fs.readFileSync(path.join(folder, file))
      const { manifest } = unpackPlugin(bytes)
      pluginId = manifest.id
      const row = db.prepare('SELECT digest, bundled FROM plugins WHERE id = ?').get(manifest.id) as { digest: string; bundled: number } | undefined
      if (!(row?.bundled && row.digest === createHash('sha256').update(bytes).digest('hex'))) {
        const result = await installPlugin(bytes, undefined, true)
        if (result.updated) updatedThisStart.add(manifest.id)
        changed.push(manifest.id)
      }
      failures.delete(file)
    } catch (error) {
      console.warn(`[plugins] bundled package ${file} was not installed:`, error)
      failures.set(file, { file, pluginId, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return changed
}
