/**
 * Load the root .env and the packaged native-module path. `index.ts` imports this module FIRST: imports are evaluated
 * before the importing file's own statements (tsx follows ESM order), so env loading written inline in `index.ts`
 * would run only after runtimePaths and the databases had already read `process.env`.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { resolveEnvExamplePath, resolveEnvPath, isPackagedRuntime } from '../utils/envPath';

/** The folder of the entry module (`src/` or `dist/backend/src/`), which the env and native-module lookups start from. */
const entryDir = path.resolve(__dirname, '..');

function ensureEnvFileExists(envPath: string): void {
  const envExamplePath = resolveEnvExamplePath(envPath, entryDir);

  if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
    console.log(`[Config] Created .env from ${path.basename(envExamplePath)} at: ${envPath}`);
  }
}

const rootEnvPath = resolveEnvPath(entryDir);
ensureEnvFileExists(rootEnvPath);
dotenv.config({ path: rootEnvPath, quiet: true });
console.log(`[Config] Loaded environment from: ${rootEnvPath}`);

const normalizedNodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
export const isDevelopmentEnvironment = normalizedNodeEnv === 'development';
const isProductionEnvironment = !isDevelopmentEnvironment;

// Configure NODE_PATH for native modules in SEA (Single Executable Application)
// This must be done before any imports that depend on native modules
if (isProductionEnvironment || isPackagedRuntime()) {
  const nativeModulesPath = path.join(entryDir, '..', 'node_modules');
  if (fs.existsSync(nativeModulesPath)) {
    process.env.NODE_PATH = nativeModulesPath;
    require('module').Module._initPaths();
  }
}
