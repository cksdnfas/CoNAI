import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Request } from 'express';
import {
  hasValidRemoteSetupToken,
  isDirectLoopbackRequest,
} from '../utils/bootstrapAccess';
import { resolveAllowedCorsOrigins } from '../startup/configureAppMiddleware';

function mockRequest(remoteAddress: string, headers: Record<string, string> = {}): Request {
  return { headers, socket: { remoteAddress } } as unknown as Request;
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

assert.equal(isDirectLoopbackRequest(mockRequest('127.0.0.1')), true);
assert.equal(isDirectLoopbackRequest(mockRequest('::1')), true);
assert.equal(isDirectLoopbackRequest(mockRequest('203.0.113.8')), false);
assert.equal(
  isDirectLoopbackRequest(mockRequest('127.0.0.1', { 'x-forwarded-for': '203.0.113.8' })),
  false,
  'forwarded setup requests must not inherit trust from a loopback proxy socket',
);

const setupTokenRequest = mockRequest('203.0.113.8', { 'x-conai-setup-token': 'correct-token' });
assert.equal(hasValidRemoteSetupToken(setupTokenRequest, { CONAI_SETUP_TOKEN: 'correct-token' }), true);
assert.equal(hasValidRemoteSetupToken(setupTokenRequest, { CONAI_SETUP_TOKEN: 'wrong-token' }), false);
assert.equal(hasValidRemoteSetupToken(setupTokenRequest, {}), false);

assert.deepEqual(
  [...resolveAllowedCorsOrigins({
    CORS_ORIGIN: 'https://app.example.com, https://admin.example.com/path/',
    FRONTEND_URL: 'http://localhost:1677/',
    PUBLIC_BASE_URL: 'https://app.example.com/duplicate',
  })],
  ['https://app.example.com', 'https://admin.example.com', 'http://localhost:1677'],
  'credentialed browser origins must come from an explicit normalized allowlist',
);

const authRouteSource = readSource('src/routes/auth.routes.ts');
const routeRegistrationSource = readSource('src/startup/registerAppRoutes.ts');
const imageUtilsSource = readSource('src/routes/images/utils.ts');
const eventStreamAuthSource = readSource('src/routes/events/event-stream-auth.ts');
const appMiddlewareSource = readSource('src/startup/configureAppMiddleware.ts');

assert.match(
  authRouteSource,
  /router\.post\('\/setup', requireInitialSetupAccess, asyncHandler\(handleSetup\)\)/,
  'first-admin setup must pass through the local-or-token trust gate',
);

for (const mountPath of ['/uploads', '/temp', '/save']) {
  assert.ok(
    routeRegistrationSource.includes(`registerRuntimeStaticDirectory(app, '${mountPath}'`),
    `${mountPath} must remain registered through the shared authenticated static helper`,
  );
}
assert.match(
  routeRegistrationSource,
  /app\.use\(mountPath, requireAuth, express\.static/,
  'runtime static media must require an authenticated session before serving files',
);
assert.match(
  routeRegistrationSource,
  /app\.use\('\/api\/folders', requireAdmin, watchedFoldersRoutes\)/,
  'watched-folder management must be admin-only',
);
assert.match(
  routeRegistrationSource,
  /app\.use\('\/api\/backup-sources', requireAdmin, backupSourcesRoutes\)/,
  'backup-source management must be admin-only',
);

assert.ok(
  imageUtilsSource.includes('`/api/images/${image.composite_hash}`'),
  'gallery media URLs must use the permission-gated image streaming routes',
);
assert.doesNotMatch(
  imageUtilsSource,
  /toUploadsUrl|toRuntimeRelativeUrl/,
  'gallery responses must not expose raw static upload paths',
);

assert.match(
  eventStreamAuthSource,
  /if \(!isDirectLoopbackRequest\(req\)\) \{[\s\S]*?return \{ ok: false, status: 401 \}/,
  'runtime event streams must not expose bootstrap privileges to remote clients',
);
assert.doesNotMatch(
  appMiddlewareSource,
  /callback\(null, true\);\s*\}\s*,\s*credentials: true/,
  'credentialed CORS must not reflect every browser origin',
);
assert.match(
  appMiddlewareSource,
  /allowedCorsOrigins\.has\(origin\)[\s\S]*?Cross-origin request is not allowed/,
  'credentialed CORS must reject browser origins outside the explicit allowlist',
);

console.log('✅ Security boundary contracts verified');
