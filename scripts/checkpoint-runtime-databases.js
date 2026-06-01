#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT_DIR = path.resolve(__dirname, '..');

function parseDotEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const values = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*(?:#.*)?$/);
    if (!match) {
      continue;
    }

    const rawValue = match[2].trim();
    values[match[1]] = rawValue.replace(/^["']|["']$/g, '');
  }

  return values;
}

function resolveRuntimePath(value, fallback) {
  if (!value) {
    return fallback;
  }

  return path.resolve(ROOT_DIR, value);
}

function getRuntimeDatabaseDir() {
  const envFile = parseDotEnv();
  const basePath = resolveRuntimePath(
    process.env.RUNTIME_BASE_PATH || envFile.RUNTIME_BASE_PATH,
    path.join(ROOT_DIR, 'user'),
  );

  return resolveRuntimePath(
    process.env.RUNTIME_DATABASE_DIR || envFile.RUNTIME_DATABASE_DIR,
    path.join(basePath, 'database'),
  );
}

function checkpointDatabase(dbPath) {
  if (!fs.existsSync(dbPath)) {
    return;
  }

  const db = new Database(dbPath);
  try {
    db.pragma('busy_timeout = 60000');
    const result = db.pragma('wal_checkpoint(TRUNCATE)');
    console.log(`Checkpointed ${path.basename(dbPath)}: ${JSON.stringify(result)}`);
  } finally {
    db.close();
  }
}

function main() {
  const databaseDir = getRuntimeDatabaseDir();
  const databaseNames = ['images.db', 'user.db', 'auth.db'];

  console.log(`Checkpointing runtime databases in ${databaseDir}`);
  for (const name of databaseNames) {
    checkpointDatabase(path.join(databaseDir, name));
  }
}

main();
