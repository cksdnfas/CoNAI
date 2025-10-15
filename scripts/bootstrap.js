#!/usr/bin/env node

/**
 * ComfyUI Image Manager - Bootstrap Script
 * Automatically installs missing dependencies for portable distribution
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const APP_DIR = path.join(__dirname, '..', 'app');
const NODE_MODULES = path.join(APP_DIR, 'node_modules');
const PACKAGE_JSON = path.join(APP_DIR, 'package.json');

// Required native modules
const REQUIRED_MODULES = ['sharp', 'better-sqlite3'];

console.log('');
console.log('========================================================================');
console.log('  ComfyUI Image Manager - First Run Setup');
console.log('========================================================================');
console.log('');

/**
 * Check if a module is installed and working
 */
function isModuleInstalled(moduleName) {
  const modulePath = path.join(NODE_MODULES, moduleName);

  if (!fs.existsSync(modulePath)) {
    return false;
  }

  // Check if module can be required
  try {
    require(modulePath);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Check if npm is available
 */
function isNpmAvailable() {
  try {
    execSync('npm --version', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Install dependencies using npm
 */
function installDependencies() {
  console.log('Installing missing dependencies...');
  console.log('This may take a few minutes on first run.\n');

  try {
    // Create minimal package.json if it doesn't exist
    if (!fs.existsSync(PACKAGE_JSON)) {
      const packageJson = {
        name: "comfyui-image-manager-portable",
        version: "1.0.0",
        private: true,
        dependencies: {
          "sharp": "^0.33.0",
          "better-sqlite3": "^9.4.0"
        }
      };
      fs.writeFileSync(PACKAGE_JSON, JSON.stringify(packageJson, null, 2));
      console.log('✓ Created package.json');
    }

    // Install dependencies
    process.chdir(APP_DIR);
    console.log('Running: npm install --production --no-save');
    console.log('');

    execSync('npm install --production --no-save', {
      stdio: 'inherit',
      cwd: APP_DIR
    });

    console.log('');
    console.log('✓ Dependencies installed successfully!');
    console.log('');
    return true;
  } catch (error) {
    console.error('✗ Failed to install dependencies:', error.message);
    console.error('');
    return false;
  }
}

/**
 * Main bootstrap logic
 */
function bootstrap() {
  // Check if app directory exists
  if (!fs.existsSync(APP_DIR)) {
    console.error('✗ Error: app directory not found!');
    console.error('  Please make sure you extracted the entire package.');
    console.error('');
    process.exit(1);
  }

  // Ensure node_modules directory exists
  if (!fs.existsSync(NODE_MODULES)) {
    fs.mkdirSync(NODE_MODULES, { recursive: true });
  }

  // Check each required module
  const missingModules = [];
  for (const moduleName of REQUIRED_MODULES) {
    if (!isModuleInstalled(moduleName)) {
      missingModules.push(moduleName);
    }
  }

  // If all modules are installed, we're done
  if (missingModules.length === 0) {
    console.log('✓ All dependencies are installed and ready!');
    console.log('');
    return true;
  }

  // Some modules are missing
  console.log('Missing dependencies detected:');
  missingModules.forEach(mod => console.log(`  - ${mod}`));
  console.log('');

  // Check if npm is available
  if (!isNpmAvailable()) {
    console.error('✗ Error: npm is not available');
    console.error('');
    console.error('  This portable version requires npm to download dependencies.');
    console.error('  Please install Node.js from: https://nodejs.org/');
    console.error('');
    console.error('  Alternatively, download the full portable package with');
    console.error('  dependencies included from the releases page.');
    console.error('');
    process.exit(1);
  }

  // Install dependencies
  const success = installDependencies();

  if (!success) {
    console.error('========================================================================');
    console.error('  Installation Failed');
    console.error('========================================================================');
    console.error('');
    console.error('Please try the following:');
    console.error('  1. Ensure you have internet connection');
    console.error('  2. Try running: npm install --production');
    console.error('  3. Check if your firewall is blocking npm');
    console.error('');
    process.exit(1);
  }

  console.log('========================================================================');
  console.log('  Setup Complete!');
  console.log('========================================================================');
  console.log('');
  console.log('Starting server...');
  console.log('');

  return true;
}

// Run bootstrap
try {
  bootstrap();
} catch (error) {
  console.error('');
  console.error('========================================================================');
  console.error('  Bootstrap Error');
  console.error('========================================================================');
  console.error('');
  console.error(error.message);
  console.error('');
  process.exit(1);
}
