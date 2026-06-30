import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const serviceSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/services/backgroundProcessorService.ts'),
  'utf8',
);

assert.match(
  serviceSource,
  /function markFileAsProcessingFailed[\s\S]*file_status = 'failed'/,
  'unrecoverable media processing failures should move rows out of the active unhashed queue',
);

assert.match(
  serviceSource,
  /stats\.size <= 0[\s\S]*markFileAsProcessingFailed\(file\.id, file\.original_file_path, 'empty file'\)/,
  'empty media files should be marked failed instead of retried forever',
);

assert.match(
  serviceSource,
  /function isUnsupportedImageFormatError[\s\S]*unsupported image format/,
  'unsupported sharp image errors should be classified as unrecoverable',
);

assert.match(
  serviceSource,
  /catch \(error\)[\s\S]*isUnsupportedImageFormatError\(error\)[\s\S]*markFileAsProcessingFailed\(file\.id, file\.original_file_path, 'unsupported image format'\)/,
  'unsupported image files should be marked failed during hash generation',
);

console.log('✅ Invalid media processing contracts verified');
