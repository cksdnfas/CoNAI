import { z } from 'zod'
import { requirePluginInstance, type PluginCaller } from './pluginHost'
import { pluginDb, pluginToken, PluginError } from './pluginStore'

const key = z.string().min(1).max(120)
type Row = { value: string; revision: string }
/** Small account-scoped settings for web plugins; no server module, filesystem paths or private chat access. */
export function pluginStorage(instanceId: string, caller: PluginCaller, operation: 'get' | 'set' | 'delete', input: unknown) {
  const args = z.object({ key, value: z.unknown().optional(), revision: z.string().regex(/^[a-f0-9]{48}$/).nullable().optional() }).strict().parse(input)
  const instance = requirePluginInstance(instanceId, caller), db = pluginDb()
  const scope = [instance.plugin.id, instance.owner, args.key]
  const current = () => db.prepare('SELECT value,revision FROM plugin_storage WHERE plugin_id=? AND owner_key=? AND key=?').get(...scope) as Row | undefined
  if (operation === 'get') { const row = current(); return { key: args.key, value: row ? JSON.parse(row.value) : null, revision: row?.revision ?? null } }
  return db.transaction(() => {
    const row = current()
    if ((args.revision ?? null) !== (row?.revision ?? null)) throw new PluginError('설정이 다른 곳에서 바뀌었어. 다시 읽고 저장해줘.', 409)
    if (operation === 'delete') { db.prepare('DELETE FROM plugin_storage WHERE plugin_id=? AND owner_key=? AND key=?').run(...scope); return { key: args.key, revision: null } }
    const value = JSON.stringify(args.value ?? null)
    if (Buffer.byteLength(value) > 64 * 1024) throw new PluginError('설정 항목은 64KB까지 저장할 수 있어.', 413)
    const total = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(length(CAST(value AS BLOB))),0) AS bytes FROM plugin_storage WHERE plugin_id=? AND owner_key=?').get(instance.plugin.id, instance.owner) as { n: number; bytes: number }
    if ((!row && total.n >= 256) || total.bytes - Buffer.byteLength(row?.value ?? '') + Buffer.byteLength(value) > 1024 * 1024) throw new PluginError('플러그인 설정 저장 한도를 넘었어. 불필요한 항목을 정리해줘.', 413)
    const revision = pluginToken()
    db.prepare('INSERT INTO plugin_storage(plugin_id,owner_key,key,value,revision) VALUES(?,?,?,?,?) ON CONFLICT(plugin_id,owner_key,key) DO UPDATE SET value=excluded.value,revision=excluded.revision').run(...scope, value, revision)
    return { key: args.key, value: JSON.parse(value), revision }
  }).immediate()
}
