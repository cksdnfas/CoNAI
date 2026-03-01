#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const requiredMissingDirs = [
  path.join(PROJECT_ROOT, 'frontend', 'src', 'legacy'),
  path.join(PROJECT_ROOT, 'frontend', 'src', 'migrated'),
];

const existing = requiredMissingDirs
  .filter((dirPath) => fs.existsSync(dirPath))
  .map((dirPath) => path.relative(PROJECT_ROOT, dirPath).split(path.sep).join('/'));

if (existing.length > 0) {
  console.error(`FAIL: legacy directories must be removed, found ${existing.length}.`);
  for (const dirPath of existing) {
    console.error(`- ${dirPath}`);
  }
  process.exit(1);
}

console.log('PASS: legacy and migrated directories are absent.');
