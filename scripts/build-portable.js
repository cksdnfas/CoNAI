#!/usr/bin/env node

/**
 * ComfyUI Image Manager - Portable Build Script
 * Creates a portable package with Node.js runtime
 */

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const https = require('https');

const ROOT_DIR = path.resolve(__dirname, '..');
const BACKEND_DIST = path.join(ROOT_DIR, 'backend', 'dist');
const BUNDLE_FILE = path.join(BACKEND_DIST, 'bundle.js');
const PORTABLE_OUTPUT_DIR = path.join(ROOT_DIR, 'portable-output');

const platform = os.platform();
const arch = os.arch();
const isWindows = platform === 'win32';

// Node.js version to download
const NODE_VERSION = process.version; // Use current Node.js version
const NODE_MAJOR = NODE_VERSION.split('.')[0];

console.log('🚀 ComfyUI Image Manager - Portable Build\n');
console.log(`📋 Platform: ${platform} ${arch}`);
console.log(`📦 Node.js: ${NODE_VERSION}\n`);

// Step 1: Check prerequisites
console.log('Step 1: Checking prerequisites...');
if (!fs.existsSync(BUNDLE_FILE)) {
  console.error('❌ Bundle not found. Run "npm run build:bundle" first.');
  process.exit(1);
}
console.log('✅ Prerequisites OK\n');

// Step 2: Clean and create output directory
console.log('Step 2: Preparing output directory...');
if (fs.existsSync(PORTABLE_OUTPUT_DIR)) {
  fs.removeSync(PORTABLE_OUTPUT_DIR);
}
fs.ensureDirSync(PORTABLE_OUTPUT_DIR);
console.log('✅ Output directory ready\n');

// Step 3: Download Node.js portable
console.log('Step 3: Preparing Node.js runtime...');

const nodeExecutableName = isWindows ? 'node.exe' : 'node';
const targetNodePath = path.join(PORTABLE_OUTPUT_DIR, nodeExecutableName);

// Option 1: Copy current Node.js executable (simpler and faster)
console.log('   Using current Node.js runtime...');
try {
  fs.copyFileSync(process.execPath, targetNodePath);
  if (!isWindows) {
    fs.chmodSync(targetNodePath, 0o755);
  }
  console.log(`✅ Node.js runtime prepared: ${nodeExecutableName}\n`);
} catch (error) {
  console.error('❌ Failed to copy Node.js runtime:', error.message);
  process.exit(1);
}

// Step 4: Copy application bundle
console.log('Step 4: Copying application bundle...');
const appDir = path.join(PORTABLE_OUTPUT_DIR, 'app');
fs.ensureDirSync(appDir);

// Copy bundle
fs.copyFileSync(BUNDLE_FILE, path.join(appDir, 'bundle.js'));
console.log('   ✅ Copied bundle.js');

// Copy migration files (compiled .js from dist)
const migrationsSource = path.join(ROOT_DIR, 'backend', 'dist', 'database', 'migrations');
const migrationsTarget = path.join(appDir, 'migrations');

if (fs.existsSync(migrationsSource)) {
  fs.copySync(migrationsSource, migrationsTarget, {
    filter: (src) => {
      // .js 파일만 복사 (컴파일된 JavaScript)
      return src.endsWith('.js') || fs.statSync(src).isDirectory();
    }
  });
  const migrationFiles = fs.readdirSync(migrationsTarget).filter(f => f.endsWith('.js'));
  console.log(`   ✅ Copied ${migrationFiles.length} migration files`);
} else {
  console.warn('   ⚠️  Migration source not found, skipping');
}
console.log('');

// Step 5: Copy native modules with ALL dependencies
console.log('Step 5: Copying native modules...');
const appNodeModules = path.join(appDir, 'node_modules');
fs.ensureDirSync(appNodeModules);

// Find source node_modules
const sourceNodeModules = fs.existsSync(path.join(ROOT_DIR, 'backend', 'node_modules'))
  ? path.join(ROOT_DIR, 'backend', 'node_modules')
  : path.join(ROOT_DIR, 'node_modules');

console.log(`   📦 Reading sharp package.json to find all dependencies...`);
const sharpSource = path.join(sourceNodeModules, 'sharp');
const sharpPackageJson = JSON.parse(fs.readFileSync(path.join(sharpSource, 'package.json'), 'utf8'));

// Collect all sharp dependencies
const sharpDependencies = new Set();
if (sharpPackageJson.dependencies) {
  Object.keys(sharpPackageJson.dependencies).forEach(dep => sharpDependencies.add(dep));
}
if (sharpPackageJson.optionalDependencies) {
  Object.keys(sharpPackageJson.optionalDependencies).forEach(dep => sharpDependencies.add(dep));
}

console.log(`   Found ${sharpDependencies.size} direct dependencies of sharp`);

