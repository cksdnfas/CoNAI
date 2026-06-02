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
