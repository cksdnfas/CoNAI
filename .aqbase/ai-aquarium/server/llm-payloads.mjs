import { createHash } from 'node:crypto'
import { deflateSync, inflateSync } from 'node:zlib'
import { PAYLOAD_LOST } from './llm-errors.mjs'

export const snapshotData = value => value?.snapshotData ? value.snapshotData() : value
const snapshotKey = key => ['_decision', '_catalog', 'request'].includes(key)
/** Immutable snapshots are lazy on read. JSON serialization of an untouched
 * reference never inflates, clones or hashes its contents. Replace a snapshot
 * (or assign one of its top-level fields) when changing request inputs. */
export function payloadStore(db, scope) {
  db.exec('CREATE TABLE IF NOT EXISTS llm_payloads(owner TEXT NOT NULL,scope TEXT NOT NULL,id TEXT NOT NULL,data BLOB NOT NULL,PRIMARY KEY(owner,scope,id))')
  const cached = new WeakMap(), decoded = new Map(), warned = new Set(), references = new WeakMap()
  const put = db.prepare('INSERT OR IGNORE INTO llm_payloads(owner,scope,id,data) VALUES(?,?,?,?)')
  const get = db.prepare('SELECT data FROM llm_payloads WHERE owner=? AND scope=? AND id=?')
  const exists = db.prepare('SELECT 1 FROM llm_payloads WHERE owner=? AND scope=? AND id=?')
  const rows = db.prepare('SELECT id FROM llm_payloads WHERE owner=? AND scope=?')
  const remove = db.prepare('DELETE FROM llm_payloads WHERE owner=? AND scope=? AND id=?')
  const signature = value => [value.purpose, value.recent, value.personal, value.world, value.delivery, value.diagnostics, JSON.stringify(value.retry), value.answerRoom]
  function encode(owner, state) {
    const used = new Set()
    const raw = JSON.stringify(state, function (key, value) {
      if (key === 'history' && this?._budget) return undefined
      if ((key !== '_budget' && !snapshotKey(key)) || !value) return value
      if (key === 'request' && !value.payloadRef && !(value.input && Array.isArray(value.options))) return value
      if (value.payloadRef) { used.add(value.payloadRef); return value }
      if (value.payloadLost) return { payloadLost: true }
      const sig = snapshotKey(key) ? [] : signature(value)
      let entry = cached.get(value)
      if (!entry || entry.owner !== owner || !sig.every((v, i) => v === entry.signature[i])) {
        const json = JSON.stringify(value), id = createHash('sha256').update(json).digest('hex')
        entry = { owner, signature: sig, id }
        put.run(owner, scope, id, deflateSync(json)); cached.set(value, entry)
      } else if (!exists.get(owner, scope, entry.id)) put.run(owner, scope, entry.id, deflateSync(JSON.stringify(value)))
      used.add(entry.id)
      const reference = references.get(value)
      if (reference) { reference.id = entry.id; reference.dirty = false }
      return { payloadRef: entry.id }
    })
    for (const { id } of rows.all(owner, scope)) if (!used.has(id)) remove.run(owner, scope, id)
    for (const [key, entry] of decoded) if (entry.owner === owner && !used.has(entry.id)) decoded.delete(key)
    return raw
  }
  function load(owner, id) {
    const key = JSON.stringify([owner, id])
    try {
      let entry = decoded.get(key)
      if (!entry) {
        const row = get.get(owner, scope, id)
        if (!row) throw new Error('missing')
        const json = inflateSync(row.data).toString()
        if (createHash('sha256').update(json).digest('hex') !== id) throw new Error('checksum')
        const data = JSON.parse(json)
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('shape')
        entry = { owner, id, data }; decoded.set(key, entry)
      }
      return structuredClone(entry.data)
    } catch {
      if (!warned.has(key)) { warned.add(key); console.warn(`${PAYLOAD_LOST} (${scope}, ${owner})`) }
      return { payloadLost: true }
    }
  }
  function lazy(owner, id) {
    const ref = { id, dirty: false }, object = {}
    let data
    const materialize = () => {
      if (!data) { data = load(owner, ref.id); references.set(data, ref); cached.set(data, { owner, id: ref.id, signature: [] }) }
      return data
    }
    Object.defineProperties(object, {
      payloadRef: { enumerable: true, get: () => ref.id },
      toJSON: { value: () => ref.dirty ? materialize() : { payloadRef: ref.id } },
      snapshotData: { value: materialize },
    })
    for (const key of ['payloadLost', 'input', 'state', 'options', 'details', 'instructions', 'profileId', 'decider']) {
      Object.defineProperty(object, key, { get: () => materialize()[key], set: value => {
        const source = materialize(); source[key] = value; ref.dirty = true; cached.delete(source)
      } })
    }
    return object
  }
  function decode(owner, raw) {
    let lost = false
    const state = JSON.parse(raw, (key, value) => {
      if (key !== '_budget' && !snapshotKey(key)) return value
      if (value?.payloadLost) { lost = true; return { payloadLost: true } }
      if (!value?.payloadRef) return value
      if (snapshotKey(key)) return lazy(owner, value.payloadRef)
      const data = load(owner, value.payloadRef)
      if (data.payloadLost) lost = true
      else cached.set(data, { owner, id: value.payloadRef, signature: signature(data) })
      return data
    })
    if (lost && state && typeof state === 'object' && !state.error?.includes(PAYLOAD_LOST)) state.error = [state.error, PAYLOAD_LOST].filter(Boolean).join(' · ')
    return state
  }
  return { encode, decode }
}