// Function to recursively collect dependencies
const collectAllDependencies = (moduleName, collected = new Set()) => {
  if (collected.has(moduleName)) return collected;
  collected.add(moduleName);

  const modulePath = path.join(sourceNodeModules, moduleName);
  const packageJsonPath = path.join(modulePath, 'package.json');

  if (!fs.existsSync(packageJsonPath)) return collected;

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    if (packageJson.dependencies) {
      Object.keys(packageJson.dependencies).forEach(dep => {
        collectAllDependencies(dep, collected);
      });
    }
  } catch (e) {
    // Ignore parse errors
  }

  return collected;
};

// Collect all transitive dependencies
console.log(`   📦 Collecting all transitive dependencies...`);
const allDependencies = new Set();
sharpDependencies.forEach(dep => {
  collectAllDependencies(dep, allDependencies);
});
console.log(`   Found ${allDependencies.size} total dependencies`);

// Copy sharp
console.log(`   📦 Copying sharp...`);
const sharpTarget = path.join(appNodeModules, 'sharp');
fs.copySync(sharpSource, sharpTarget, { dereference: true });
console.log(`   ✅ Copied sharp`);

// Copy sqlite3 and collect its dependencies
console.log(`   📦 Copying sqlite3...`);
const sqlite3Source = path.join(sourceNodeModules, 'sqlite3');
const sqlite3Target = path.join(appNodeModules, 'sqlite3');
if (fs.existsSync(sqlite3Source)) {
  fs.copySync(sqlite3Source, sqlite3Target, { dereference: true });
  console.log(`   ✅ Copied sqlite3`);

  // Collect sqlite3 dependencies
  const sqlite3PackageJson = JSON.parse(fs.readFileSync(path.join(sqlite3Source, 'package.json'), 'utf8'));
  if (sqlite3PackageJson.dependencies) {
    Object.keys(sqlite3PackageJson.dependencies).forEach(dep => {
      collectAllDependencies(dep, allDependencies);
    });
  }
  console.log(`   Found additional sqlite3 dependencies`);
}

// Copy all dependencies
console.log(`   📦 Copying all dependencies (${allDependencies.size} total)...`);
let copiedCount = 0;
for (const dep of allDependencies) {
  const depSource = path.join(sourceNodeModules, dep);
  const depTarget = path.join(appNodeModules, dep);

  if (fs.existsSync(depSource) && !fs.existsSync(depTarget)) {
    try {
      fs.copySync(depSource, depTarget, { dereference: true });
      copiedCount++;
    } catch (e) {
      console.warn(`   ⚠️  Failed to copy ${dep}: ${e.message}`);
    }
  }
}
console.log(`   ✅ Copied ${copiedCount} dependencies`);

// Copy @img scoped packages (sharp platform binaries)
console.log('   📦 Copying @img platform binaries...');
const imgScopeSource = path.join(sourceNodeModules, '@img');
const imgScopeTarget = path.join(appNodeModules, '@img');

if (fs.existsSync(imgScopeSource)) {
  fs.copySync(imgScopeSource, imgScopeTarget, { dereference: true });
  const packages = fs.readdirSync(imgScopeTarget);
  console.log(`   ✅ Copied ${packages.length} @img packages`);
}

console.log('✅ Native modules and dependencies copied\n');

// Step 6: Copy Python scripts and dependencies
console.log('Step 6: Copying Python scripts...');
const pythonSource = path.join(ROOT_DIR, 'backend', 'python');
const pythonTarget = path.join(appDir, 'python');

if (fs.existsSync(pythonSource)) {
  fs.ensureDirSync(pythonTarget);

  // Copy Python files
  const pythonFiles = ['wdv3_tagger_daemon.py', 'requirements.txt', 'README.md'];
  let copiedCount = 0;

  for (const file of pythonFiles) {
    const src = path.join(pythonSource, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(pythonTarget, file));
      copiedCount++;
    }
  }

  console.log(`   ✅ Copied ${copiedCount} Python files`);
  console.log('   ℹ️  Users need to run: pip install -r app/python/requirements.txt');
} else {
  console.warn('   ⚠️  Python source not found, skipping');
}
console.log('');

// Step 7: Copy frontend assets
console.log('Step 7: Copying frontend assets...');
const frontendSource = path.join(BACKEND_DIST, 'frontend');
const frontendTarget = path.join(appDir, 'frontend');

if (fs.existsSync(frontendSource)) {
  fs.copySync(frontendSource, frontendTarget, { dereference: true });
  const fileCount = fs.readdirSync(frontendTarget).length;
  console.log(`✅ Copied ${fileCount} frontend files/folders\n`);
} else {
  console.warn('⚠️  Frontend dist not found, skipping\n');
}

// Step 8: Create startup scripts
console.log('Step 8: Creating startup scripts...');

