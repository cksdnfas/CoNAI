import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const autoFolderService = readFileSync(resolve(process.cwd(), 'src/services/autoFolderGroupService.ts'), 'utf8');
const autoFolderModel = readFileSync(resolve(process.cwd(), 'src/models/AutoFolderGroup.ts'), 'utf8');
const autoCollection = readFileSync(resolve(process.cwd(), 'src/services/autoCollection/autoCollectionOrchestrator.ts'), 'utf8');
const groupModel = readFileSync(resolve(process.cwd(), 'src/models/Group.ts'), 'utf8');

assert.equal(
  autoFolderService.includes('await this.rebuildAllFolderGroups();'),
  false,
  'auto-folder read routes must not trigger rebuild writes',
);
assert.ok(
  autoFolderService.includes('Legacy folder group rows found; use explicit rebuild'),
  'legacy auto-folder rows should warn instead of rebuilding during reads',
);
assert.ok(
  autoFolderService.includes('const persistRebuild = db.transaction'),
  'auto-folder explicit rebuild must persist delete/insert work in one transaction',
);
assert.ok(
  autoFolderService.includes('imagesByFolderId'),
  'auto-folder rebuild must group active images by folder instead of repeatedly filtering all active images',
);
assert.ok(
  autoFolderModel.includes('INSERT OR IGNORE INTO auto_folder_group_images'),
  'auto-folder image assignment must avoid exception-driven duplicate handling',
);
assert.ok(
  groupModel.includes('replaceAutoCollectedImages'),
  'custom-group auto collection must use a bulk replacement helper',
);
assert.ok(
  groupModel.includes('const replace = db.transaction'),
  'custom-group auto collection diff replacement must run in one transaction',
);
assert.ok(
  groupModel.includes('INSERT OR IGNORE INTO image_groups'),
  'custom-group auto collection must avoid per-row duplicate checks',
);
assert.ok(
  groupModel.includes('temp_auto_collect_hashes'),
  'custom-group auto collection rematch must stage desired hashes for set-based diff writes',
);
assert.ok(
  groupModel.includes('composite_hash NOT IN (SELECT composite_hash FROM temp_auto_collect_hashes)'),
  'custom-group auto collection rematch must delete only stale auto memberships',
);
assert.ok(
  autoCollection.includes('ComplexFilterService.executeComplexSearchIds'),
  'complex-filter auto collection must fetch only composite hashes, not page-search image records',
);
assert.ok(
  autoCollection.includes('ImageGroupModel.replaceAutoCollectedImages'),
  'auto-collection orchestrator must route rebuild writes through the transaction helper',
);

console.log('✅ Group WAL hot-path contracts verified');
