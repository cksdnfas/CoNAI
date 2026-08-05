import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(__dirname, '../../..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

const initialMigration = readSource('backend/src/database/migrations/000_create_all_tables.ts');
const autoTagIndexMigration = readSource('backend/src/database/migrations/022_add_media_auto_tag_index.ts');
const autoTagIndexPruneMigration = readSource('backend/src/database/migrations/023_prune_media_auto_tag_index_variants.ts');
const autoTagStateMigration = readSource('backend/src/database/migrations/028_add_media_auto_tag_state.ts');
const autoTagStateService = readSource('backend/src/services/autoTagStateService.ts');
const backgroundProcessorService = readSource('backend/src/services/backgroundProcessorService.ts');
const redundantIndexPruneMigration = readSource('backend/src/database/migrations/026_prune_redundant_indexes.ts');
const autoTagSearchTerms = readSource('backend/src/services/autoTagSearch/autoTagSearchTerms.ts');
const autoTagIndexService = readSource('backend/src/services/autoTagIndexService.ts');
const autoTagSql = readSource('backend/src/services/complexFilter/complexFilterAutoTagSql.ts');
const autoTagSearchService = readSource('backend/src/services/autoTagSearchService.ts');
const imageSearchModel = readSource('backend/src/models/Image/ImageSearchModel.ts');
const mediaMetadataModel = readSource('backend/src/models/Image/MediaMetadataModel.ts');
const autoTagScheduler = readSource('backend/src/services/autoTagScheduler.ts');
const taggingRoutes = readSource('backend/src/routes/images/tagging.mutation.routes.ts');
const dataRematchService = readSource('backend/src/services/dataRematchService.ts');

for (const source of [initialMigration, autoTagIndexMigration]) {
  assert.match(
    source,
    /CREATE TABLE IF NOT EXISTS media_auto_tag_index/,
    'auto-tag index table must exist in both initial schema and incremental migration',
  );
  assert.match(
    source,
    /idx_media_auto_tag_lookup/,
    'auto-tag index lookup index must exist in both initial schema and incremental migration',
  );
  assert.match(
    source,
    /tag_type,\s*search_key,\s*score,\s*composite_hash/s,
    'auto-tag lookup index must lead with tag type and normalized search key',
  );
}

for (const source of [initialMigration, autoTagIndexMigration]) {
  assert.doesNotMatch(
    source,
    /CREATE INDEX IF NOT EXISTS idx_media_auto_tag_hash_type/,
    'new databases must not create an index already covered by the auto-tag primary key prefix',
  );
}
assert.match(
  redundantIndexPruneMigration,
  /idx_media_auto_tag_hash_type/,
  'existing databases must drop the redundant auto-tag hash/type index',
);
assert.match(
  redundantIndexPruneMigration,
  /ON media_auto_tag_index\(composite_hash, tag_type\)/,
  'the storage migration rollback must be able to restore the old index',
);

assert.match(
  autoTagIndexMigration,
  /SELECT composite_hash,\s*auto_tags\s*FROM media_metadata/s,
  'auto-tag index migration must backfill existing media metadata',
);
assert.match(
  autoTagIndexMigration,
  /INSERT OR IGNORE INTO media_auto_tag_index/,
  'auto-tag index migration must populate normalized tag rows',
);

assert.match(
  autoTagIndexService,
  /AUTO_TAG_GENERAL_JSON_PATHS/,
  'auto-tag index sync must read the shared general tag paths',
);
assert.match(
  autoTagIndexService,
  /AUTO_TAG_CHARACTER_JSON_PATHS/,
  'auto-tag index sync must read the shared character tag paths',
);
assert.match(
  autoTagIndexService,
  /AUTO_TAG_MODEL_JSON_PATHS/,
  'auto-tag index sync must read the shared model tag paths',
);
assert.match(
  autoTagIndexService,
  /normalizeAutoTagIndexSearchKeys\(tagKey\)/,
  'auto-tag index sync must store compact indexed search keys',
);
assert.match(
  autoTagSearchTerms,
  /compactAutoTagSearchKey/,
  'auto-tag search terms must expose compact separator-free index keys',
);
assert.match(
  autoTagSearchTerms,
  /normalizeAutoTagIndexSearchKeys/,
  'auto-tag search terms must expose the compact key set used by the index',
);
assert.match(
  autoTagIndexService,
  /DELETE FROM media_auto_tag_index WHERE composite_hash = \?/,
  'auto-tag index sync must replace rows for one hash before inserting fresh rows',
);

assert.match(
  autoTagSql,
  /AutoTagIndexService\.hasIndexTable\(\)/,
  'complex auto-tag filters must detect the indexed table',
);
assert.match(
  autoTagSql,
  /FROM media_auto_tag_index/,
  'complex auto-tag filters must query the normalized index table',
);
assert.match(
  autoTagSql,
  /search_key IN/,
  'complex auto-tag filters must use equality lookup on normalized search keys',
);
assert.match(
  autoTagSql,
  /normalizeAutoTagIndexSearchKeys/,
  'complex auto-tag index filters must query the same compact key set stored by sync',
);
assert.match(
  autoTagSql,
  /buildComplexFilterTagExistsCondition/,
  'complex auto-tag filters must keep the JSON fallback for unmigrated test DBs',
);
assert.match(
  autoTagSearchService,
  /AutoTagIndexService\.hasIndexTable\(\)/,
  'simple auto-tag search must detect the indexed table',
);
assert.match(
  autoTagSearchService,
  /FROM media_auto_tag_index/,
  'simple auto-tag search must query the normalized index table',
);
assert.match(
  autoTagSearchService,
  /search_key IN/,
  'simple auto-tag search must use equality lookup on normalized search keys',
);
assert.match(
  autoTagSearchService,
  /rewriteIndexedConditionForOrderedScan/,
  'simple auto-tag search must expose ordered-scan conditions for paged lookups',
);
assert.match(
  autoTagSearchService,
  /WHERE ati\.composite_hash = i\.composite_hash/,
  'simple auto-tag ordered scans must probe the index by the ordered media row hash',
);
assert.match(
  autoTagSearchService,
  /normalizeAutoTagIndexSearchKeys/,
  'simple auto-tag search must query the same compact key set stored by sync',
);
assert.match(
  autoTagSearchService,
  /buildGeneralTagConditions/,
  'simple auto-tag search must keep the JSON fallback for unmigrated test DBs',
);
// The auto-tag-specific total cache was generalised into `resolveSearchTotal` so
// `advancedSearch` could share it (HEAVY-1). The guarantees are unchanged: a short
// TTL, a key derived from the count conditions and parameters, and a cache read
// before the count query runs.
assert.match(
  imageSearchModel,
  /SEARCH_TOTAL_CACHE_TTL_MS\s*=\s*30_000/,
  'search total count cache must use a short TTL',
);
assert.match(
  imageSearchModel,
  /function getSearchTotalCacheKey\(scope: string, conditions: string\[\], params: unknown\[\]\)/,
  'search total cache must key by scope, count conditions and parameters',
);
assert.match(
  imageSearchModel,
  /function resolveSearchTotal\([\s\S]{0,400}?getCachedSearchTotal\(cacheKey\)[\s\S]{0,200}?setCachedSearchTotal\(cacheKey, total\)/,
  'search totals must be read from cache before the count query and written back after a miss',
);
assert.match(
  imageSearchModel,
  /resolveSearchTotal\('searchByAutoTags', safeConditions, queryBuilder\.params/,
  'simple auto-tag search must resolve its total through the shared cache',
);
assert.match(
  autoTagIndexPruneMigration,
  /DELETE FROM media_auto_tag_index/,
  'auto-tag prune migration must remove old expanded variant rows',
);
assert.match(
  autoTagIndexPruneMigration,
  /search_key != normalized_tag_key/,
  'auto-tag prune migration must retain exact keys',
);
assert.match(
  autoTagIndexPruneMigration,
  /replace\(replace\(replace\(normalized_tag_key/,
  'auto-tag prune migration must retain compact separator-free keys',
);

assert.match(
  mediaMetadataModel,
  /AutoTagIndexService\.syncForHash\(data\.composite_hash,\s*data\.auto_tags\)/,
  'media metadata create must sync auto-tag index rows',
);
assert.match(
  mediaMetadataModel,
  /AutoTagIndexService\.syncForHash\(compositeHash,\s*filteredUpdates\.auto_tags/,
  'media metadata auto_tags updates must sync auto-tag index rows',
);
assert.match(
  autoTagScheduler,
  /AutoTagIndexService\.syncForHash\(compositeHash,\s*autoTags\)/,
  'auto-tag extraction persistence must sync auto-tag index rows',
);
assert.match(
  taggingRoutes,
  /AutoTagIndexService\.clearAll\(\)/,
  'reset-auto-tags route must clear the auto-tag index rows',
);
assert.match(
  dataRematchService,
  /'media_auto_tag_index'/,
  'hash regeneration must remap auto-tag index rows',
);
assert.match(
  dataRematchService,
  /this\.remapHashRefTableRows\('media_auto_tag_index', oldHash, newHash\)/,
  'hash regeneration must preserve auto-tag index rows when hashes change',
);

// --- Auto-tag pending state (migration 028 / ATAG-1..3) ---------------------------
// The scheduler must find work through the partial index instead of the json_extract
// full scan, and the state must stay a superset of the original condition.

assert.match(
  autoTagStateMigration,
  /ADD COLUMN auto_tag_state TEXT DEFAULT NULL/,
  'migration 028 must add the auto_tag_state column without rewriting existing wide rows',
);
assert.match(
  autoTagStateMigration,
  /CREATE INDEX IF NOT EXISTS idx_media_metadata_auto_tag_pending\s*\n\s*ON media_metadata\(auto_tag_state, composite_hash\)\s*\n\s*WHERE auto_tag_state = 'pending'/,
  'migration 028 must create the partial pending index keyed by auto_tag_state',
);
assert.match(
  autoTagStateMigration,
  /CREATE TABLE IF NOT EXISTS auto_tag_state_meta/,
  'migration 028 must record which taggers the stored state was computed for',
);
assert.match(
  autoTagStateMigration,
  /UPDATE media_metadata\s*\n\s*SET auto_tag_state = 'pending'\s*\n\s*WHERE auto_tag_state IS NOT 'pending'/,
  'migration 028 must backfill pending rows with a single UPDATE (no per-row loop)',
);
for (const triggerName of [
  'trg_media_metadata_auto_tag_state_insert',
  'trg_media_metadata_auto_tag_state_promote',
  'trg_media_metadata_auto_tag_state_settle',
  'trg_image_files_auto_tag_state_insert',
  'trg_image_files_auto_tag_state_link',
]) {
  assert.match(
    autoTagStateMigration,
    new RegExp(`CREATE TRIGGER ${triggerName}`),
    `migration 028 must keep auto_tag_state accurate for every writer via ${triggerName}`,
  );
}

// Migration 028 cannot import project modules (portable builds ship the compiled
// migrations directory standalone), so the runtime copy must not drift.
for (const source of [autoTagStateMigration, autoTagStateService]) {
  assert.match(
    source,
    /COALESCE\(\(SELECT tagger_enabled FROM auto_tag_state_meta WHERE id = 1\), 1\) = 1/,
    'auto-tag state expressions must read the recorded tagger capability',
  );
  assert.match(
    source,
    /COALESCE\(\(SELECT kaloscope_enabled FROM auto_tag_state_meta WHERE id = 1\), 1\) = 1/,
    'auto-tag state expressions must read the recorded kaloscope capability',
  );
  assert.match(
    source,
    /json_extract\(\$\{autoTagsExpr\}, '\$\.tagger'\) IS NULL/,
    'auto-tag state expressions must keep the tagger term of the original pending condition',
  );
  assert.match(
    source,
    /json_extract\(\$\{autoTagsExpr\}, '\$\.kaloscope'\) IS NULL/,
    'auto-tag state expressions must keep the kaloscope term of the original pending condition',
  );
  assert.match(
    source,
    /f\.original_file_path IS NOT NULL\s*\n\s*AND f\.file_status = 'active'/,
    'auto-tag state expressions must keep the original active-file eligibility filter',
  );
}

assert.match(
  autoTagStateService,
  /buildPendingStatePrefix\(alias: string\): string/,
  'auto-tag state service must expose the pending-state SQL prefix for the scheduler',
);
assert.match(
  autoTagStateService,
  /syncCapabilityState\(capabilities: AutoTagStateCapabilities\): void/,
  'auto-tag state service must recompute stored state when the enabled tagger set changes',
);

assert.match(
  autoTagScheduler,
  /WHERE \$\{AutoTagStateService\.buildPendingStatePrefix\('mm'\)\}\(/,
  'pending media lookup must be narrowed by the indexed auto_tag_state before the json filter',
);
assert.match(
  autoTagScheduler,
  /mm\.auto_tags IS NULL\s*\n\s*OR \(\? = 1 AND json_extract\(mm\.auto_tags, '\$\.tagger'\) IS NULL\)\s*\n\s*OR \(\? = 1 AND json_extract\(mm\.auto_tags, '\$\.kaloscope'\) IS NULL\)/,
  'pending media lookup must keep the dual tagger condition as the residual filter',
);

// The partial index only pays off while `media_metadata` is the driving table. Expressed
// as `LEFT JOIN image_files ... WHERE if_.file_status = 'active'` it is an inner join in
// disguise, so SQLite may reorder the tables — and on a real library (200k active files,
// the migration-000 partial index idx_files_status, no sqlite_stat1) it drives from
// image_files and probes the pending index once per file: an 18ms idle poll. A correlated
// EXISTS cannot be reordered, so the plan no longer depends on ANALYZE statistics.
assert.doesNotMatch(
  autoTagScheduler,
  /LEFT JOIN image_files/,
  'pending scans must not reach image_files through a reorderable join',
);
assert.match(
  autoTagScheduler,
  /FROM media_metadata mm\s*\n\s*WHERE \$\{AutoTagStateService\.buildPendingStatePrefix\('mm'\)\}\(/,
  'pending scans must select from media_metadata alone so the partial index always drives',
);
assert.match(
  autoTagScheduler,
  /const TAGGABLE_FILE_EXISTS = `EXISTS \(\s*\n\s*SELECT 1 FROM image_files taggable\s*\n\s*WHERE \$\{TAGGABLE_FILE_MATCH\}/,
  'the active-file requirement must be a correlated EXISTS over image_files',
);
assert.match(
  autoTagScheduler,
  /\)\s*\n\s*AND \$\{TAGGABLE_FILE_EXISTS\}\s*\n\s*LIMIT \?/,
  'the batch pending lookup must apply the EXISTS guard after the state/json filter',
);
assert.match(
  autoTagScheduler,
  /\)\s*\n\s*AND \$\{TAGGABLE_FILE_EXISTS\}\s*\n\s*`\)\.get\(capabilities\.taggerAutoEnabled/,
  'the pending count must apply the same EXISTS guard instead of counting joined file rows',
);
// Same eligibility terms migration 028 / AutoTagStateService use for auto_tag_state, so
// the state stays a superset of what the scheduler selects.
assert.match(
  autoTagScheduler,
  /taggable\.original_file_path IS NOT NULL\s*\n\s*AND taggable\.file_status = 'active'/,
  'the scheduler eligibility filter must match the migration 028 active-file condition',
);
// The single-hash lookup keeps a join on that same predicate: composite_hash is bound to a
// constant on both sides there, so every join order SQLite can pick is an index seek.
assert.match(
  autoTagScheduler,
  /JOIN image_files taggable ON \$\{TAGGABLE_FILE_MATCH\}\s*\n\s*WHERE mm\.composite_hash = \?/,
  'the saved-media lookup must join on the shared taggable predicate pinned by composite_hash',
);
assert.match(
  autoTagScheduler,
  /AutoTagStateService\.syncCapabilityState\(capabilities\)/,
  'pending lookups must sync the recorded capabilities before reading the indexed state',
);
assert.match(
  autoTagScheduler,
  /AutoTagStateService\.refreshForHash\(compositeHash\)/,
  'auto-tag persistence must settle the pending state after tagging finishes',
);
assert.match(
  autoTagScheduler,
  /AutoTagStateService\.pruneIneligiblePending\(\)/,
  'idle polls must park pending rows whose media file disappeared',
);
assert.match(
  autoTagScheduler,
  /async triggerManualProcessing\(compositeHash\?: string\): Promise<void>/,
  'manual auto-tag triggers must accept the composite hash that was just saved',
);
assert.match(
  autoTagScheduler,
  /findPendingMediaByHash\(compositeHash: string, capabilities: AutoTagCapabilities\)/,
  'saved-media tagging must look up one row instead of re-scanning for pending work',
);
assert.match(
  backgroundProcessorService,
  /autoTagScheduler\.triggerManualProcessing\(compositeHash\)/,
  'background processing must hand the saved composite hash to the auto-tag scheduler',
);

console.log('✅ Auto-tag index contracts verified');
