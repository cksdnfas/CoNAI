#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const MODES = {
  warn: {
    description: 'List banned dependencies and continue',
  },
  strict: {
    description: 'Fail when banned dependencies are present',
  },
};

const BANNED_PREFIXES = ['@mui/', '@emotion/'];
const MANIFESTS = [
  path.join(PROJECT_ROOT, 'package.json'),
  path.join(PROJECT_ROOT, 'frontend', 'package.json'),
];

function usage() {
  const scriptName = path.relative(PROJECT_ROOT, __filename).split(path.sep).join('/');
  const modeRows = Object.entries(MODES)
    .map(([mode, config]) => `  --mode=${mode}: ${config.description}`)
    .join('\n');

  return `Usage: node ${scriptName} --mode=<mode>\n\n` +
    'Checks for banned dependency declarations in package manifests.\n\n' +
    `Available modes:\n${modeRows}`;
}

function parseArgs(argv) {
  const modeArg = argv.find((arg) => arg.startsWith('--mode='));
  const requestedMode = modeArg ? modeArg.split('=', 2)[1] : '';
  if (!requestedMode || !MODES[requestedMode]) {
    const provided = modeArg ? `\nUnknown or missing mode: '${requestedMode || ''}'.` : '';
    throw new Error(`${provided}\n\n${usage()}`);
  }
  return requestedMode;
}

function readManifest(manifestPath) {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  return JSON.parse(raw);
}

function collectBannedDeps(manifestPath, manifest) {
  const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
  const entries = [];

  for (const section of sections) {
    const bag = manifest[section];
    if (!bag || typeof bag !== 'object') {
      continue;
    }

    for (const name of Object.keys(bag)) {
      if (!BANNED_PREFIXES.some((prefix) => name === prefix.replace(/\/$/, '') || name.startsWith(prefix))) {
        continue;
      }

      entries.push({
        manifest: path.relative(PROJECT_ROOT, manifestPath).split(path.sep).join('/'),
        section,
        name,
      });
    }
  }

  return entries;
}

function main() {
  let mode;
  try {
    mode = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const allFindings = [];

  for (const manifestPath of MANIFESTS) {
    if (!fs.existsSync(manifestPath)) {
      continue;
    }

    const manifest = readManifest(manifestPath);
    allFindings.push(...collectBannedDeps(manifestPath, manifest));
  }

  allFindings.sort((a, b) => {
    if (a.manifest < b.manifest) return -1;
    if (a.manifest > b.manifest) return 1;
    if (a.section < b.section) return -1;
    if (a.section > b.section) return 1;
    return a.name.localeCompare(b.name);
  });

  if (allFindings.length === 0) {
    console.log('PASS: no banned dependency names found.');
    process.exit(0);
  }

  console.log(`INFO: found ${allFindings.length} banned dependency match(es).`);
  for (const finding of allFindings) {
    console.log(`${finding.manifest}: ${finding.section} -> ${finding.name}`);
  }

  if (mode === 'strict') {
    process.exit(1);
  }

  process.exit(0);
}

main();
