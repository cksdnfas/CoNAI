import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import verifyHelpers from '../../../scripts/verify-helpers';

const { createSourceReader, reportVerificationSuccess } = verifyHelpers;
const source = createSourceReader(resolve(__dirname, '../../..'));
const folderScanSource = source('backend/src/services/folderScan/index.ts');
const fileDiscoverySource = source('backend/src/services/folderScan/fileDiscoveryService.ts');
const fileWatcherSource = source('backend/src/services/fileWatcherService.ts');

assert.match(
  folderScanSource,
  /candidateFiles\?: string\[\]/,
  'folder scans must support an explicit watcher candidate batch',
);
assert.match(
  folderScanSource,
  /options\.candidateFiles[\s\S]*?Array\.from\(new Set\(options\.candidateFiles\)\)[\s\S]*?: await FileDiscoveryService\.collectFiles/,
  'watcher candidate batches must bypass whole-folder discovery',
);
assert.match(
  folderScanSource,
  /if \(!options\.quietIfNoChanges \|\| hasMeaningfulChanges\) \{\s*this\.saveScanLog/,
  'quiet watcher scans must not persist no-change scan logs',
);
assert.match(
  folderScanSource,
  /options\.candidateFiles \? undefined : result\.newImages \+ result\.existingImages/,
  'targeted watcher batches must preserve the last whole-folder file count',
);
assert.match(
  fileWatcherSource,
  /candidateFiles: pendingFiles/,
  'file watcher batches must scan only queued file paths',
);
assert.doesNotMatch(
  fileWatcherSource,
  /scanFolder\(folderId, true\)/,
  'one file change must not mark and rescan the entire watched folder',
);
assert.match(
  fileWatcherSource,
  /scanState\.pendingFiles\.delete\(folderId\);\s*scanState\.processingFolders\.add\(folderId\)/,
  'a running watcher scan must snapshot its batch before accepting later events',
);
assert.match(
  fileWatcherSource,
  /pendingCount > 0 && shouldSchedule\(folderId\)[\s\S]*?resolveWatcherBatchRetryDelayMs[\s\S]*?scheduleFolderBatchScan/,
  'successful follow-up batches and failed retry batches must both be rescheduled',
);
assert.match(
  fileWatcherSource,
  /folderScanRetryAttempts\.set\([\s\S]*?\+ 1[\s\S]*?resolveWatcherBatchRetryDelayMs/,
  'failed watcher batches must advance a folder-scoped exponential retry counter',
);
assert.match(
  fileWatcherSource,
  /else if \(!shouldSchedule\(folderId\)\) \{\s*cleanupFolderScanState/,
  'a watcher stopped during a failed batch must clear requeued files and retry timers',
);
assert.match(
  fileDiscoverySource,
  /suppressErrors: false/,
  'full discovery must not turn permission or traversal failures into a partial successful result',
);
assert.match(
  fileDiscoverySource,
  /catch \(error\)[\s\S]*?throw new Error/,
  'file discovery errors must propagate to the scan coordinator',
);

const registrationIndex = folderScanSource.indexOf('await FastRegistrationService.processFastRegistration');
const reconcileIndex = folderScanSource.indexOf('await this.reconcileMissingFiles');
assert.ok(
  registrationIndex >= 0 && reconcileIndex > registrationIndex,
  'missing rows must be reconciled only after the discovered files finish registration',
);
assert.match(
  folderScanSource,
  /if \(fullRescan && !options\.candidateFiles && result\.errors\.length === 0\) \{[\s\S]*?reconcileMissingFiles/,
  'a partial per-file registration must not mark existing rows missing',
);

reportVerificationSuccess('✅ Watched-folder scan efficiency contracts verified');
