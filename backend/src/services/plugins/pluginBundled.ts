import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { installPlugin, unpackPlugin } from './pluginRegistry'
import { pluginDb } from './pluginStore'

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

/**
 * Brings the official packages that ship with this build in line with the install: a missing one is installed (off), a
 * different build of an installed one replaces it in place and keeps its on/off state and data. One broken package never
 * stops the others or startup.
 */
export async function syncBundledPlugins(folder = bundledFolder()) {
  if (!folder) return
  const db = pluginDb()
  for (const file of fs.readdirSync(folder).filter(name => name.endsWith('.zip')).sort()) {
    try {
      const bytes = fs.readFileSync(path.join(folder, file))
      const { manifest } = unpackPlugin(bytes)
      const row = db.prepare('SELECT digest, bundled FROM plugins WHERE id = ?').get(manifest.id) as { digest: string; bundled: number } | undefined
      if (row?.bundled && row.digest === createHash('sha256').update(bytes).digest('hex')) continue
      await installPlugin(bytes, undefined, true)
    } catch (error) { console.warn(`[plugins] bundled package ${file} was not installed:`, error) }
  }
}
