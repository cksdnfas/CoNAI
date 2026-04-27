#!/usr/bin/env node

/**
 * Restore workspace dependencies when package manifests changed after a pull.
 * This script intentionally uses only Node built-ins so it can run before npm install.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const WORKSPACE_DIRS = [
  ROOT_DIR,
  path.join(ROOT_DIR, 'shared'),
  path.join(ROOT_DIR, 'frontend'),
  path.join(ROOT_DIR, 'backend'),
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getManifestPaths() {
  return [
    path.join(ROOT_DIR, 'package-lock.json'),
    ...WORKSPACE_DIRS.map((workspaceDir) => path.join(workspaceDir, 'package.json')),
  ].filter((filePath) => fs.existsSync(filePath));
}

function isManifestNewerThanInstalledState() {
  const installedLockPath = path.join(ROOT_DIR, 'node_modules', '.package-lock.json');
  if (!fs.existsSync(installedLockPath)) {
    return true;
  }

  const installedLockMtime = fs.statSync(installedLockPath).mtimeMs;
  return getManifestPaths().some((manifestPath) => fs.statSync(manifestPath).mtimeMs > installedLockMtime);
}

function getDirectDependencyNames(packageJsonPath) {
  const packageJson = readJson(packageJsonPath);
  return new Set([
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.devDependencies || {}),
    ...Object.keys(packageJson.optionalDependencies || {}),
  ]);
}

function getNodeModulesPackagePath(baseDir, packageName) {
  const packageParts = packageName.split('/');
  let currentDir = baseDir;

  while (currentDir.startsWith(ROOT_DIR)) {
    const packagePath = path.join(currentDir, 'node_modules', ...packageParts);
    if (fs.existsSync(packagePath)) {
      return packagePath;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return null;
}

function findMissingDirectDependencies() {
  const missing = [];

  for (const workspaceDir of WORKSPACE_DIRS) {
    const packageJsonPath = path.join(workspaceDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      continue;
    }

    for (const dependencyName of getDirectDependencyNames(packageJsonPath)) {
      if (!getNodeModulesPackagePath(workspaceDir, dependencyName)) {
        missing.push(`${dependencyName} (${path.relative(ROOT_DIR, workspaceDir) || 'root'})`);
      }
    }
  }

  return missing;
}

function ensureWorkspaceDependencies() {
  const reasons = [];

  if (isManifestNewerThanInstalledState()) {
    reasons.push('package manifests are newer than node_modules');
  }

  const missingDependencies = findMissingDirectDependencies();
  if (missingDependencies.length > 0) {
    reasons.push(`missing direct dependencies: ${missingDependencies.join(', ')}`);
  }

  if (reasons.length === 0) {
    return false;
  }

  console.log('📥 Workspace dependencies need synchronization:');
  for (const reason of reasons) {
    console.log(`   - ${reason}`);
  }
  console.log('📦 Running npm install at the repository root...\n');

  execSync('npm install', {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  });

  console.log('\n✅ Workspace dependencies synchronized\n');
  return true;
}

if (require.main === module) {
  try {
    ensureWorkspaceDependencies();
  } catch (error) {
    console.error('❌ Workspace dependency synchronization failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

module.exports = {
  ensureWorkspaceDependencies,
};
