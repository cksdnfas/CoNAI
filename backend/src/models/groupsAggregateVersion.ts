import { db } from '../database/init';
import { AggregateCache } from '../services/aggregateCache';

/**
 * The 'groups' aggregate scope reads its version from the row that group membership / tree writes bump through
 * triggers (migration 043), wherever they come from. Imported for this side effect by every model that caches a
 * group-dependent value, so the source is registered whichever of them loads first.
 */
let groupsVersionStatement: { get(): unknown } | null = null;
AggregateCache.setVersionSource('groups', () => {
  try {
    groupsVersionStatement ??= db.prepare("SELECT version FROM aggregate_versions WHERE scope = 'groups'");
    const row = groupsVersionStatement.get() as { version: number } | undefined;
    return row ? row.version : null;
  } catch {
    return null;
  }
});
