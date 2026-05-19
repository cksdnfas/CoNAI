#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const WORKSPACES = [
  { dir: 'backend', packageName: 'conai-backend' },
  { dir: 'frontend', packageName: 'frontend' },
];

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function loadPackageJson(packagePath) {
  const displayPath = toPosix(path.relative(PROJECT_ROOT, packagePath));
  if (!fs.existsSync(packagePath)) {
    throw new Error(`missing package manifest: ${displayPath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  } catch (error) {
    throw new Error(`unable to parse ${displayPath}: ${error.message}`);
  }
}

function normalizeCommand(command) {
  return String(command).replace(/\s+/g, ' ').trim();
}

function collectWorkspaceReferences(rootScripts, workspacesByName, workspacesByDir) {
  const references = [];
  const cdRunPattern = /(?:^|&&)\s*cd\s+(backend|frontend)\s+&&\s*npm\s+run\s+([^\s&]+)/g;
  const workspaceRunPattern = /(?:^|&&)\s*npm\s+run\s+([^\s&]+)\s+--workspace(?:=|\s+)([^\s&]+)/g;

  for (const [rootScriptName, command] of Object.entries(rootScripts)) {
    if (!rootScriptName.startsWith('verify:')) {
      continue;
    }

    const normalizedCommand = normalizeCommand(command);
    for (const match of normalizedCommand.matchAll(cdRunPattern)) {
      references.push({
        rootScriptName,
        workspace: workspacesByDir.get(match[1]),
        workspaceScriptName: match[2],
      });
    }

    for (const match of normalizedCommand.matchAll(workspaceRunPattern)) {
      references.push({
        rootScriptName,
        workspace: workspacesByName.get(match[2]),
        workspaceScriptName: match[1],
      });
    }
  }

  return references;
}

function rootScriptCoversWorkspace(rootScripts, workspace, scriptName) {
  const command = rootScripts[scriptName];
  if (!command) {
    return false;
  }

  const normalizedCommand = normalizeCommand(command);
  const cdInvocation = `cd ${workspace.dir} && npm run ${scriptName}`;
  const workspaceInvocation = `npm run ${scriptName} --workspace ${workspace.packageName}`;
  const workspaceEqualsInvocation = `npm run ${scriptName} --workspace=${workspace.packageName}`;

  return normalizedCommand.includes(cdInvocation) ||
    normalizedCommand.includes(workspaceInvocation) ||
    normalizedCommand.includes(workspaceEqualsInvocation);
}

function collectScriptFileTargets(workspace, scripts) {
  const targets = [];
  const tsxRunPattern = /(?:^|&&)\s*tsx\s+([^\s&]+)/g;

  for (const [scriptName, command] of Object.entries(scripts)) {
    if (!scriptName.startsWith('verify:')) {
      continue;
    }

    const normalizedCommand = normalizeCommand(command);
    for (const match of normalizedCommand.matchAll(tsxRunPattern)) {
      targets.push({
        scriptName,
        displayPath: `${workspace.dir}/${match[1]}`,
        filePath: path.join(PROJECT_ROOT, workspace.dir, match[1]),
      });
    }
  }

  return targets;
}

function main() {
  const failures = [];
  const rootManifest = loadPackageJson(path.join(PROJECT_ROOT, 'package.json'));
  const rootScripts = rootManifest.scripts ?? {};
  const workspacesByName = new Map(WORKSPACES.map((workspace) => [workspace.packageName, workspace]));
  const workspacesByDir = new Map(WORKSPACES.map((workspace) => [workspace.dir, workspace]));
  const rootReferences = collectWorkspaceReferences(rootScripts, workspacesByName, workspacesByDir);

  let workspaceVerifyScriptCount = 0;
  let scriptFileTargetCount = 0;

  for (const workspace of WORKSPACES) {
    const manifest = loadPackageJson(path.join(PROJECT_ROOT, workspace.dir, 'package.json'));
    const scripts = manifest.scripts ?? {};
    const verifyScripts = Object.keys(scripts).filter((scriptName) => scriptName.startsWith('verify:'));
    workspaceVerifyScriptCount += verifyScripts.length;

    for (const scriptName of verifyScripts) {
      if (!rootScriptCoversWorkspace(rootScripts, workspace, scriptName)) {
        failures.push(`missing root alias for ${workspace.dir}:${scriptName}`);
      }
    }

    for (const target of collectScriptFileTargets(workspace, scripts)) {
      scriptFileTargetCount += 1;
      if (!fs.existsSync(target.filePath)) {
        failures.push(`missing script file for ${workspace.dir}:${target.scriptName}: ${target.displayPath}`);
      }
    }
  }

  for (const reference of rootReferences) {
    if (!reference.workspace) {
      failures.push(`unknown workspace in root alias ${reference.rootScriptName}`);
      continue;
    }

    const manifest = loadPackageJson(path.join(PROJECT_ROOT, reference.workspace.dir, 'package.json'));
    const scripts = manifest.scripts ?? {};
    if (!scripts[reference.workspaceScriptName]) {
      failures.push(
        `root alias ${reference.rootScriptName} references missing ${reference.workspace.dir}:${reference.workspaceScriptName}`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(`FAIL: workspace verification aliases drifted (${failures.length}).`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(
    `PASS: ${workspaceVerifyScriptCount} workspace verify scripts, ${rootReferences.length} root references, and ${scriptFileTargetCount} script file targets are aligned.`,
  );
}

main();
