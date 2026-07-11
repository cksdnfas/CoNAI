import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(__dirname, '../../..');
const folderScanSource = fs.readFileSync(
  path.join(projectRoot, 'backend/src/services/folderScan/index.ts'),
  'utf8',
);
const fileWatcherSource = fs.readFileSync(
  path.join(projectRoot, 'backend/src/services/fileWatcherService.ts'),
  'utf8',
);

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
  /completed && \(scanState\.pendingFiles\.get\(folderId\)\?\.size \?\? 0\) > 0[\s\S]*?scheduleFolderBatchScan/,
  'events arriving during a scan must schedule a follow-up batch',
);

console.log('✅ Watched-folder scan efficiency contracts verified');
