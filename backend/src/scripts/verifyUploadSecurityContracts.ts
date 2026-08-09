import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  MAX_MULTIPLE_UPLOAD_FILES,
  MAX_MULTIPLE_UPLOAD_TOTAL_BYTES,
} from '../middleware/upload';
import {
  resolveRequestBodyLimitTier,
  resolveRequestBodyLimitsMb,
} from '../middleware/requestBodyLimits';
import {
  UploadValidationError,
  cleanupStoredUpload,
  cleanupTemporaryUploads,
  validateUploadedMediaFile,
} from '../routes/images/uploadSecurity';

const projectRoot = path.resolve(__dirname, '../../..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function createUploadFile(filePath: string, mimetype: string, originalname = path.basename(filePath)): Express.Multer.File {
  const size = fs.statSync(filePath).size;
  return {
    fieldname: 'image',
    originalname,
    encoding: '7bit',
    mimetype,
    size,
    destination: path.dirname(filePath),
    filename: path.basename(filePath),
    path: filePath,
    buffer: Buffer.alloc(0),
    stream: null as never,
  };
}

function verifyAuthorizationAndLimiterContracts(): void {
  const uploadRoutes = readSource('backend/src/routes/images/upload.routes.ts');
  const utilityRoutes = readSource('backend/src/routes/images/uploadMetadataUtilityRoutes.ts');
  const routeRegistration = readSource('backend/src/startup/registerAppRoutes.ts');
  const authRoutes = readSource('backend/src/routes/auth.routes.ts');
  const authMiddleware = readSource('backend/src/middleware/authMiddleware.ts');
  const permissionGroups = readSource('backend/src/models/AuthPermissionGroup.ts');
  const loginPage = readSource('frontend/src/features/auth/login-page.tsx');
  const securityUiText = readSource('frontend/src/features/settings/components/security-ui-text.ts');

  for (const routePath of ['/upload', '/upload-multiple', '/upload-multiple-stream']) {
    const routeOffset = uploadRoutes.indexOf(`router.post('${routePath}'`);
    assert.ok(routeOffset >= 0, `${routePath} must remain registered`);
    const routeSlice = uploadRoutes.slice(routeOffset, routeOffset + 320);
    assert.ok(routeSlice.indexOf("requirePermission('upload.create')") >= 0, `${routePath} must require upload.create`);
    assert.ok(routeSlice.indexOf("requirePermission('upload.create')") < routeSlice.indexOf(routePath === '/upload' ? 'uploadSingle' : 'uploadMultiple'), `${routePath} must authorize before Multer`);
  }

  assert.match(authMiddleware, /req\.session\?\.authenticated !== true[\s\S]*res\.status\(401\)/);
  assert.match(authMiddleware, /permissionKeys\.includes\(permissionKey\)[\s\S]*res\.status\(403\)/);
  assert.match(uploadRoutes, /return res\.status\(201\)\.json\(response\)/);

  for (const routePath of ['/convert-webp', '/rewrite-metadata', '/extract-metadata', '/extract-tagger', '/extract-kaloscope']) {
    const routeOffset = utilityRoutes.indexOf(`router.post('${routePath}'`);
    assert.ok(routeOffset >= 0, `${routePath} must remain registered`);
    const routeSlice = utilityRoutes.slice(routeOffset, routeOffset + 300);
    assert.ok(routeSlice.indexOf("requirePermission('page.upload.view')") >= 0, `${routePath} must require page.upload.view`);
    assert.ok(routeSlice.indexOf("requirePermission('page.upload.view')") < routeSlice.indexOf('uploadSingle'), `${routePath} must authorize before Multer`);
  }

  assert.match(routeRegistration, /isImageUploadPayloadRequest\(req\)[\s\S]*options\.uploadLimiter\(req, res, next\)/);
  assert.match(authRoutes, /router\.post\('\/guest-accounts', guestAccountLimiter, allowAnonymousPermission\('auth\.guest\.create'\)/);
  assert.match(permissionGroups, /'auth\.guest\.create'/);
  assert.match(permissionGroups, /'upload\.create'/);
  assert.match(loginPage, /permissionKeys\.includes\('auth\.guest\.create'\)/);
  assert.match(loginPage, /canCreateGuestAccount \? \(/);
  assert.match(
    securityUiText,
    /'auth\.guest\.create': \{ ko: '게스트 회원가입', en: 'Guest account signup' \}/,
  );
}

function verifyBoundedMultipartContracts(): void {
  assert.equal(MAX_MULTIPLE_UPLOAD_FILES, 20);
  assert.equal(MAX_MULTIPLE_UPLOAD_TOTAL_BYTES, 1024 * 1024 * 1024);

  const uploadMiddleware = readSource('backend/src/middleware/upload.ts');
  const uploadSecurity = readSource('backend/src/routes/images/uploadSecurity.ts');
  assert.match(uploadMiddleware, /files: MAX_MULTIPLE_UPLOAD_FILES/);
  assert.match(uploadMiddleware, /fileSize: MAX_UPLOAD_FILE_SIZE_BYTES/);
  assert.match(uploadSecurity, /rejectOversizedMultipleUploadRequest/);
  assert.match(uploadSecurity, /cleanupTemporaryUploads\(files\)/);
}

async function verifyActualContentAndCleanupContracts(): Promise<void> {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'conai-upload-security-'));
  try {
    const validPngPath = path.join(tempRoot, 'valid.png');
    await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 20, g: 40, b: 60, alpha: 1 },
      },
    }).png().toFile(validPngPath);

    await validateUploadedMediaFile(createUploadFile(validPngPath, 'image/png'));

    const mismatchedPath = path.join(tempRoot, 'mismatch.png');
    await fs.promises.copyFile(validPngPath, mismatchedPath);
    await assert.rejects(
      validateUploadedMediaFile(createUploadFile(mismatchedPath, 'image/jpeg')),
      UploadValidationError,
    );
    await cleanupTemporaryUploads([createUploadFile(mismatchedPath, 'image/jpeg')]);
    assert.equal(fs.existsSync(mismatchedPath), false, 'rejected staged files must be deleted');

    const fakeImagePath = path.join(tempRoot, 'fake.png');
    await fs.promises.writeFile(fakeImagePath, 'not an image');
    await assert.rejects(
      validateUploadedMediaFile(createUploadFile(fakeImagePath, 'image/png')),
      UploadValidationError,
    );
    await cleanupTemporaryUploads([createUploadFile(fakeImagePath, 'image/png')]);
    assert.equal(fs.existsSync(fakeImagePath), false, 'invalid staged files must leave no residue');

    const uploadRoot = path.join(tempRoot, 'uploads');
    const outsidePath = path.join(tempRoot, 'outside.png');
    await fs.promises.mkdir(uploadRoot);
    await fs.promises.writeFile(outsidePath, 'keep');
    await cleanupStoredUpload(uploadRoot, '..\\outside.png');
    assert.equal(fs.existsSync(outsidePath), true, 'cleanup must refuse paths outside the upload root');
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
}

