#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(PROJECT_ROOT, '..');

const SCOPES = {
  active: {
    description: 'Gate active-source findings only',
    categories: ['active-source'],
    failOnFindings: true,
  },
  generated: {
    description: 'Gate generated-artifact findings only',
    categories: ['generated-artifact'],
    failOnFindings: true,
  },
  full: {
    description: 'Inventory UI signatures across repository roots',
    categories: ['active-source', 'generated-artifact', 'archive-backup', 'example-upload'],
    failOnFindings: false,
  },
};

const FORMATS = new Set(['text', 'json']);
const CATEGORIES = ['active-source', 'generated-artifact', 'archive-backup', 'example-upload'];
const ROOT_DEFINITIONS = [
  { name: 'CoNAI', directory: PROJECT_ROOT },
  { name: 'CoNAI_Git', directory: path.join(WORKSPACE_ROOT, 'Comfyui_Image_Manager_Git') },
  { name: '_repo_cleanup_outbox', directory: path.join(WORKSPACE_ROOT, '_repo_cleanup_outbox') },
  { name: '_tmp_upload_examples', directory: path.join(WORKSPACE_ROOT, '_tmp_upload_examples') },
];

const SKIP_DIRECTORIES = new Set([
  '.git',
  '.sisyphus',
  'node_modules',
  '.next',
  '.turbo',
  '.cache',
]);

const SIGNATURES = [
  { name: 'mui-prefix', regex: /@mui\/[A-Za-z0-9_./-]*/g },
  { name: 'emotion-prefix', regex: /@emotion\/[A-Za-z0-9_./-]*/g },
  { name: 'mui-compat', regex: /\bmui-compat\b/g },
  { name: 'mui-icons-compat', regex: /\bmui-icons-compat\b/g },
  { name: 'mui-class-selector', regex: /\.Mui[A-Za-z0-9_-]+/g },
];

const GENERATED_SCOPE_IGNORED_TOKENS = new Set([
  '.MuiContent',
  '.MuiContentVariant',
]);

function usage() {
  const scriptName = path.relative(PROJECT_ROOT, __filename).split(path.sep).join('/');
  const scopeRows = Object.entries(SCOPES)
    .map(([scope, config]) => `  --scope=${scope}: ${config.description}`)
    .join('\n');

  return `Usage: node ${scriptName} --scope=<scope> [--format=<format>] [--out=<path>]\n\n` +
    'Inventories MUI/compat UI signatures and emits deterministic categorized findings.\n\n' +
    `Available scopes:\n${scopeRows}\n\n` +
    'Formats: text (default), json';
}

function parseArgs(argv) {
  const scopeArg = argv.find((arg) => arg.startsWith('--scope='));
  const formatArg = argv.find((arg) => arg.startsWith('--format='));
  const outArg = argv.find((arg) => arg.startsWith('--out='));

  const scope = scopeArg ? scopeArg.split('=', 2)[1] : '';
  const format = formatArg ? formatArg.split('=', 2)[1] : 'text';
  const out = outArg ? outArg.split('=', 2)[1] : '';

  if (!scope || !SCOPES[scope]) {
    throw new Error(`Unknown or missing scope: '${scope}'.\n\n${usage()}`);
  }
  if (!FORMATS.has(format)) {
    throw new Error(`Unknown format: '${format}'. Allowed formats: text, json.`);
  }
  if (format === 'json') {
    if (!out || !out.trim()) {
      throw new Error('Invalid output path for json format: --out must be a non-empty path.');
    }
  }

  return { scope, format, out: out.trim() };
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function isTextFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const byte of sample) {
    if (byte === 0) {
      return false;
    }
  }
  return true;
}

function collectFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) {
        continue;
      }
      files.push(...collectFiles(entryPath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }
    files.push(entryPath);
  }

  return files;
}

function isGeneratedPath(relativePath) {
  return /(^|\/)(dist|build-output|coverage|\.vercel|\.output)(\/|$)/.test(relativePath)
    || /(^|\/)assets\//.test(relativePath);
}

function isArchivePath(relativePath) {
  return /(^|\/)(backup|legacy|archive|snapshot|old|_migration_backup)(\/|$)/i.test(relativePath);
}

function isActiveSourcePath(rootName, rootRelativePath) {
  return rootName === 'CoNAI' && rootRelativePath.startsWith('frontend/src/');
}

function categorizeFinding(rootName, rootRelativePath) {
  if (rootName === '_tmp_upload_examples') {
    return 'example-upload';
  }
  if (isGeneratedPath(rootRelativePath)) {
    return 'generated-artifact';
  }
  if (rootName === '_repo_cleanup_outbox' || isArchivePath(rootRelativePath)) {
    return 'archive-backup';
  }
  if (isActiveSourcePath(rootName, rootRelativePath)) {
    return 'active-source';
  }
  return null;
}

function collectMatchesForLine(line) {
  const matches = [];
  for (const signature of SIGNATURES) {
    signature.regex.lastIndex = 0;
    let match = signature.regex.exec(line);
    while (match) {
      matches.push({ token: match[0], signature: signature.name, index: match.index });
      match = signature.regex.exec(line);
    }
  }

  matches.sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index;
    if (a.token < b.token) return -1;
    if (a.token > b.token) return 1;
    return a.signature.localeCompare(b.signature);
  });
  return matches;
}

