import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

const imageSearchSource = readSource('src/models/Image/ImageSearchModel.ts');
const fileQueriesSource = readSource('src/models/Image/MediaMetadataFileQueries.ts');

const randomFromSearchStart = imageSearchSource.indexOf('static async getRandomFromSearch');
assert.notEqual(randomFromSearchStart, -1, 'getRandomFromSearch should exist');
const randomFromSearchSource = imageSearchSource.slice(randomFromSearchStart);

assert.doesNotMatch(
  randomFromSearchSource,
  /COUNT\(\*\)|OFFSET/i,
  'random-from-search must not use count plus deep offset scans',
);
assert.match(
  randomFromSearchSource,
  /requireActiveFile:\s*true/,
  'random-from-search should only select active files',
);
assert.match(
  randomFromSearchSource,
  /SELECT MAX\(id\) as maxFileId[\s\S]*FROM image_files/,
  'random-from-search should choose a random indexed file-id start point',
);
assert.match(
  randomFromSearchSource,
  /INNER JOIN media_metadata im ON if\.composite_hash = im\.composite_hash/,
  'random-from-search should drive selection from active image_files',
);
assert.match(
  randomFromSearchSource,
  /AND if\.id >= \?/,
  'random-from-search should seek from the random file-id start point',
);
assert.match(
  randomFromSearchSource,
  /ORDER BY if\.id ASC[\s\S]*LIMIT 1/,
  'random-from-search should use a bounded indexed candidate query',
);

const randomByFileTypeStart = fileQueriesSource.indexOf('static getRandomByFileType');
const randomImageStart = fileQueriesSource.indexOf('/** Pick one random active image', randomByFileTypeStart);
assert.notEqual(randomByFileTypeStart, -1, 'getRandomByFileType should exist');
assert.notEqual(randomImageStart, -1, 'getRandomImage marker should exist');
const randomByFileTypeSource = fileQueriesSource.slice(randomByFileTypeStart, randomImageStart);

assert.doesNotMatch(
  randomByFileTypeSource,
  /COUNT\(\*\)|OFFSET/i,
  'random media selection must not use count plus deep offset scans',
);
assert.match(
  randomByFileTypeSource,
  /SELECT MAX\(id\) as maxFileId[\s\S]*FROM image_files/,
  'random media selection should choose a random indexed file-id start point',
);
assert.match(
  randomByFileTypeSource,
  /if\.file_status = 'active'/,
  'random media selection should only select active files',
);
assert.match(
  randomByFileTypeSource,
  /AND if\.id >= \?/,
  'random media selection should seek from the random file-id start point',
);
assert.match(
  randomByFileTypeSource,
  /ORDER BY if\.id ASC[\s\S]*LIMIT 1/,
  'random media selection should use a bounded indexed candidate query',
);

console.log('✅ Random media selection contracts verified');
