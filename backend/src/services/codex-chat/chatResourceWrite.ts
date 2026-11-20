import { getUserSettingsDb } from '../../database/userSettingsDb'
import { ChatProfileError, ChatRevisionConflict } from './chatProfileError'

/** Linked resources accept legacy patches, but a reviewed save compares and writes under the same lock. */
export function editChatResource<T extends { revision: number }>(
  id: number, revision: unknown, find: (id: number) => T | null, write: (current: T) => void,
) {
  if (revision !== undefined && (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0)) {
    throw new ChatProfileError('revision must be a positive integer')
  }
  return getUserSettingsDb().transaction(() => {
    const current = find(id)
    if (!current) return null
    if (revision !== undefined && revision !== current.revision) throw new ChatRevisionConflict(current)
    write(current)
    return find(id)
  }).immediate()
}

/** The file is the retry unit: a rejected item must not leave previously created resources behind. */
export function importChatResources<T, R>(items: T[], create: (item: T) => R): R[] {
  return getUserSettingsDb().transaction(() => items.map(item => create(item))).immediate()
}