function scanRoot(rootName, rootDirectory, scopeName) {
  if (!fs.existsSync(rootDirectory)) {
    return { missing: true, filesScanned: 0, findings: [] };
  }

  const files = collectFiles(rootDirectory);
  const findings = [];
  let filesScanned = 0;

  for (const filePath of files) {
    const rootRelativePath = toPosixPath(path.relative(rootDirectory, filePath));
    if (!shouldScanFileForScope(scopeName, rootName, rootRelativePath)) {
      continue;
    }

    const category = categorizeFinding(rootName, rootRelativePath);
    if (!category) {
      continue;
    }

    if (!isTextFile(filePath)) {
      continue;
    }

    filesScanned += 1;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const workspaceRelativePath = toPosixPath(path.relative(WORKSPACE_ROOT, filePath));

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const matches = collectMatchesForLine(line);
      for (const match of matches) {
        if (scopeName === 'generated' && GENERATED_SCOPE_IGNORED_TOKENS.has(match.token)) {
          continue;
        }
        findings.push({
          category,
          root: rootName,
          file: workspaceRelativePath,
          line: lineIndex + 1,
          token: match.token,
          signature: match.signature,
        });
      }
    }
  }

  return { missing: false, filesScanned, findings };
}

function buildMatrix(roots, findings) {
  const byCategory = {};
  const byRoot = {};
  const matrix = {};

  for (const category of CATEGORIES) {
    byCategory[category] = 0;
    matrix[category] = {};
    for (const rootName of roots) {
      matrix[category][rootName] = 0;
    }
  }

  for (const rootName of roots) {
    byRoot[rootName] = 0;
  }

  for (const finding of findings) {
    byCategory[finding.category] += 1;
    byRoot[finding.root] += 1;
    matrix[finding.category][finding.root] += 1;
  }

  return { byCategory, byRoot, matrix };
}

function filterFindingsForScope(scopeConfig, findings) {
  const categorySet = new Set(scopeConfig.categories);
  return findings.filter((finding) => categorySet.has(finding.category));
}

function shouldScanFileForScope(scopeName, rootName, rootRelativePath) {
  if (scopeName === 'full') {
    return categorizeFinding(rootName, rootRelativePath) !== null;
  }

  if (scopeName === 'active') {
    return rootName === 'CoNAI' && rootRelativePath.startsWith('frontend/src/');
  }

  if (scopeName === 'generated') {
    return rootName === 'CoNAI' && categorizeFinding(rootName, rootRelativePath) === 'generated-artifact' && (rootRelativePath.startsWith('frontend/dist/') || rootRelativePath.startsWith('build-output/'));
  }

  const scopeConfig = SCOPES[scopeName];
  const category = categorizeFinding(rootName, rootRelativePath);
  return Boolean(category) && scopeConfig.categories.includes(category);
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exit(1);
  }

  const allFindings = [];
  const rootsScanned = [];
  const missingRoots = [];
  const rootStats = {};

  for (const root of ROOT_DEFINITIONS) {
    const result = scanRoot(root.name, root.directory, options.scope);
    rootsScanned.push(root.name);
    if (result.missing) {
      missingRoots.push(root.name);
      rootStats[root.name] = { filesScanned: 0, findings: 0, missing: true };
      continue;
    }

    allFindings.push(...result.findings);
    rootStats[root.name] = {
      filesScanned: result.filesScanned,
      findings: result.findings.length,
      missing: false,
    };
  }

  allFindings.sort((a, b) => {
    if (a.category < b.category) return -1;
    if (a.category > b.category) return 1;
    if (a.root < b.root) return -1;
    if (a.root > b.root) return 1;
    if (a.file < b.file) return -1;
    if (a.file > b.file) return 1;
    if (a.line !== b.line) return a.line - b.line;
    if (a.token < b.token) return -1;
    if (a.token > b.token) return 1;
    return a.signature.localeCompare(b.signature);
  });

  const scopeConfig = SCOPES[options.scope];
  const scopeFindings = filterFindingsForScope(scopeConfig, allFindings);
  const filesScanned = Object.values(rootStats).reduce((sum, item) => sum + item.filesScanned, 0);
  const totals = buildMatrix(rootsScanned, scopeFindings);
  const hasScopedFindings = scopeFindings.length > 0;
  const shouldFail = scopeConfig.failOnFindings && hasScopedFindings;
  const payload = {
    scope: options.scope,
    scopeCategories: scopeConfig.categories,
    workspaceRoot: toPosixPath(WORKSPACE_ROOT),
    rootsScanned,
    missingRoots,
    summary: {
      findings: scopeFindings.length,
      filesScanned,
      categories: totals.byCategory,
      roots: totals.byRoot,
      matrix: totals.matrix,
      rootStats,
    },
    findings: scopeFindings,
  };

  if (options.format === 'json') {
    const outPath = path.isAbsolute(options.out)
      ? options.out
      : path.join(PROJECT_ROOT, options.out);
    const outDir = path.dirname(outPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  const statusLabel = shouldFail ? 'FAIL' : 'PASS';
  if (scopeConfig.failOnFindings) {
    const gateOutcome = shouldFail ? 'found' : 'no';
    console.log(`${statusLabel}: ${gateOutcome} scoped UI signature finding(s) for scope '${options.scope}' (${scopeFindings.length}) across ${filesScanned} text file(s).`);
  } else {
    console.log(`${statusLabel}: inventory completed for scope '${options.scope}' with ${scopeFindings.length} finding(s) across ${filesScanned} text file(s).`);
  }
  if (missingRoots.length > 0) {
    console.log(`INFO: skipped missing root(s): ${missingRoots.join(', ')}`);
  }
  console.log('INFO: category totals');
  for (const category of CATEGORIES) {
    console.log(`  ${category}: ${totals.byCategory[category]}`);
  }
  console.log('INFO: root totals');
  for (const rootName of rootsScanned) {
    console.log(`  ${rootName}: ${totals.byRoot[rootName]}`);
  }

  process.exit(shouldFail ? 1 : 0);
}

main();
