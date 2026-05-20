import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const backendRoot = process.cwd();
const settingsStorage = readFileSync(resolve(backendRoot, 'src/services/settingsServiceStorage.ts'), 'utf8');
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

console.log('✅ Thumbnail default settings contracts verified');
