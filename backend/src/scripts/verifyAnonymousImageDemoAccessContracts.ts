import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

const authMiddlewareSource = readSource('src/middleware/authMiddleware.ts');
const routeRegistrationSource = readSource('src/startup/registerAppRoutes.ts');
const permissionGroupSource = readSource('src/models/AuthPermissionGroup.ts');

assert.ok(
  authMiddlewareSource.includes('export const allowAnonymousAnyPermission'),
  'auth middleware must expose a helper that allows anonymous access when any configured permission matches',
);

for (const permissionKey of ['page.home.view', 'page.image-detail.view', 'page.wallpaper.runtime.view']) {
  assert.ok(
    permissionGroupSource.includes(`'${permissionKey}'`),
    `anonymous built-in access must allow configuring ${permissionKey}`,
  );
}

for (const blockedPermissionKey of ['page.upload.view', 'page.settings.view', 'wildcards.edit', 'wildcards.delete']) {
  assert.doesNotMatch(
    permissionGroupSource,
    new RegExp(`ANONYMOUS_EDITABLE_PERMISSION_KEYS[\\s\\S]*?'${blockedPermissionKey}'`),
    `anonymous built-in access must not expose ${blockedPermissionKey} through the demo read-only scope`,
  );
}

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
  /app\.use\('\/api\/runtime-media-settings'[\s\S]*?allowReadAccess\(HOME_IMAGE_READ_PERMISSION_KEYS\)/,
  'runtime media read settings must be available to anonymous home/detail access',
);

assert.match(
  routeRegistrationSource,
  /app\.use\('\/api\/nai'[\s\S]*?optionalAuth[\s\S]*?requirePermission\('page\.generation\.view'\)/,
  'generation actions must remain authenticated and permission-gated',
);

console.log('✅ Anonymous image demo access contracts verified');
