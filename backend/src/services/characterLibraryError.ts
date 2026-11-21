/**
 * A refused character library or art style request: `status` for the HTTP answer, `revision` / `code` on a 409. Kept in
 * its own module so services that extend it (artStyles.ts) can load inside characterLibrary.ts's own import graph.
 */
export class CharacterLibraryError extends Error {
  constructor(message: string, readonly status = 400, readonly revision?: number, readonly code?: 'revision_conflict' | 'name_conflict') { super(message) }
}
