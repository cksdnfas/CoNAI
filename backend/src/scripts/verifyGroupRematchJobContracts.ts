import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(__dirname, '../../..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

const groupRoutes = readSource('backend/src/routes/groups.mutation.routes.ts');
const autoFolderRoutes = readSource('backend/src/routes/autoFolderGroups.ts');
const jobService = readSource('backend/src/services/groupRematchJobService.ts');
const jobRunner = readSource('backend/src/scripts/runGroupRematchJob.ts');

assert.match(
  groupRoutes,
  /router\.get\('\/auto-collect-jobs\/:jobId'/,
  'group rematch jobs must expose a polling route',
);
assert.match(
  groupRoutes,
  /GroupRematchJobService\.startJobProcess\('group-auto-collect'/,
  'single-group rematch route must start a background job',
);
assert.match(
  groupRoutes,
  /GroupRematchJobService\.startJobProcess\('all-auto-collect'/,
  'all-group rematch route must start a background job',
);
assert.doesNotMatch(
  groupRoutes,
  /await AutoCollectionService\.runAutoCollectionForGroup/,
  'group rematch HTTP routes must not run synchronous DB rematch work inline',
);

assert.match(
  autoFolderRoutes,
  /GroupRematchJobService\.startJobProcess\('auto-folder-rebuild'/,
  'auto-folder rebuild route must start a background job',
);
assert.doesNotMatch(
  autoFolderRoutes,
  /await AutoFolderGroupService\.rebuildAllFolderGroups\(\)/,
  'auto-folder rebuild HTTP route must not run synchronous DB rebuild work inline',
);

assert.match(
  jobService,
  /runtimePaths\.tempDir/,
  'group rematch jobs must persist status in the runtime temp directory',
);
assert.match(
  jobService,
  /spawn\(/,
  'group rematch jobs must run in a separate Node process',
);
assert.match(
  jobService,
  /CONAI_RUNTIME_ROLE:\s*'group-rematch-job'/,
  'group rematch job child processes must use a distinct runtime role',
);

assert.match(
  jobRunner,
  /AutoCollectionService\.runAutoCollectionForGroup/,
  'group rematch runner must own auto-collection execution',
);
assert.match(
  jobRunner,
  /AutoFolderGroupService\.rebuildAllFolderGroups/,
  'group rematch runner must own auto-folder rebuild execution',
);
assert.match(
  jobRunner,
  /GroupRematchJobService\.markRunning/,
  'group rematch runner must publish progress',
);
assert.match(
  jobRunner,
  /GroupRematchJobService\.markCompleted/,
  'group rematch runner must publish completion',
);

console.log('✅ Group rematch job contracts verified');
