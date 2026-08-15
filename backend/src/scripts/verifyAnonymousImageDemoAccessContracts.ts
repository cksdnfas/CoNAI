import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

const authMiddlewareSource = readSource('src/middleware/authMiddleware.ts');
const routeRegistrationSource = readSource('src/startup/registerAppRoutes.ts');
const permissionGroupSource = readSource('src/models/AuthPermissionGroup.ts');
const securityTabDataSource = readSource('../frontend/src/features/settings/components/security-tab-data.ts');
const dockerfileSource = readSource('../Dockerfile');
const dockerBuildScriptSource = readSource('../scripts/build-docker.js');
const composeSource = readSource('../compose.yaml');
const gpuComposeSource = readSource('../compose.gpu.yaml');
const cpuPythonRequirementsSource = readSource('python/requirements.txt');
const gpuPythonRequirementsSource = readSource('python/requirements-gpu.txt');

assert.ok(
  authMiddlewareSource.includes('export const allowAnonymousAnyPermission'),
  'auth middleware must expose a helper that allows anonymous access when any configured permission matches',
);

for (const permissionKey of ['page.home.view', 'page.image-detail.view', 'page.wallpaper.runtime.view']) {
  assert.ok(
    permissionGroupSource.includes(`'${permissionKey}'`),
    `built-in access must allow configuring ${permissionKey}`,
  );
}

assert.doesNotMatch(
  permissionGroupSource,
  /ANONYMOUS_EDITABLE_PERMISSION_KEYS/,
  'anonymous access must not use a separate backend editable permission allow-list',
);

assert.doesNotMatch(
  securityTabDataSource,
  /ANONYMOUS_EDITABLE_PERMISSION_KEYS/,
  'anonymous access must not use a separate frontend editable permission filter',
);

assert.ok(
  securityTabDataSource.includes("permission.permissionKey.startsWith('page.')"),
  'custom permission groups should stay page-only while built-in groups use the full editable catalog',
);

