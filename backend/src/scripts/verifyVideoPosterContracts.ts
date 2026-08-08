import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(__dirname, '../../..');
const videoProcessorSource = fs.readFileSync(
  path.join(projectRoot, 'backend/src/services/videoProcessor.ts'),
  'utf8',
);
const frameExtractorSource = fs.readFileSync(
  path.join(projectRoot, 'backend/src/services/videoFrameExtractor.ts'),
  'utf8',
);
const posterHandlerSource = fs.readFileSync(
  path.join(projectRoot, 'backend/src/services/runtimeJobs/handlers/videoPosterHandlers.ts'),
  'utf8',
);

assert.match(
  videoProcessorSource,
  /listFFmpegPaths\(\): string\[\][\s\S]*?new Set\(\[ffmpegPath, 'ffmpeg'\]/,
  'frame extraction must expose bundled FFmpeg first and system FFmpeg as a fallback',
);
assert.match(
  frameExtractorSource,
  /for \(const ffmpegCmd of VideoProcessor\.listFFmpegPaths\(\)\)[\s\S]*?spawn\(ffmpegCmd[\s\S]*?errors\.push/,
  'frame extraction must try every FFmpeg candidate before failing',
);
assert.match(
  frameExtractorSource,
  /errors\.push[\s\S]*?fs\.promises\.rm\(outputPath, \{ force: true \}\)/,
  'a failed decoder attempt must remove partial output before fallback',
);
assert.match(
  posterHandlerSource,
  /const activePosterGenerations = new Set<string>\(\)/,
  'poster jobs must share one in-process claim set',
);
assert.match(
  posterHandlerSource,
  /activePosterGenerations\.has\(compositeHash\)[\s\S]*?activePosterGenerations\.add\(compositeHash\)[\s\S]*?finally[\s\S]*?activePosterGenerations\.delete\(compositeHash\)/,
  'poster claims must skip concurrent duplicates and always release',
);
assert.match(
  posterHandlerSource,
  /pending\.delete\(row\.composite_hash\)[\s\S]*?generatePoster\(row\.composite_hash/,
  'the full sweep must remove claimed rows from the opportunistic queue',
);

console.log('✅ Video poster contracts verified');
