import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(__dirname, '../../..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

const backgroundProcessor = readSource('backend/src/services/backgroundProcessorService.ts');
const backgroundQueue = readSource('backend/src/services/backgroundQueue.ts');
const autoTagScheduler = readSource('backend/src/services/autoTagScheduler.ts');
const autoCollectionOrchestrator = readSource('backend/src/services/autoCollection/autoCollectionOrchestrator.ts');

assert.match(
  backgroundProcessor,
  /runAutoCollectionForNewImage\(\s*hashes\.compositeHash\s*\)/s,
  'hash generation path must run single-image auto collection, not wait for full rematch',
);

assert.match(
  backgroundQueue,
  /runAutoCollectionForNewImage\(\s*compositeHash\s*\)/s,
  'metadata extraction path must run single-image auto collection for prompt/model based groups',
);

assert.match(
  autoTagScheduler,
  /import \{ AutoCollectionService \} from '\.\/autoCollectionService';/,
  'auto-tag scheduler must own the auto-tag based single-image auto-collection hook',
);

assert.match(
  autoTagScheduler,
  /AutoTagIndexService\.syncForHash\(compositeHash,\s*autoTags\);[\s\S]*AutoCollectionService\.runAutoCollectionForNewImage\(compositeHash\)/,
  'auto-tag persistence must sync the tag index before assigning the one image to auto groups',
);

assert.doesNotMatch(
  autoTagScheduler,
  /runAutoCollectionForAllGroups/,
  'auto-tag persistence must not trigger full group rematch',
);

assert.doesNotMatch(
  backgroundQueue,
  /runAutoCollectionForAllGroups/,
  'metadata extraction must not trigger full group rematch',
);

assert.match(
  autoCollectionOrchestrator,
  /Whole-group rebuilds are reserved for explicit user rebuild actions\./,
  'new-image auto collection must document that full rebuilds are explicit/manual only',
);

console.log('✅ Single-image auto-collection contracts verified');