assert.match(
  routeRegistrationSource,
  /app\.use\('\/api\/images'[\s\S]*?isImageReadRequest\(req\)[\s\S]*?allowAnonymousAnyPermission\(IMAGE_READ_PERMISSION_KEYS\)/,
  'image read/search routes must use anonymous page permissions instead of blanket optionalAuth',
);

for (const imageReadPath of [
  "'/batch'",
  "'/download/batch'",
  "'/search'",
  "'/search/ids'",
  "'/search-by-autotags'",
  "'/search/complex'",
  "'/search/complex/ids'",
]) {
  assert.ok(
    routeRegistrationSource.includes(imageReadPath),
    `image anonymous read predicate must include ${imageReadPath}`,
  );
}

assert.match(
  routeRegistrationSource,
  /WALLPAPER_IMAGE_READ_PERMISSION_KEYS[\s\S]*?'page\.home\.view'[\s\S]*?'page\.image-detail\.view'[\s\S]*?'page\.wallpaper\.runtime\.view'/,
  'thumbnail requests must be available to home/detail anonymous users as well as wallpaper runtime users',
);

assert.match(
  routeRegistrationSource,
  /app\.use\('\/api\/search-options'[\s\S]*?allowReadAccess\(HOME_IMAGE_READ_PERMISSION_KEYS\)/,
  'search option suggestions must be available to anonymous home/detail access',
);

assert.match(
  routeRegistrationSource,
  /RUNTIME_MEDIA_SETTINGS_READ_PERMISSION_KEYS\s*=\s*\[[\s\S]*?\.\.\.HOME_IMAGE_READ_PERMISSION_KEYS,[\s\S]*?'page\.generation\.view'/,
  'runtime media read settings must be available to home/detail and generation access',
);

assert.match(
  routeRegistrationSource,
  /const allowRuntimeMediaSettingsRead: RequestHandler = \(req, res, next\) => \{[\s\S]*?req\.session\?\.authenticated === true[\s\S]*?allowReadAccess\(RUNTIME_MEDIA_SETTINGS_READ_PERMISSION_KEYS\)/,
  'runtime media read settings must allow authenticated public-workflow users and preserve anonymous permission checks',
);

assert.match(
  routeRegistrationSource,
  /app\.use\('\/api\/runtime-media-settings'[\s\S]*?allowRuntimeMediaSettingsRead/,
  'runtime media read settings must use the public-workflow-compatible read guard',
);

assert.match(
  routeRegistrationSource,
  /app\.use\('\/api\/nai'[\s\S]*?optionalAuth[\s\S]*?requirePermission\('page\.generation\.view'\)/,
  'generation actions must remain authenticated and permission-gated',
);

// 공개 워크플로 표면(requireAuth 마운트)은 page.generation.view 없는 계정에게도 자기 히스토리
// 목록을 내려주므로, 소유권 검사(canAccessHistoryRecord)로 이미 보호되는 미디어 경로까지 페이지
// 권한으로 막으면 게스트 썸네일이 전부 403('표시 불가')이 된다.
assert.match(
  routeRegistrationSource,
  /function isOwnerScopedHistoryMediaRequest\(req: Request\): boolean \{[\s\S]*?\/\^\\\/\\d\+\\\/\(\?:file\|thumbnail\|image\)\$\/[\s\S]*?req\.method === 'POST' && req\.path === '\/download\/batch'/,
  'the owner-scoped history predicate must stay limited to per-record media paths plus batch download',
);

assert.match(
  routeRegistrationSource,
  /const allowScopedGenerationHistoryAccess: RequestHandler = \(req, res, next\) => \{[\s\S]*?req\.session\?\.authenticated === true && isOwnerScopedHistoryMediaRequest\(req\)[\s\S]*?requirePermission\('page\.generation\.view'\)\(req, res, next\)/,
  'generation-history media must allow authenticated owners while every other history route keeps the page permission',
);

assert.match(
  routeRegistrationSource,
  /app\.use\('\/api\/generation-history'[\s\S]*?allowScopedGenerationHistoryAccess/,
  'the generation-history mount must use the owner-scoped access guard',
);

assert.ok(
  dockerfileSource.includes('python3-pip'),
  'Coolify Docker runtime must include pip so WD Tagger and Kaloscope dependencies can be installed',
);

assert.ok(
  dockerfileSource.includes('-r /app/backend/python/requirements.txt'),
  'Coolify Docker runtime must install the bundled Python tagger requirements',
);

assert.ok(
  dockerfileSource.includes('https://download.pytorch.org/whl/cpu'),
  'Coolify Docker runtime should prefer CPU PyTorch wheels for the public demo host',
);

assert.match(
  dockerfileSource,
  /^FROM runtime-cpu AS runtime$/m,
  'an ordinary Docker build must finish on the CPU runtime target',
);

assert.match(
  dockerfileSource,
  /^FROM runtime-base AS runtime-gpu$/m,
  'Docker must expose an explicit opt-in GPU runtime target',
);

assert.ok(
  dockerfileSource.includes('https://download.pytorch.org/whl/cu121'),
  'the GPU target must install CUDA-enabled PyTorch wheels',
);

assert.match(cpuPythonRequirementsSource, /^onnxruntime>=/m);
assert.doesNotMatch(cpuPythonRequirementsSource, /^onnxruntime-gpu>=/m);
assert.match(gpuPythonRequirementsSource, /^onnxruntime-gpu>=/m);

assert.match(composeSource, /image: conai:cpu/);
assert.doesNotMatch(composeSource, /target: runtime-gpu/);
assert.match(gpuComposeSource, /image: conai:gpu/);
assert.match(gpuComposeSource, /target: runtime-gpu/);
assert.match(gpuComposeSource, /gpus: all/);

assert.ok(dockerBuildScriptSource.includes("'requirements-common.txt'"));
assert.ok(dockerBuildScriptSource.includes("'requirements-gpu.txt'"));
assert.doesNotMatch(dockerBuildScriptSource, /FROM nvidia\/cuda/);
assert.match(dockerBuildScriptSource, /--index-url https:\/\/download\.pytorch\.org\/whl\/cu121[\s\\]+torch torchvision/);

console.log('✅ Anonymous image demo access contracts verified');
