#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FRONTEND_SRC = path.join(PROJECT_ROOT, 'frontend', 'src');
const PLACEHOLDER_TARGET_DIRECTORIES = [
  path.join(FRONTEND_SRC, 'features', 'settings', 'bridges'),
  path.join(FRONTEND_SRC, 'features', 'image-generation', 'bridges'),
];

const MODES = new Set(['warn', 'error']);
const TARGETS = new Set(['bridge-imports', 'placeholder-bridges', 'all']);
const PLACEHOLDER_TOKEN = 'unavailable in this build';

const RE_IMPORT_FROM = /^\s*import\s+[^'"`]*?\sfrom\s+(['"])([^'"\n]+)\1\s*;?\s*$/;
const RE_IMPORT_SIDE_EFFECT = /^\s*import\s+(['"])([^'"\n]+)\1\s*;?\s*$/;
const RE_REQUIRE_OR_DYNAMIC = /(?:import|require)\(\s*(['"])([^'"\n]+)\1\s*\)/;

function usage() {
  const scriptName = path.relative(PROJECT_ROOT, __filename).split(path.sep).join('/');
  return `Usage: node ${scriptName} --target=<bridge-imports|placeholder-bridges|all> --mode=<warn|error>\n\n` +
    'Bridge guardrail counters scoped to active runtime frontend source tree.';
}

function parseArgs(argv) {
  const modeArg = argv.find((arg) => arg.startsWith('--mode='));
  const targetArg = argv.find((arg) => arg.startsWith('--target='));
  const mode = modeArg ? modeArg.split('=', 2)[1] : 'warn';
  const target = targetArg ? targetArg.split('=', 2)[1] : 'all';

  if (!MODES.has(mode)) {
    throw new Error(`Unknown mode '${mode}'.\n\n${usage()}`);
  }
  if (!TARGETS.has(target)) {
    throw new Error(`Unknown target '${target}'.\n\n${usage()}`);
  }

  return { mode, target };
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function collectSourceFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      result.push(...collectSourceFiles(entryPath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const lower = entry.name.toLowerCase();
    if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.js') || lower.endsWith('.jsx')) {
      result.push(entryPath);
    }
  }

  return result;
}

function extractImportsFromLine(line) {
  const fromMatch = line.match(RE_IMPORT_FROM);
  if (fromMatch) {
    return [fromMatch[2]];
  }

  const sideEffectMatch = line.match(RE_IMPORT_SIDE_EFFECT);
  if (sideEffectMatch) {
    return [sideEffectMatch[2]];
  }

  const callMatch = line.match(RE_REQUIRE_OR_DYNAMIC);
  if (callMatch) {
    return [callMatch[2]];
  }

  return [];
}

function countBridgeImports() {
  const files = collectSourceFiles(FRONTEND_SRC);
  const findings = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const imports = extractImportsFromLine(lines[lineIndex]);
      for (const source of imports) {
        if (!source.startsWith('@/bridges/')) {
          continue;
        }
        findings.push({
          file: toPosixPath(path.relative(PROJECT_ROOT, filePath)),
          line: lineIndex + 1,
          source,
        });
      }
    }
  }

  findings.sort((a, b) => {
    if (a.file < b.file) return -1;
    if (a.file > b.file) return 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.source.localeCompare(b.source);
  });

  return findings;
}

function countOccurrences(line, token) {
  if (!line || !token) {
    return 0;
  }

  let count = 0;
  let index = line.indexOf(token);
  while (index !== -1) {
    count += 1;
    index = line.indexOf(token, index + token.length);
  }

  return count;
}

function countPlaceholderBridgeText() {
  const findings = [];

  for (const directoryPath of PLACEHOLDER_TARGET_DIRECTORIES) {
    const files = collectSourceFiles(directoryPath);
    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split(/\r?\n/);

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const matchesInLine = countOccurrences(lines[lineIndex], PLACEHOLDER_TOKEN);
        if (matchesInLine === 0) {
          continue;
        }

        findings.push({
          file: toPosixPath(path.relative(PROJECT_ROOT, filePath)),
          line: lineIndex + 1,
          matchesInLine,
        });
      }
    }
  }

  findings.sort((a, b) => {
    if (a.file < b.file) return -1;
    if (a.file > b.file) return 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.matchesInLine - b.matchesInLine;
  });

  return findings;
}

function selectedTargets(target) {
  if (target === 'all') {
    return ['bridge-imports', 'placeholder-bridges'];
  }
  return [target];
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exit(1);
  }

  if (!fs.existsSync(FRONTEND_SRC)) {
    console.error(`FAIL: frontend source directory not found: ${toPosixPath(path.relative(PROJECT_ROOT, FRONTEND_SRC))}`);
    process.exit(1);
  }

  const targets = selectedTargets(options.target);
  const bridgeImportFindings = targets.includes('bridge-imports') ? countBridgeImports() : [];
  const placeholderFindings = targets.includes('placeholder-bridges') ? countPlaceholderBridgeText() : [];

  const bridgeImportCount = bridgeImportFindings.length;
  const placeholderCount = placeholderFindings.reduce((sum, item) => sum + item.matchesInLine, 0);

  console.log(`INFO: mode=${options.mode} target=${options.target}`);
  console.log('INFO: scope=frontend/src (active runtime only)');

  if (targets.includes('bridge-imports')) {
    console.log(`COUNT bridge-imports (@/bridges/ imports): ${bridgeImportCount}`);
    for (const finding of bridgeImportFindings) {
      console.log(`  ${finding.file}:${finding.line}: ${finding.source}`);
    }
  }

  if (targets.includes('placeholder-bridges')) {
    console.log(`COUNT placeholder-bridges ("${PLACEHOLDER_TOKEN}"): ${placeholderCount}`);
    for (const finding of placeholderFindings) {
      console.log(`  ${finding.file}:${finding.line}: matches=${finding.matchesInLine}`);
    }
  }

  const selectedCount =
    (targets.includes('bridge-imports') ? bridgeImportCount : 0) +
    (targets.includes('placeholder-bridges') ? placeholderCount : 0);

  if (options.mode === 'error' && selectedCount > 0) {
    console.log('FAIL: bridge guardrail count is non-zero.');
    process.exit(1);
  }

  console.log('PASS: bridge guardrail count check completed.');
  process.exit(0);
}

main();
