import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(__dirname, '../../..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

const walMaintenanceSource = readSource('backend/src/database/walMaintenance.ts');
const backgroundProcessorSource = readSource('backend/src/services/backgroundProcessorService.ts');
const autoCollectionSource = readSource('backend/src/services/autoCollection/autoCollectionOrchestrator.ts');
const autoFolderGroupSource = readSource('backend/src/services/autoFolderGroupService.ts');

assert.match(
  walMaintenanceSource,
  /DEFAULT_TRUNCATE_THRESHOLD_BYTES\s*=\s*256\s*\*\s*ONE_MIB/,
  'runtime WAL maintenance should default to a bounded 256MiB threshold',
);
assert.match(
  walMaintenanceSource,
  /DEFAULT_MIN_INTERVAL_MS\s*=\s*30_000/,
  'runtime WAL maintenance should throttle checkpoint attempts',
);
assert.match(
  walMaintenanceSource,
  /wal_checkpoint\(TRUNCATE\)/,
  'runtime WAL maintenance should reclaim disk with TRUNCATE checkpoints',
);
assert.match(
  walMaintenanceSource,
  /SQLITE_WAL_TRUNCATE_THRESHOLD_MB/,
  'runtime WAL maintenance threshold should be environment-configurable',
);

assert.match(
  backgroundProcessorSource,
  /maybeTruncateImagesWal\('background-image-processed'\)/,
  'image background processing should check WAL after write-heavy processing',
);
assert.match(
  backgroundProcessorSource,
  /maybeTruncateImagesWal\('background-video-processed'\)/,
  'video background processing should check WAL after write-heavy processing',
);
assert.match(
  autoCollectionSource,
  /maybeTruncateImagesWal\('auto-collection-group-(legacy|complex)'\)/,
  'explicit auto-collection rebuilds should check WAL after bulk group writes',
);
assert.match(
  autoFolderGroupSource,
  /maybeTruncateImagesWal\('auto-folder-group-rebuild'\)/,
  'explicit auto-folder rebuild should check WAL after bulk folder-group writes',
);

console.log('✅ SQLite WAL maintenance contracts verified');
