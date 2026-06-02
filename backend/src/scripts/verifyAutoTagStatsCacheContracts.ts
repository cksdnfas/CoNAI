import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(__dirname, '../../..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

const imageStatsModel = readSource('backend/src/models/Image/ImageStatsModel.ts');
const mediaMetadataModel = readSource('backend/src/models/Image/MediaMetadataModel.ts');
const autoTagScheduler = readSource('backend/src/services/autoTagScheduler.ts');
const taggingMutationRoutes = readSource('backend/src/routes/images/tagging.mutation.routes.ts');
const initialMigration = readSource('backend/src/database/migrations/000_create_all_tables.ts');
const autoTagStatsIndexMigration = readSource('backend/src/database/migrations/025_add_auto_tag_stats_indexes.ts');

assert.match(
  imageStatsModel,
  /AUTO_TAG_STATS_CACHE_TTL_MS\s*=\s*30_000/,
  'auto-tag stats cache should use a short TTL so missed invalidations cannot stay stale for long',
);

assert.match(
  imageStatsModel,
  /autoTagStatsCache/,
  'auto-tag stats should keep an in-process cache for repeated stats requests',
);

assert.match(
  imageStatsModel,
  /cloneAutoTagStats/,
  'auto-tag stats cache should clone cached payloads before returning them',
);

assert.match(
  imageStatsModel,
  /invalidateAutoTagStatsCache\(\)/,
  'auto-tag stats model should expose explicit invalidation',
);

assert.match(
  imageStatsModel,
  /json_type\(auto_tags,\s*'\$\.rating'\)\s*=\s*'object'/,
  'auto-tag stats should prefilter root rating payloads before rating aggregation',
);

assert.match(
  imageStatsModel,
  /json_type\(auto_tags,\s*'\$\.character'\)\s*=\s*'object'/,
  'auto-tag stats should use a root character predicate that can use the stats index',
);

for (const source of [initialMigration, autoTagStatsIndexMigration]) {
  assert.match(
    source,
    /idx_auto_tag_stats_tagged/,
    'auto-tag stats tagged-image index must exist in current and incremental schemas',
  );
  assert.match(
    source,
    /idx_auto_tag_stats_root_rating/,
    'auto-tag stats root rating index must exist in current and incremental schemas',
  );
  assert.match(
    source,
    /idx_auto_tag_stats_root_character/,
    'auto-tag stats root character index must exist in current and incremental schemas',
  );
  assert.match(
    source,
    /idx_auto_tag_stats_root_model/,
    'auto-tag stats root model index must exist in current and incremental schemas',
  );
}

assert.match(
  mediaMetadataModel,
  /ImageStatsModel\.invalidateAutoTagStatsCache\(\)/,
  'media metadata create/update/delete paths should invalidate auto-tag stats',
);

assert.match(
  autoTagScheduler,
  /ImageStatsModel\.invalidateAutoTagStatsCache\(\)/,
  'auto-tag scheduler persistence should invalidate auto-tag stats',
);

assert.match(
  taggingMutationRoutes,
  /ImageStatsModel\.invalidateAutoTagStatsCache\(\)/,
  'reset-auto-tags route should invalidate auto-tag stats',
);

console.log('✅ Auto-tag stats cache contracts verified');