/**
 * JSON body limits must be scoped per API mount instead of granting every route the media limit.
 * Routes that legitimately carry base64 data URLs keep the historical 50MB budget; everything
 * else — including anonymous-reachable search routes — is bounded far below it.
 */
function verifyScopedJsonBodyLimitContracts(): void {
  const middleware = readSource('backend/src/startup/configureAppMiddleware.ts');
  assert.doesNotMatch(
    middleware,
    /express\.json\(\{\s*limit:\s*`\$\{IMAGE_PROCESSING\.MAX_FILE_SIZE_MB\}mb`/,
    'the global express.json parser must no longer grant the media upload limit to every route',
  );
  assert.match(middleware, /createTieredBodyParsers\(\)/, 'configureAppMiddleware must install the tiered body parsers');

  const limitsMb = resolveRequestBodyLimitsMb();
  assert.equal(limitsMb.media, 50, 'base64-carrying routes must keep the 50MB budget');
  assert.ok(limitsMb.default <= 5, 'the default JSON body limit must stay at or below 5MB');
  assert.ok(
    limitsMb.default < limitsMb.bulk && limitsMb.bulk < limitsMb.media,
    'body limit tiers must stay strictly ordered default < bulk < media',
  );

  const mediaPaths = [
    '/api/image-editor/12/save-output',
    '/api/nai/generate/image',
    '/api/nai/store/vibes',
    '/api/generation-queue',
    '/api/graph-workflows',
    '/api/graph-workflows/7/execute',
    '/api/graph-workflows/schedules',
    '/api/module-definitions/from-nai-snapshot',
    '/api/public-workflows/demo/queue',
    '/api/workflows/3/generate',
  ];
  for (const mediaPath of mediaPaths) {
    assert.equal(
      resolveRequestBodyLimitTier(mediaPath),
      'media',
      `${mediaPath} carries base64 data URLs and must keep the media body limit`,
    );
  }

  const bulkPaths = [
    '/api/images/bulk',
    '/api/images/batch-tag',
    '/api/groups/4/images/bulk',
    '/api/prompt-groups/import',
    '/api/negative-prompt-groups/import',
    '/api/prompt-collection/batch-assign',
    '/api/wildcards/9',
    '/api/settings/appearance',
    '/api/custom-dropdown-lists',
  ];
  for (const bulkPath of bulkPaths) {
    assert.equal(
      resolveRequestBodyLimitTier(bulkPath),
      'bulk',
      `${bulkPath} carries uncapped arrays or import documents and must keep the bulk body limit`,
    );
  }

  const defaultPaths = [
    '/api/auth/login',
    '/api/search-history',
    '/api/comfyui-servers',
    '/api/generation-history',
    '/api/jobs/12/cancel',
    '/api/system/restart',
    '/api/workflows-not-a-real-mount',
    '/mcp',
    '/health',
  ];
  for (const defaultPath of defaultPaths) {
    assert.equal(
      resolveRequestBodyLimitTier(defaultPath),
      'default',
      `${defaultPath} must fall back to the default body limit`,
    );
  }

  assert.equal(
    resolveRequestBodyLimitTier('/API/Image-Editor/12/save-output'),
    'media',
    'tier resolution must be case-insensitive like Express mount matching',
  );
}

async function main(): Promise<void> {
  verifyAuthorizationAndLimiterContracts();
  verifyBoundedMultipartContracts();
  verifyScopedJsonBodyLimitContracts();
  await verifyActualContentAndCleanupContracts();
  console.log('✅ Upload security contracts verified');
}

void main();
