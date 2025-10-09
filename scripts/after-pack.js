const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const copyFile = promisify(fs.copyFile);
const mkdir = promisify(fs.mkdir);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

/**
 * Recursively copy directory
 */
async function copyDir(src, dest, filter) {
  await mkdir(dest, { recursive: true });

  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (!filter(srcPath, entry)) continue;

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, filter);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

/**
 * electron-builder afterPack hook
 * Copies backend folder with node_modules to app resources
 */
module.exports = async function(context) {
  const { appOutDir, electronPlatformName } = context;

  console.log('📦 [afterPack] Copying backend to resources...');
  console.log(`   Platform: ${electronPlatformName}`);
  console.log(`   Output: ${appOutDir}`);

  // Determine resources path based on platform
  let resourcesPath;
  if (electronPlatformName === 'darwin') {
    resourcesPath = path.join(appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources');
  } else {
    resourcesPath = path.join(appOutDir, 'resources');
  }

  const backendSrc = path.join(context.packager.projectDir, 'backend');
  const backendDest = path.join(resourcesPath, 'backend');

  console.log(`   Source: ${backendSrc}`);
  console.log(`   Destination: ${backendDest}`);

  try {
    // Copy backend folder first
    console.log('   Copying backend files...');
    await copyDir(backendSrc, backendDest, (srcPath, entry) => {
      const relativePath = path.relative(backendSrc, srcPath);

      // Exclude source files and node_modules (will install fresh)
      if (relativePath.startsWith('src')) return false;
      if (relativePath.startsWith('node_modules')) return false;

      return true;
    });

    // Copy frontend dist so HTTP server can serve static files in production
    const frontendSrc = path.join(context.packager.projectDir, 'frontend', 'dist');
    const frontendDest = path.join(resourcesPath, 'frontend', 'dist');

    if (fs.existsSync(frontendSrc)) {
      console.log('   Copying frontend dist from', frontendSrc, 'to', frontendDest);
      await copyDir(frontendSrc, frontendDest, () => true);
      console.log('   ✅ Frontend dist copied');
    } else {
      console.warn('   ⚠️ Frontend dist not found at:', frontendSrc);
    }

    // Install production dependencies in destination
    console.log('   Installing production dependencies...');
    const { execSync } = require('child_process');
    execSync('npm install --omit=dev --ignore-scripts', {
      cwd: backendDest,
      stdio: 'inherit'
    });

    // Rebuild native modules for Electron
    console.log('   Rebuilding native modules for Electron...');
    const electronVersion = context.packager.config.electronVersion;
    execSync(`npx electron-rebuild -v ${electronVersion} -m ${backendDest}`, {
      cwd: context.packager.projectDir,
      stdio: 'inherit'
    });

    // Copy sqlite3 binary to expected location
    console.log('   Copying sqlite3 binary to runtime location...');
    const sqlite3Source = path.join(backendDest, 'node_modules', 'sqlite3', 'build', 'Release', 'node_sqlite3.node');
    const sqlite3Dest = path.join(backendDest, 'node_modules', 'sqlite3', 'lib', 'binding', 'node-v127-win32-x64', 'node_sqlite3.node');

    if (fs.existsSync(sqlite3Source)) {
      await mkdir(path.dirname(sqlite3Dest), { recursive: true });
      await copyFile(sqlite3Source, sqlite3Dest);
      console.log('   ✅ sqlite3 binary copied');
    } else {
      console.warn('   ⚠️ sqlite3 binary not found at:', sqlite3Source);
    }

    console.log('✅ [afterPack] Backend prepared successfully');

    // Verify critical files
    const checks = [
      { path: path.join(backendDest, 'dist', 'index.js'), name: 'dist/index.js' },
      { path: path.join(backendDest, 'node_modules'), name: 'node_modules' },
      { path: path.join(backendDest, 'package.json'), name: 'package.json' }
    ];

    for (const check of checks) {
      const exists = fs.existsSync(check.path);
      console.log(`   ${exists ? '✅' : '❌'} ${check.name}`);
      if (!exists) {
        throw new Error(`Missing required file/folder: ${check.name}`);
      }
    }

  } catch (error) {
    console.error('❌ [afterPack] Failed to copy backend:', error);
    throw error;
  }
};
