#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(PROJECT_ROOT, '..');
const DEFAULT_POLICY_PATH = path.join(WORKSPACE_ROOT, '.sisyphus', 'evidence', 'repository-audit-policy.json');

function usage() {
  const scriptName = path.relative(PROJECT_ROOT, __filename).split(path.sep).join('/');
  return `Usage: node ${scriptName} --category=<name> [--policy=<path>]\n\n` +
    'Checks repository audit policy category wiring for deterministic CI gates.';
}

function parseArgs(argv) {
  const categoryArg = argv.find((arg) => arg.startsWith('--category='));
  const policyArg = argv.find((arg) => arg.startsWith('--policy='));
  const category = categoryArg ? categoryArg.split('=', 2)[1].trim() : '';
  const policyPathArg = policyArg ? policyArg.split('=', 2)[1].trim() : '';

  if (!category) {
    throw new Error(`FAIL: missing required --category argument.\n\n${usage()}`);
  }

  return {
    category,
    policyPath: policyPathArg
      ? (path.isAbsolute(policyPathArg) ? policyPathArg : path.join(PROJECT_ROOT, policyPathArg))
      : DEFAULT_POLICY_PATH,
  };
}

function loadPolicy(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`FAIL: policy file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`FAIL: unable to parse policy json at ${filePath}: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || !parsed.categories || typeof parsed.categories !== 'object') {
    throw new Error(`FAIL: invalid policy shape in ${filePath}; expected object with categories map.`);
  }

  return parsed;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  let policy;
  try {
    policy = loadPolicy(options.policyPath);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const categoryAction = policy.categories[options.category];
  if (!categoryAction) {
    const known = Object.keys(policy.categories).sort().join(', ');
    console.error(`FAIL: unknown category '${options.category}'. Known categories: ${known}`);
    process.exit(1);
  }

  const policyPathDisplay = path.relative(WORKSPACE_ROOT, options.policyPath).split(path.sep).join('/');
  console.log(`PASS: policy category '${options.category}' resolved as '${categoryAction}' from ${policyPathDisplay}.`);
  process.exit(0);
}

main();
