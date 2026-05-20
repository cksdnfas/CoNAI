import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const backendRoot = process.cwd();
const settingsStorage = readFileSync(resolve(backendRoot, 'src/services/settingsServiceStorage.ts'), 'utf8');
const mediaSettingsRoutes = readFileSync(resolve(backendRoot, 'src/routes/settings/media-settings.routes.ts'), 'utf8');
const imageProcessor = readFileSync(resolve(backendRoot, 'src/services/imageProcessor.ts'), 'utf8');
const bundledSettings = JSON.parse(readFileSync(resolve(backendRoot, 'config/settings.json'), 'utf8')) as {
  thumbnail?: {
    size?: unknown;
    quality?: unknown;
  };
};

assert.match(
  settingsStorage,
  /thumbnail:\s*\{\s*size:\s*'2048',\s*quality:\s*85,\s*\}/,
  'settingsServiceStorage default thumbnail must be 2048px / quality 85',
);

assert.deepEqual(
  bundledSettings.thumbnail,
  { size: '2048', quality: 85 },
  'backend/config/settings.json thumbnail defaults must be 2048px / quality 85',
);

assert.match(
  mediaSettingsRoutes,
  /router\.put\(\s*['"]\/thumbnail['"]/,
  'media settings routes must expose PUT /thumbnail',
);
assert.ok(
  mediaSettingsRoutes.includes("const validSizes = ['original', '2048', '1080', '720', '512'] as const;"),
  'thumbnail route must validate the shared thumbnail size enum',
);
assert.ok(
  mediaSettingsRoutes.includes('validateNumberInRangeIfDefined(res, thumbnailSettings.quality, 60, 100'),
  'thumbnail route must validate quality in the 60-100 range',
);
assert.ok(
  mediaSettingsRoutes.includes('settingsService.updateThumbnailSettings(thumbnailSettings)'),
  'thumbnail route must persist through settingsService.updateThumbnailSettings',
);

assert.match(
  imageProcessor,
  /const \{\s*size:\s*sizeOption,\s*quality\s*\}\s*=\s*settings\.thumbnail;/,
  'thumbnail generation must read size and quality from saved settings',
);
assert.match(
  imageProcessor,
  /sizeOption\s*===\s*['"]original['"][\s\S]*targetSize\s*=\s*undefined/,
  'thumbnail generation must preserve original dimensions for the original size option',
);
assert.match(
  imageProcessor,
  /targetSize\s*=\s*parseInt\(sizeOption,\s*10\)/,
  'thumbnail generation must parse configured numeric thumbnail sizes',
);
assert.match(
  imageProcessor,
  /\.webp\(\{[\s\S]*quality:\s*quality/,
  'thumbnail generation must pass configured quality to WebP output',
);

console.log('✅ Thumbnail default settings contracts verified');
