#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const MODES = {
  full: {
    description: 'Full active-source import ban check (excludes legacy snapshots)',
    prefixes: ['@mui/', '@emotion/'],
    excludedDirectories: [
      'frontend/src/legacy',
      'frontend/src/migrated',
    ],
  },
  'no-migrated': {
    description: 'Disallow migrated import aliases in active source',
    prefixes: ['@/migrated/'],
  },
  phase1: {
    description: 'Full import ban check for migration gate',
    prefixes: ['@mui/', '@emotion/', '@/legacy/', '@/migrated/'],
  },
  phase2: {
    description: 'Strict active-source import ban including compat aliases',
    prefixes: [
      '@mui/',
      '@emotion/',
      '@/legacy/',
      '@/migrated/',
      '@/components/ui/mui-compat',
      '@/components/ui/mui-icons-compat',
    ],
    excludedDirectories: [
      'frontend/src/legacy',
      'frontend/src/migrated',
    ],
  },
  providers: {
    description: 'Provider-layer import ban check',
    prefixes: ['@mui/', '@emotion/'],
    scopedFiles: [
      'frontend/src/app/parity-app.tsx',
      'frontend/src/contexts/theme-context.tsx',
      'frontend/src/app/providers.tsx',
    ],
  },
  'active-routes': {
    description: 'Active parity route surface import ban check',
    prefixes: ['@mui/', '@emotion/'],
    scopedFiles: [
      'frontend/src/app/parity-app.tsx',
      'frontend/src/features/home/home-page.tsx',
      'frontend/src/features/home/components/search-bar.tsx',
      'frontend/src/features/home/components/bulk-action-bar.tsx',
      'frontend/src/features/image-groups/image-groups-page.tsx',
      'frontend/src/features/image-groups/components/auto-collect-tab.tsx',
      'frontend/src/features/image-groups/components/basic-info-tab.tsx',
      'frontend/src/features/image-groups/components/group-assign-modal.tsx',
      'frontend/src/features/image-groups/components/group-create-edit-modal.tsx',
      'frontend/src/features/image-groups/components/group-delete-confirm-dialog.tsx',
      'frontend/src/features/image-groups/components/group-image-grid-modal.tsx',
      'frontend/src/features/image-groups/components/lora-dataset-dialog.tsx',
      'frontend/src/features/image-groups/components/search-auto-complete.tsx',
      'frontend/src/features/image-groups/components/simple-search-tab.tsx',
      'frontend/src/features/upload/upload-page.tsx',
      'frontend/src/features/settings/settings-page.tsx',
      'frontend/src/features/image-generation/image-generation-page.tsx',
      'frontend/src/features/image-generation/tabs/comfyui-tab.tsx',
      'frontend/src/features/image-generation/nai/components/nai-login-form.tsx',
      'frontend/src/features/image-generation/nai/components/nai-image-generator-v2.tsx',
      'frontend/src/features/image-detail/image-detail-page.tsx',
      'frontend/src/components/prompt-display/prompt-display.tsx',
      'frontend/src/components/prompt-display/prompt-card.tsx',
      'frontend/src/components/prompt-display/auto-tag-display.tsx',
      'frontend/src/features/workflows/workflow-form-page.tsx',
      'frontend/src/features/workflows/workflow-generate-page.tsx',
      'frontend/src/features/workflows/utils/node-style-helpers.tsx',
      'frontend/src/features/workflows/components/enhanced-workflow-graph-viewer.tsx',
      'frontend/src/features/workflows/components/graph-toolbar.tsx',
      'frontend/src/features/workflows/components/hierarchical-model-selector.tsx',
      'frontend/src/features/workflows/components/image-selection-modal.tsx',
      'frontend/src/features/workflows/components/marked-fields-guide.tsx',
      'frontend/src/features/workflows/components/marked-fields-preview.tsx',
      'frontend/src/features/workflows/components/workflow-json-viewer.tsx',
      'frontend/src/features/workflows/components/nodes/enhanced-custom-node.tsx',
      'frontend/src/features/workflows/components/marked-fields/marked-field-card.tsx',
    ],
  },
  'bridges-settings': {
    description: 'Settings bridge import gate',
    prefixes: ['@/legacy/', '@/migrated/'],
    scopedFiles: [
      'frontend/src/features/settings/settings-page.tsx',
      'frontend/src/bridges/settings/general-settings.tsx',
      'frontend/src/bridges/settings/tagger-settings.tsx',
      'frontend/src/bridges/settings/folder-settings.tsx',
      'frontend/src/bridges/settings/rating-score-settings.tsx',
      'frontend/src/bridges/settings/similarity-settings.tsx',
      'frontend/src/bridges/settings/auth-settings.tsx',
      'frontend/src/bridges/settings/external-api-settings.tsx',
      'frontend/src/bridges/settings/civitai-settings.tsx',
      'frontend/src/bridges/settings/prompt-explorer.tsx',
      'frontend/src/features/settings/bridges/general-settings.tsx',
      'frontend/src/features/settings/bridges/tagger-settings.tsx',
      'frontend/src/features/settings/bridges/folder-settings.tsx',
      'frontend/src/features/settings/bridges/rating-score-settings.tsx',
      'frontend/src/features/settings/bridges/similarity-settings.tsx',
      'frontend/src/features/settings/bridges/auth-settings.tsx',
      'frontend/src/features/settings/bridges/external-api-settings.tsx',
      'frontend/src/features/settings/bridges/civitai-settings.tsx',
      'frontend/src/features/settings/bridges/prompt-explorer.tsx',
    ],
  },
  'bridges-image-generation': {
    description: 'Image-generation bridge import gate',
    prefixes: ['@/legacy/', '@/migrated/'],
    scopedFiles: [
      'frontend/src/bridges/image-generation/custom-dropdown-lists-section.tsx',
      'frontend/src/bridges/image-generation/nai-anlas-display.tsx',
      'frontend/src/bridges/image-generation/nai-basic-settings.tsx',
      'frontend/src/bridges/image-generation/nai-group-selector.tsx',
      'frontend/src/bridges/image-generation/nai-output-settings.tsx',
      'frontend/src/bridges/image-generation/nai-sampling-settings.tsx',
      'frontend/src/bridges/image-generation/use-nai-generation.ts',
      'frontend/src/bridges/image-generation/use-repeat-execution.ts',
      'frontend/src/bridges/image-generation/wildcard-page.tsx',
    ],
  },
};

