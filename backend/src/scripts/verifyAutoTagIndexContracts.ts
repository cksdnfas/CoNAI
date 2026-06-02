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
const autoTagSearchTerms = readSource('backend/src/services/autoTagSearch/autoTagSearchTerms.ts');
const autoTagIndexService = readSource('backend/src/services/autoTagIndexService.ts');
const autoTagSql = readSource('backend/src/services/complexFilter/complexFilterAutoTagSql.ts');
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

console.log('✅ Auto-tag index contracts verified');
