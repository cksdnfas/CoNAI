import assert from 'node:assert/strict';
import {
  ALL_SUPPORTED_EXTENSIONS,
  isImageExtension,
  isSupportedExtension,
  isVideoExtension,
  normalizeFileExtension,
  shouldProcessFileExtension,
} from '../constants/supportedExtensions';

function verifyExtensionNormalization() {
  assert.equal(normalizeFileExtension('jpg'), '.jpg');
  assert.equal(normalizeFileExtension('.JPG'), '.jpg');
  assert.equal(normalizeFileExtension(' webp '), '.webp');
  assert.equal(isSupportedExtension('PNG'), true);
  assert.equal(isSupportedExtension('.tmp'), false);
  assert.equal(isImageExtension('jpeg'), true);
  assert.equal(isImageExtension('gif'), false);
  assert.equal(isVideoExtension('GIF'), true);
  assert.equal(isVideoExtension('.bmp'), false);
  assert.equal(ALL_SUPPORTED_EXTENSIONS.includes('.webm'), true);
}

function verifyExcludedExtensionNormalization() {
  assert.equal(shouldProcessFileExtension('jpg'), true);
  assert.equal(shouldProcessFileExtension('.JPG', ['jpg']), false);
  assert.equal(shouldProcessFileExtension('jpeg', ['.JPEG']), false);
  assert.equal(shouldProcessFileExtension('.png', [' webp ', 'PNG']), false);
  assert.equal(shouldProcessFileExtension('.webp', ['png']), true);
  assert.equal(shouldProcessFileExtension('.txt', ['txt']), false);
}

verifyExtensionNormalization();
verifyExcludedExtensionNormalization();

console.log('✅ Supported extension contracts verified');