// Windows batch file - Use ASCII characters for maximum compatibility
const batchScript = `@echo off
chcp 65001 > nul
title ComfyUI Image Manager
cd /d "%~dp0"

echo.
echo ========================================================================
echo              ComfyUI Image Manager
echo.
echo  Starting server...
echo ========================================================================
echo.

node.exe app\\bundle.js

if errorlevel 1 (
    echo.
    echo ========================================================================
    echo  ERROR: Server failed to start
    echo.
    echo  Please check:
    echo  - Port 1566 is not in use
    echo  - All files are present
    echo  - Check logs folder for errors
    echo ========================================================================
    echo.
    pause
    exit /b 1
)

pause
`;

// Linux/Mac shell script
const shellScript = `#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "╔════════════════════════════════════════════════════════════════════════╗"
echo "║                    ComfyUI Image Manager                               ║"
echo "║                                                                        ║"
echo "║  Starting server...                                                    ║"
echo "╚════════════════════════════════════════════════════════════════════════╝"
echo ""

./node app/bundle.js

if [ $? -ne 0 ]; then
    echo ""
    echo "╔════════════════════════════════════════════════════════════════════════╗"
    echo "║  ❌ Error: Server failed to start                                     ║"
    echo "║                                                                        ║"
    echo "║  Please check:                                                         ║"
    echo "║  - Port 1566 is not in use                                            ║"
    echo "║  - All files are present                                              ║"
    echo "║  - Check logs folder for errors                                       ║"
    echo "╚════════════════════════════════════════════════════════════════════════╝"
    echo ""
    read -p "Press Enter to continue..."
    exit 1
fi
`;

fs.writeFileSync(path.join(PORTABLE_OUTPUT_DIR, 'start.bat'), batchScript, 'utf8');
fs.writeFileSync(path.join(PORTABLE_OUTPUT_DIR, 'start.sh'), shellScript, 'utf8');

if (!isWindows) {
  fs.chmodSync(path.join(PORTABLE_OUTPUT_DIR, 'start.sh'), 0o755);
}

console.log('✅ Startup scripts created\n');

// Step 9: Create environment template
console.log('Step 9: Creating environment template...');
const envTemplate = `# ComfyUI Image Manager Configuration
#
# This file was auto-generated. Rename to .env to use.

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Server Configuration
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Port to run the server on
PORT=1566

# Host binding (0.0.0.0 allows external connections)
HOST=0.0.0.0

# Protocol (http or https)
BACKEND_PROTOCOL=http

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Remote Access Configuration
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# For external access, set your public IP or domain
# PUBLIC_BASE_URL=http://your-external-ip:1566
# BACKEND_HOST=your-external-ip

# Enable external IP detection (requires internet)
# ENABLE_EXTERNAL_IP=true

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Runtime Paths (Optional)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Where to store data (uploads, database, logs)
# Leave empty to use the current directory
# RUNTIME_BASE_PATH=./data

# Where frontend files are located
# FRONTEND_DIST_PATH=./app/frontend

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ComfyUI Integration (Future)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# ComfyUI server URL for workflow integration
# COMFYUI_SERVER_URL=http://localhost:8188

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Locale
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Supported: en, ko, ja, zh
LOCALE=en

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# WD v3 Tagger Configuration
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Note: Tagger settings are managed via Settings UI (config/settings.json)
# The values below are only used as initial defaults on first run
# After first run, change all tagger settings through the Settings page in the web UI
#
# For instructions on Python setup, see app/python/README.md
`;

fs.writeFileSync(path.join(PORTABLE_OUTPUT_DIR, '.env.example'), envTemplate, 'utf8');
console.log('✅ Environment template created\n');

// Step 10: Create data directories
console.log('Step 10: Creating data directories...');
const dataDirectories = ['database', 'uploads', 'logs', 'temp', 'models'];
for (const dir of dataDirectories) {
  const dirPath = path.join(PORTABLE_OUTPUT_DIR, dir);
  fs.ensureDirSync(dirPath);
}
console.log('✅ Data directories created\n');

