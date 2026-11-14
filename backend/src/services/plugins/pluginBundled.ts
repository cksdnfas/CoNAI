import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
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

// What this process's syncs did, for plugin management: nothing here survives a restart, where the sync runs again.
const updatedThisStart = new Set<string>()
const failures = new Map<string, BundledPluginFailure>()
let running: Promise<void> | null = null

/** Official packages this app start replaced with a newer build. */
export const bundledUpdatedThisStart = (pluginId: string) => updatedThisStart.has(pluginId)
/** Official packages the last sync could not install or update, with the reason. */
export const bundledPluginFailures = () => [...failures.values()]

/**
 * Brings the official packages that ship with this build in line with the install: a missing one is installed (off), a
 * different build of an installed one replaces it in place and keeps its on/off state and data. One broken package never
 * stops the others or startup; it is kept as a failure that management shows and can retry. Concurrent calls share one run.
 */
export function syncBundledPlugins(folder = bundledFolder()) {
  running ??= sync(folder).finally(() => { running = null })
  return running
}
async function sync(folder: string | null) {
  if (!folder) return
  const db = pluginDb()
  for (const file of fs.readdirSync(folder).filter(name => name.endsWith('.zip')).sort()) {
    let pluginId: string | null = null
    try {
      const bytes = fs.readFileSync(path.join(folder, file))
      const { manifest } = unpackPlugin(bytes)
      pluginId = manifest.id
      const row = db.prepare('SELECT digest, bundled FROM plugins WHERE id = ?').get(manifest.id) as { digest: string; bundled: number } | undefined
      if (!(row?.bundled && row.digest === createHash('sha256').update(bytes).digest('hex'))) {
        const result = await installPlugin(bytes, undefined, true)
        if (result.updated) updatedThisStart.add(manifest.id)
      }
      failures.delete(file)
    } catch (error) {
      console.warn(`[plugins] bundled package ${file} was not installed:`, error)
      failures.set(file, { file, pluginId, error: error instanceof Error ? error.message : String(error) })
    }
  }
}
