#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');
const BACKEND_ENTRY = path.join(BACKEND_DIR, 'dist', 'backend', 'src', 'index.js');
const FRONTEND_INDEX = path.join(BACKEND_DIR, 'dist', 'frontend', 'index.html');

const cliArgs = process.argv.slice(2);
const args = new Set(cliArgs);
const isCheckOnly = args.has('--check');
const isBuildOnly = args.has('--build-only');
const isSkipBuild = args.has('--skip-build');

function parseRuntimeRole() {
  if (args.has('--api')) {
    return 'api';
  }

  if (args.has('--worker')) {
    return 'worker';
  }

  if (args.has('--all')) {
    return 'all';
  }

  const roleArg = cliArgs.find((arg) => arg.startsWith('--runtime-role='));
  if (!roleArg) {
    return null;
  }

  const role = roleArg.slice('--runtime-role='.length).trim().toLowerCase();
  if (role === 'api' || role === 'worker' || role === 'all') {
    return role;
  }

  console.error(`Invalid runtime role: ${role || '(empty)'}`);
  console.error('Use --api, --worker, --all, or --runtime-role=api|worker|all.');
  process.exit(1);
}

const runtimeRole = parseRuntimeRole();

const SOURCE_TARGETS = [
  path.join(ROOT_DIR, 'package.json'),
  path.join(ROOT_DIR, 'package-lock.json'),
  path.join(ROOT_DIR, 'scripts', 'build-integrated.js'),
  path.join(ROOT_DIR, 'frontend', 'package.json'),
  path.join(ROOT_DIR, 'frontend', 'index.html'),
  path.join(ROOT_DIR, 'frontend', 'src'),
  path.join(ROOT_DIR, 'backend', 'package.json'),
  path.join(ROOT_DIR, 'backend', 'src'),
  path.join(ROOT_DIR, 'shared', 'package.json'),
  path.join(ROOT_DIR, 'shared', 'src'),
];

const OUTPUT_TARGETS = [BACKEND_ENTRY, FRONTEND_INDEX];

function exists(targetPath) {
  return fs.existsSync(targetPath);
}

function listChildrenSafe(targetPath) {
  try {
    return fs.readdirSync(targetPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function getLatestModifiedMs(targetPath) {
  if (!exists(targetPath)) {
    return 0;
  }

  const stats = fs.statSync(targetPath);
  if (stats.isFile()) {
    return stats.mtimeMs;
  }

  let latest = stats.mtimeMs;
  for (const entry of listChildrenSafe(targetPath)) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git' || entry.name === 'build-output') {
      continue;
    }

    const childPath = path.join(targetPath, entry.name);
    latest = Math.max(latest, getLatestModifiedMs(childPath));
  }

  return latest;
}

function getOldestModifiedMs(paths) {
  let oldest = Number.POSITIVE_INFINITY;

  for (const targetPath of paths) {
    if (!exists(targetPath)) {
      return 0;
    }

    oldest = Math.min(oldest, fs.statSync(targetPath).mtimeMs);
  }

  return Number.isFinite(oldest) ? oldest : 0;
}

function formatLocalTime(timestamp) {
  if (!timestamp) {
    return 'missing';
  }

  return new Date(timestamp).toLocaleString('ko-KR', { hour12: false });
}

function isBuildStale() {
  const missingOutputs = OUTPUT_TARGETS.filter((targetPath) => !exists(targetPath));
  if (missingOutputs.length > 0) {
    return {
      stale: true,
      reason: `missing output: ${missingOutputs.map((item) => path.relative(ROOT_DIR, item)).join(', ')}`,
      latestSourceMs: Math.max(...SOURCE_TARGETS.map(getLatestModifiedMs)),
      oldestOutputMs: 0,
    };
  }

  const latestSourceMs = Math.max(...SOURCE_TARGETS.map(getLatestModifiedMs));
  const oldestOutputMs = getOldestModifiedMs(OUTPUT_TARGETS);

  if (latestSourceMs > oldestOutputMs) {
    return {
      stale: true,
      reason: 'source files are newer than integrated build output',
      latestSourceMs,
      oldestOutputMs,
    };
  }

  return {
    stale: false,
    reason: 'integrated build is up to date',
    latestSourceMs,
    oldestOutputMs,
  };
}

function runCommand(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? ROOT_DIR,
    stdio: 'inherit',
    shell: options.shell ?? (process.platform === 'win32'),
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
  });

  if (typeof result.status === 'number') {
    return result.status;
  }

  return 1;
}

function main() {
  const status = isBuildStale();

  console.log('');
  console.log('=== CoNAI Build And Run ===');
  console.log(`Build status : ${status.stale ? 'stale' : 'fresh'}`);
  console.log(`Reason       : ${status.reason}`);
  console.log(`Latest source: ${formatLocalTime(status.latestSourceMs)}`);
  console.log(`Build output : ${formatLocalTime(status.oldestOutputMs)}`);
  console.log(`Runtime role : ${runtimeRole ?? process.env.CONAI_RUNTIME_ROLE ?? process.env.CONAI_SIDE_EFFECT_ROLE ?? 'all'}`);
  console.log(`Build mode   : ${isSkipBuild ? 'skip requested' : 'auto'}`);
  console.log('');

  if (isCheckOnly) {
    process.exit(0);
  }

  if (status.stale && isSkipBuild) {
    console.error('Build output is stale, but --skip-build was used.');
    console.error('Run without --skip-build or use RUN_CoNAI.bat to prepare the build once.');
    process.exit(1);
  }

  if (status.stale) {
    console.log('Running production build...');
    const buildExitCode = runCommand('npm', ['run', 'build:integrated'], { cwd: ROOT_DIR });
    if (buildExitCode !== 0) {
      process.exit(buildExitCode);
    }
    console.log('Production build completed.');
    console.log('');
  } else {
    console.log('Skipping build, current integrated output is already up to date.');
    console.log('');
  }

  if (isBuildOnly) {
    process.exit(0);
  }

  console.log('Starting built backend with bundled frontend...');
  if (runtimeRole === 'worker') {
    console.log('Mode: worker-only runtime, HTTP disabled by default');
  } else {
    console.log('Open: configured PORT from .env (default http://localhost:1666)');
  }
  console.log('');

  const runtimeEnv = {};
  if (runtimeRole) {
    runtimeEnv.CONAI_RUNTIME_ROLE = runtimeRole;
  }

  if (runtimeRole === 'worker' && process.env.CONAI_WORKER_HTTP === undefined) {
    runtimeEnv.CONAI_WORKER_HTTP = 'false';
  }

  const startExitCode = runCommand(process.execPath, [BACKEND_ENTRY], {
    cwd: BACKEND_DIR,
    shell: false,
    env: {
      NODE_ENV: 'production',
      ...runtimeEnv,
    },
  });

  process.exit(startExitCode);
}

main();