// Step 11: Create README
console.log('Step 11: Creating README...');
const readmeContent = `# ComfyUI Image Manager - Portable Edition

## 🚀 Quick Start

### Prerequisites (Optional - for WD v3 Tagger feature)

If you want to use the AI tagging feature, install Python dependencies:

\`\`\`bash
pip install -r app/python/requirements.txt
\`\`\`

**Note:** The application works without Python - tagging is an optional feature.

### Windows
1. Double-click \`start.bat\`
2. Wait for the server to start (console window will open)
3. Open your browser to the URL displayed

### Linux/Mac
1. Open terminal in this directory
2. Run: \`./start.sh\`
3. Open your browser to the URL displayed

## 📝 Configuration

1. Copy \`.env.example\` to \`.env\`
2. Edit \`.env\` to customize settings
3. Restart the application

## 🤖 WD v3 Tagger (Optional AI Feature)

The application includes an optional AI image tagging feature:

### Setup
1. Install Python 3.8+ (if not already installed)
2. Install dependencies:
   \`\`\`bash
   pip install -r app/python/requirements.txt
   \`\`\`
3. Enable in \`.env\`:
   \`\`\`
   TAGGER_ENABLED=true
   PYTHON_PATH=python
   \`\`\`

### Features
- Automatic tag detection (characters, objects, style)
- Rating classification (safe/questionable/explicit)
- Multiple model options (vit, swinv2, convnext)
- Models download automatically on first use (~600MB-1GB)

### GPU Acceleration (Optional)
For faster tagging with NVIDIA GPU:
\`\`\`bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
\`\`\`

## 🌐 Remote Access

To access from other devices on your network:
- The server will automatically display all available URLs when it starts
- Use the "Network" URLs shown in the console

For external internet access:
- See the full deployment guide in DEPLOYMENT_GUIDE.md (if included)
- Configure port forwarding on your router (port 1566)

## 📁 Data Storage

All data is stored in these folders (created automatically):
- \`uploads/\` - Your images
- \`database/\` - Database files
- \`logs/\` - Application logs
- \`models/\` - AI model cache (if using tagger)

## 🔧 Troubleshooting

### Port already in use
Change PORT in \`.env\` file

### Server won't start
- Check if port 1566 is available
- Check logs/ folder for error messages
- Ensure all files are present (app/, node.exe/node)

### Cannot access from other devices
- Ensure HOST=0.0.0.0 in \`.env\`
- Check firewall settings
- Use the network URLs shown when starting

### Tagging not working
- Check if Python is installed: \`python --version\`
- Install dependencies: \`pip install -r app/python/requirements.txt\`
- Check \`PYTHON_PATH\` in \`.env\` (try 'python3' on Linux/Mac)
- First use downloads models (~1GB) - be patient!

## 📚 Documentation

For detailed documentation:
- API Documentation
- Deployment Guide
- Development Guide

Visit: https://github.com/yourusername/comfyui-image-manager

## 📦 Package Contents

- \`${nodeExecutableName}\` - Node.js runtime (${NODE_VERSION})
- \`app/\` - Application files
  - \`app/bundle.js\` - Main application
  - \`app/python/\` - Python scripts for AI tagging (optional)
  - \`app/node_modules/\` - Native dependencies (sharp, sqlite3)
- \`start.bat\` / \`start.sh\` - Startup scripts
- \`.env.example\` - Configuration template
- \`models/\` - AI model cache (created on first use)

## 💡 Tips

- Keep this folder together - don't move individual files
- The app folder contains all necessary dependencies
- No Node.js installation required on the system
- Portable - can be moved to any location
- Python is optional - only needed for AI tagging feature
- Models are downloaded once and cached in \`models/\` folder

---

**Version:** 1.0.0
**Platform:** ${platform} ${arch}
**Node.js:** ${NODE_VERSION}
**Built:** ${new Date().toISOString()}
`;

fs.writeFileSync(path.join(PORTABLE_OUTPUT_DIR, 'README.txt'), readmeContent, 'utf8');
console.log('✅ README created\n');

// Step 11: Display summary
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✨ Portable Build Complete!');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const getDirectorySize = (dirPath) => {
  let size = 0;
  if (!fs.existsSync(dirPath)) return 0;

  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      size += getDirectorySize(filePath);
    } else {
      size += stats.size;
    }
  }
  return size;
};

const totalSize = getDirectorySize(PORTABLE_OUTPUT_DIR);
const nodeSizeStats = fs.statSync(targetNodePath);
const nodeSize = nodeSizeStats.size;

console.log(`\n📦 Package Information:`);
console.log(`   Node.js Runtime: ${(nodeSize / 1024 / 1024).toFixed(2)} MB`);
console.log(`   Application: ${((totalSize - nodeSize) / 1024 / 1024).toFixed(2)} MB`);
console.log(`   Total Size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
console.log(`   Location: ${PORTABLE_OUTPUT_DIR}`);

console.log('\n🚀 To test:');
if (isWindows) {
  console.log(`   cd ${path.relative(ROOT_DIR, PORTABLE_OUTPUT_DIR)}`);
  console.log('   start.bat');
} else {
  console.log(`   cd ${path.relative(ROOT_DIR, PORTABLE_OUTPUT_DIR)}`);
  console.log('   ./start.sh');
}

console.log('\n📦 To distribute:');
console.log('   1. Zip the entire "portable-output" folder');
console.log('   2. Share with users');
console.log('   3. Users just unzip and run start.bat/start.sh');
console.log('   4. No installation required!\n');
