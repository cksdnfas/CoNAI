import fs from 'fs'
import path from 'path'
import { runtimePaths } from '../../config/runtimePaths'
import { PluginError } from './pluginStore'

const dataRoot = () => path.join(path.resolve(runtimePaths.basePath), 'plugins', 'data')

/** The plugin's own folder (its server module's database and files): kept across updates, removed with the plugin. */
export function pluginDataDir(id: string) {
  let current = path.resolve(runtimePaths.basePath)
  for (const part of ['plugins', 'data', id]) {
    current = path.join(current, part)
    fs.mkdirSync(current, { recursive: true })
    if (fs.lstatSync(current).isSymbolicLink()) throw new PluginError('플러그인 데이터 경로에 링크가 있어.', 403)
  }
  return current
}

export function removePluginData(id: string) {
  const folder = path.join(dataRoot(), id)
  // Never delete through a link or junction an administrator put in the way.
  for (const part of [path.dirname(dataRoot()), dataRoot(), folder]) {
    let stat: fs.Stats
    try { stat = fs.lstatSync(part) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (stat.isSymbolicLink()) throw new PluginError('플러그인 데이터 경로에 링크가 있어.', 403)
  }
  fs.rmSync(folder, { recursive: true, force: true })
}
