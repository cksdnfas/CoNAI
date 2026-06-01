#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const NORMALIZED_ROOT_DIR = normalizePathText(ROOT_DIR);
const CURRENT_PID = process.pid;
const isDryRun = process.argv.includes('--dry-run');

function normalizePathText(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase();
}

function parseDotEnvPort() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) {
    return null;
  }

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*PORT\s*=\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/);
    if (!match) {
      continue;
    }

    const port = Number(match[1]);
    if (Number.isInteger(port) && port > 0 && port < 65536) {
      return port;
    }
  }

  return null;
}

function parseJsonOutput(output) {
  const text = String(output || '').trim();
  if (!text) {
    return [];
  }

  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function powershellJson(script) {
  try {
    return parseJsonOutput(execFileSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ], { encoding: 'utf8', windowsHide: true }));
  } catch {
    return [];
  }
}

function getNodeProcesses() {
  return powershellJson(`
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
      Select-Object ProcessId, ParentProcessId, CommandLine |
      ConvertTo-Json -Compress
  `);
}

function getListeningPortOwners(port) {
  if (!port) {
    return [];
  }

  const rows = powershellJson(`
    Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue |
      Select-Object OwningProcess |
      ConvertTo-Json -Compress
  `);

  return rows
    .map((row) => Number(row.OwningProcess ?? row))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function isCoNaiRuntimeProcess(commandLine) {
  const command = normalizePathText(commandLine);
  const hasRunner = command.includes('scripts/run-built-if-needed.js');
  const isFromCurrentRoot = command.includes(NORMALIZED_ROOT_DIR);
  const hasRoleArg = command.includes('--api')
    || command.includes('--worker')
    || command.includes('--all')
    || command.includes('--runtime-role=');
  const isLegacyAllRunner = hasRunner && !hasRoleArg;

  return hasRunner && isFromCurrentRoot && (hasRoleArg || isLegacyAllRunner);
}

function collectRuntimePids() {
  const pids = new Set();

  for (const processInfo of getNodeProcesses()) {
    const pid = Number(processInfo.ProcessId);
    if (!Number.isInteger(pid) || pid <= 0 || pid === CURRENT_PID) {
      continue;
    }

    if (isCoNaiRuntimeProcess(processInfo.CommandLine)) {
      pids.add(pid);
    }
  }

  const configuredPort = parseDotEnvPort();
  for (const pid of getListeningPortOwners(configuredPort)) {
    if (pid !== CURRENT_PID) {
      pids.add(pid);
    }
  }

  return [...pids].sort((a, b) => a - b);
}

function stopProcessTree(pid) {
  if (isDryRun) {
    console.log(`[dry-run] taskkill /PID ${pid} /T /F`);
    return 0;
  }

  const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    stdio: 'inherit',
    windowsHide: true,
  });

  return typeof result.status === 'number' ? result.status : 1;
}

function main() {
  const pids = collectRuntimePids();
  if (pids.length === 0) {
    console.log('No existing CoNAI runtime processes found.');
    return;
  }

  console.log(`Stopping existing CoNAI runtime process tree(s): ${pids.join(', ')}`);
  for (const pid of pids) {
    stopProcessTree(pid);
  }
}

main();
