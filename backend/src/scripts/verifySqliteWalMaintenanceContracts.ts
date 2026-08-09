import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import verifyHelpers from '../../../scripts/verify-helpers';

const { createSourceReader, reportVerificationSuccess } = verifyHelpers;
const readSource = createSourceReader(resolve(__dirname, '../../..'));

const walMaintenanceSource = readSource('backend/src/database/walMaintenance.ts');
const backgroundProcessorSource = readSource('backend/src/services/backgroundProcessorService.ts');
const savedMediaOrchestratorSource = readSource('backend/src/services/background-media/savedMediaOrchestrator.ts');
const autoCollectionSource = readSource('backend/src/services/autoCollection/autoCollectionOrchestrator.ts');
const autoFolderGroupSource = readSource('backend/src/services/autoFolderGroupService.ts');
const folderScanSource = readSource('backend/src/services/folderScan/index.ts');

assert.match(
  walMaintenanceSource,
  /DEFAULT_TRUNCATE_THRESHOLD_BYTES\s*=\s*32\s*\*\s*ONE_MIB/,
  'runtime WAL maintenance should default to a 32MiB threshold so TRUNCATE checkpoints stay short',
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
  savedMediaOrchestratorSource,
  /maybeTruncateImagesWal\('background-image-processed'\)/,
  'immediate saved-media processing should preserve its gated image WAL check',
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
assert.match(
  folderScanSource,
  /if \(!options\.candidateFiles\) \{\s*maybeTruncateImagesWal\('folder-scan'\)/,
  'whole-folder scans should check WAL after bulk file reconciliation writes',
);

reportVerificationSuccess('✅ SQLite WAL maintenance contracts verified');
