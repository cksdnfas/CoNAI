#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FRONTEND_SRC = path.join(PROJECT_ROOT, 'frontend', 'src');

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function collectSourceFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
      continue;
    }

    if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      files.push(entryPath);
    }
  }

  return files;
}

function collectMatches(files, regex) {
  const findings = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      if (!regex.test(lines[index])) {
        continue;
      }

      findings.push(`${toPosixPath(path.relative(PROJECT_ROOT, filePath))}:${index + 1}`);
    }
  }

  return findings.sort();
}

function main() {
  if (!fs.existsSync(FRONTEND_SRC)) {
    console.error(`FAIL: frontend source directory not found: ${FRONTEND_SRC}`);
    process.exit(1);
  }

  const files = collectSourceFiles(FRONTEND_SRC);
  const bannedPreviewHelperFindings = collectMatches(files, /\b(function|get|const)\s+getPreviewMediaUrl\b/);
  const resolverExportFindings = collectMatches(files, /export\s+function\s+buildPreviewMediaUrl\s*\(/);
  const metaFactoryExportFindings = collectMatches(files, /export\s+function\s+createImageViewCardMeta\s*\(/);

  const expectedResolverPrefix = 'frontend/src/features/images/components/image-preview-url.ts:';
  const expectedMetaFactoryPrefix = 'frontend/src/features/image-groups/components/image-view-card-meta.tsx:';

  const failures = [];
  if (bannedPreviewHelperFindings.length > 0) {
    failures.push(
      `Found banned legacy helper definition(s):\n${bannedPreviewHelperFindings.map((item) => `  - ${item}`).join('\n')}`,
    );
  }

  if (resolverExportFindings.length !== 1 || !resolverExportFindings[0].startsWith(expectedResolverPrefix)) {
    failures.push(
      `Expected exactly one buildPreviewMediaUrl export under ${expectedResolverPrefix}, got:\n${resolverExportFindings.map((item) => `  - ${item}`).join('\n') || '  - <none>'}`,
    );
  }

  if (metaFactoryExportFindings.length !== 1 || !metaFactoryExportFindings[0].startsWith(expectedMetaFactoryPrefix)) {
    failures.push(
      `Expected exactly one createImageViewCardMeta export under ${expectedMetaFactoryPrefix}, got:\n${metaFactoryExportFindings.map((item) => `  - ${item}`).join('\n') || '  - <none>'}`,
    );
  }

  if (failures.length > 0) {
    console.log('FAIL: image render guardrails check failed.');
    for (const failure of failures) {
      console.log(failure);
    }
    process.exit(1);
  }

  console.log('PASS: image render guardrails check passed.');
  console.log(`INFO: scanned ${files.length} source files.`);
  console.log(`INFO: buildPreviewMediaUrl export -> ${resolverExportFindings[0]}`);
  console.log(`INFO: createImageViewCardMeta export -> ${metaFactoryExportFindings[0]}`);
  process.exit(0);
}

main();
