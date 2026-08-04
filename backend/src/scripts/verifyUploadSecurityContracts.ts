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

async function main(): Promise<void> {
  verifyAuthorizationAndLimiterContracts();
  verifyBoundedMultipartContracts();
  await verifyActualContentAndCleanupContracts();
  console.log('✅ Upload security contracts verified');
}

void main();