const RE_IMPORT_FROM = /^\s*import\s+[^'"`]*?\sfrom\s+(['"])([^'"\n]+)\1\s*;?\s*$/;
const RE_IMPORT_SIDE_EFFECT = /^\s*import\s+(['"])([^'"\n]+)\1\s*;?\s*$/;
const RE_REQUIRE_OR_DYNAMIC = /(?:import|require)\(\s*(['"])([^'"\n]+)\1\s*\)/;

function usage() {
  const scriptName = path.relative(PROJECT_ROOT, __filename).split(path.sep).join('/');
  const modes = Object.entries(MODES)
    .map(([mode, config]) => `  --mode=${mode}: ${config.description}`)
    .join('\n');

  return `Usage: node ${scriptName} --mode=<mode>\n\n` +
    'Checks frontend/src imports against banned prefixes for deterministic CI guards.\n\n' +
    `Available modes:\n${modes}`;
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

function collectSourceFiles(directory) {
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

function resolveScopedFiles(scopedFiles) {
  return scopedFiles
    .map((relativePath) => path.join(PROJECT_ROOT, relativePath))
    .filter((absolutePath) => fs.existsSync(absolutePath));
}

function resolveExcludedDirectories(excludedDirectories = []) {
  return excludedDirectories
    .map((relativePath) => path.join(PROJECT_ROOT, relativePath))
    .filter((absolutePath) => fs.existsSync(absolutePath));
}

function isInsideDirectory(filePath, directoryPath) {
  const relative = path.relative(directoryPath, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
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

function isBannedImport(source, prefixes) {
  return prefixes.some((prefix) => source.startsWith(prefix));
}

function findBannedImports(filePath, prefixes) {
  const rawContent = fs.readFileSync(filePath, 'utf8');
  const findings = [];
  const lines = rawContent.split(/\r?\n/);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || /^\//.test(trimmed)) {
      return;
    }

    const imports = extractImportsFromLine(line);
    for (const source of imports) {
      if (!isBannedImport(source, prefixes)) {
        continue;
      }

      findings.push({
        file: path.relative(PROJECT_ROOT, filePath).split(path.sep).join('/'),
        line: index + 1,
        source,
      });
    }
  });

  return findings;
}

function main() {
  let mode;
  try {
    mode = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const modeConfig = MODES[mode];
  const prefixes = modeConfig.prefixes;
  const frontSrc = path.join(PROJECT_ROOT, 'frontend', 'src');
  if (!fs.existsSync(frontSrc)) {
    console.error(`FAIL: frontend source directory not found: ${frontSrc}`);
    process.exit(1);
  }

  const files = modeConfig.scopedFiles && modeConfig.scopedFiles.length > 0
    ? resolveScopedFiles(modeConfig.scopedFiles)
    : collectSourceFiles(frontSrc);
  const excludedDirectories = resolveExcludedDirectories(modeConfig.excludedDirectories);
  const filteredFiles = excludedDirectories.length > 0
    ? files.filter((filePath) => !excludedDirectories.some((excludedPath) => isInsideDirectory(filePath, excludedPath)))
    : files;

  if (filteredFiles.length === 0) {
    console.error(`FAIL: no source files selected for mode '${mode}'.`);
    process.exit(1);
  }

  const scannedScope = modeConfig.scopedFiles ? `scoped files (${files.length})` : 'frontend/src';
  const findings = filteredFiles.flatMap((file) => findBannedImports(file, prefixes));

  findings.sort((a, b) => {
    if (a.file < b.file) return -1;
    if (a.file > b.file) return 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.source.localeCompare(b.source);
  });

  if (findings.length === 0) {
    console.log(`PASS: no banned imports found in ${scannedScope} for mode '${mode}'.`);
    process.exit(0);
  }

  console.log(`FAIL: found ${findings.length} banned import(s) in ${scannedScope} for mode '${mode}'.`);
  for (const finding of findings) {
    console.log(`${finding.file}:${finding.line}: ${finding.source}`);
  }
  process.exit(1);
}

main();
