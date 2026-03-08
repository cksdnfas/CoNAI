#!/usr/bin/env node

/**
 * CoNAI - SEA Build Script
 * Node.js Single Executable Application 생성
 */

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const ROOT_DIR = path.resolve(__dirname, '..');
const BACKEND_DIST = path.join(ROOT_DIR, 'backend', 'dist');
const BUNDLE_FILE = path.join(BACKEND_DIST, 'bundle.js');
const SEA_CONFIG = path.join(ROOT_DIR, 'sea-config.json');
const SEA_BLOB = path.join(ROOT_DIR, 'sea-prep.blob');
const BUILD_OUTPUT_DIR = path.join(ROOT_DIR, 'build-output');
const PKG_OUTPUT_DIR = path.join(BUILD_OUTPUT_DIR, 'sea');

const platform = os.platform();
const arch = os.arch();
const isWindows = platform === 'win32';
const executableName = isWindows ? 'conai.exe' : 'conai';
const unixExecutableCommand = './conai';
const outputExecutable = path.join(PKG_OUTPUT_DIR, executableName);

console.log('🚀 CoNAI - SEA Builder\n');
console.log(`📋 Platform: ${platform} ${arch}`);
console.log(`📦 Output: ${executableName}\n`);

// Step 1: Check prerequisites
console.log('Step 1: Checking prerequisites...');
if (!fs.existsSync(BUNDLE_FILE)) {
  console.error('❌ Bundle not found. Run "npm run build:bundle" first.');
  process.exit(1);
}

if (!fs.existsSync(SEA_CONFIG)) {
  console.error('❌ SEA config not found:', SEA_CONFIG);
  process.exit(1);
}

console.log('✅ Prerequisites OK\n');

// Step 2: Generate SEA blob
console.log('Step 2: Generating SEA preparation blob...');
try {
  execSync(`node --experimental-sea-config "${SEA_CONFIG}"`, {
    cwd: ROOT_DIR,
    stdio: 'inherit'
  });

  if (!fs.existsSync(SEA_BLOB)) {
    throw new Error('SEA blob was not generated');
  }

  const blobSize = fs.statSync(SEA_BLOB).size;
  console.log(`✅ SEA blob generated: ${(blobSize / 1024 / 1024).toFixed(2)} MB\n`);
} catch (error) {
  console.error('❌ SEA blob generation failed:', error.message);
  process.exit(1);
}

// Step 3: Create output directory
console.log('Step 3: Preparing output directory...');
fs.ensureDirSync(PKG_OUTPUT_DIR);
console.log('✅ Output directory ready\n');

// Step 4: Copy Node.js binary
console.log('Step 4: Copying Node.js binary...');
try {
  const nodeExecutable = process.execPath;
  fs.copyFileSync(nodeExecutable, outputExecutable);

  // Make executable on Unix systems
  if (!isWindows) {
    fs.chmodSync(outputExecutable, 0o755);
  }

  console.log(`✅ Node.js binary copied\n`);
} catch (error) {
  console.error('❌ Failed to copy Node.js binary:', error.message);
  process.exit(1);
}

// Step 5: Inject SEA blob into executable
console.log('Step 5: Injecting SEA blob into executable...');

try {
  // Install postject if not available
  const postjectPath = path.join(ROOT_DIR, 'node_modules', '.bin', isWindows ? 'postject.cmd' : 'postject');

  if (!fs.existsSync(postjectPath)) {
    console.log('   Installing postject...');
    execSync('npm install --no-save postject', {
      cwd: ROOT_DIR,
      stdio: 'inherit'
    });
  }

  // Inject blob
  const sentinelFuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
  const injectCommand = isWindows
    ? `"${postjectPath}" "${outputExecutable}" NODE_SEA_BLOB "${SEA_BLOB}" --sentinel-fuse ${sentinelFuse}`
    : `"${postjectPath}" "${outputExecutable}" NODE_SEA_BLOB "${SEA_BLOB}" --sentinel-fuse ${sentinelFuse}`;

  execSync(injectCommand, {
    cwd: ROOT_DIR,
    stdio: 'inherit'
  });

  console.log('✅ SEA blob injected\n');
} catch (error) {
  console.error('❌ Injection failed:', error.message);
  process.exit(1);
}

// Step 6: Sign executable (Windows only)
if (isWindows) {
  console.log('Step 6: Signing executable (optional)...');
  console.log('⚠️  Code signing skipped. Install signtool for production builds.\n');
} else {
  console.log('Step 6: Skipping code signing (not Windows)\n');
}

// Step 7: Copy native modules
console.log('Step 7: Copying native modules...');
try {
  const nativeModules = ['sharp', 'sqlite3'];

  for (const moduleName of nativeModules) {
    // Try multiple locations for native modules (workspace structure)
    const possibleLocations = [
      path.join(ROOT_DIR, 'node_modules', moduleName),           // Root (workspace)
      path.join(ROOT_DIR, 'backend', 'node_modules', moduleName) // Backend
    ];

    let sourceModule = null;
    for (const location of possibleLocations) {
      if (fs.existsSync(location)) {
        sourceModule = location;
        break;
      }
    }

    if (!sourceModule) {
      console.warn(`   ⚠️  ${moduleName} not found in any location, skipping`);
      continue;
    }

    const targetModule = path.join(PKG_OUTPUT_DIR, 'node_modules', moduleName);

    console.log(`   📦 Copying ${moduleName} from ${path.relative(ROOT_DIR, sourceModule)}...`);
    fs.copySync(sourceModule, targetModule, {
      dereference: true,
      filter: (src) => {
        // Skip unnecessary files
        const relativePath = path.relative(sourceModule, src);
        return !relativePath.includes('.git') &&
          !relativePath.includes('test') &&
          !relativePath.includes('docs') &&
          !relativePath.includes('example') &&
          !relativePath.includes('benchmark') &&
          !path.basename(src).startsWith('.') &&
          !src.endsWith('.md') &&
          !src.endsWith('.markdown');
      }
    });
    console.log(`   ✅ Copied ${moduleName}`);
  }

  console.log('✅ Native modules copied\n');
} catch (error) {
  console.warn('⚠️  Native module copy failed:', error.message, '\n');
}

// Step 8: Copy frontend assets
console.log('Step 8: Packaging frontend assets...');
try {
  const frontendSource = path.join(BACKEND_DIST, 'frontend');
  const frontendTarget = path.join(PKG_OUTPUT_DIR, 'frontend');

  if (fs.existsSync(frontendSource)) {
    fs.copySync(frontendSource, frontendTarget, { dereference: true });
    const fileCount = fs.readdirSync(frontendTarget).length;
    console.log(`✅ Copied ${fileCount} frontend files/folders\n`);
  } else {
    console.warn('⚠️  Frontend dist not found, skipping\n');
  }
} catch (error) {
  console.error('❌ Frontend copy failed:', error.message);
  process.exit(1);
}

// Step 9: Create environment template
console.log('Step 9: Creating environment template...');
try {
  // Read the source .env.example from root
  const sourceEnvPath = path.join(ROOT_DIR, '.env.example');
  let envContent = fs.readFileSync(sourceEnvPath, 'utf8');

  // Add SEA build header
  const seaHeader = `# CoNAI Configuration
#
# This file was auto-generated from root .env.example
# Rename to .env to use.

`;

  // Combine header with source content
  const finalEnvContent = seaHeader + envContent;

  fs.writeFileSync(
    path.join(PKG_OUTPUT_DIR, '.env.example'),
    finalEnvContent,
    'utf8'
  );
  console.log('✅ Environment template created\n');
} catch (error) {
  console.warn('⚠️  Environment template creation failed:', error.message, '\n');
}

// Step 10: Create README
console.log('Step 10: Creating README...');
try {
  const readme = `# CoNAI

## 🚀 Quick Start

### Windows
1. Double-click \`${executableName}\`
2. Wait for the server to start
3. Open your browser to the displayed URL

### Linux/Mac
1. Open terminal in this directory
2. Run: \`${unixExecutableCommand}\`
3. Open your browser to the displayed URL

## 📝 Configuration

1. Copy \`.env.example\` to \`.env\`
2. Edit \`.env\` to customize settings
3. Restart the application

## 🌐 Remote Access

To access from other devices:

1. Find your local IP address:
   - Windows: \`ipconfig\`
   - Linux/Mac: \`ifconfig\` or \`ip addr\`

2. Set in \`.env\`:
   \`\`\`
   PUBLIC_BASE_URL=http://YOUR_LOCAL_IP:1666
   BACKEND_HOST=YOUR_LOCAL_IP
   \`\`\`

3. Configure your router for external access (port forwarding)

## 📁 Data Storage

All data is stored in these folders (created automatically):
- \`uploads/\` - Your images
- \`database/\` - Database files
- \`logs/\` - Application logs

## 🔧 Troubleshooting

### Port already in use
Change PORT in \`.env\` file

### Cannot access from other devices
- Check firewall settings
- Ensure HOST=0.0.0.0 in \`.env\`
- Verify router configuration

### Database errors
Delete \`database/\` folder and restart (will lose data)

## 📞 Support

For issues and updates, visit the GitHub repository.

---

Generated: ${new Date().toISOString()}
Platform: ${platform} ${arch}
Node.js: ${process.version}
`;

  fs.writeFileSync(
    path.join(PKG_OUTPUT_DIR, 'README.md'),
    readme,
    'utf8'
  );
  console.log('✅ README created\n');
} catch (error) {
  console.warn('⚠️  README creation failed:', error.message, '\n');
}

// Cleanup
console.log('Step 11: Cleaning up temporary files...');
try {
  if (fs.existsSync(SEA_BLOB)) {
    fs.removeSync(SEA_BLOB);
  }
  console.log('✅ Cleanup complete\n');
} catch (error) {
  console.warn('⚠️  Cleanup failed:', error.message, '\n');
}

// Final summary
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✨ SEA Build Complete!');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

try {
  const executableStats = fs.statSync(outputExecutable);
  const executableSize = (executableStats.size / 1024 / 1024).toFixed(2);

  console.log(`\n📦 Executable: ${executableName}`);
  console.log(`📊 Size: ${executableSize} MB`);
  console.log(`📁 Location: ${PKG_OUTPUT_DIR}`);

  // Calculate total package size
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

  const totalSize = getDirectorySize(PKG_OUTPUT_DIR);
  console.log(`📦 Total package: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

  console.log('\n🚀 To test:');
  console.log(`   cd ${path.relative(ROOT_DIR, PKG_OUTPUT_DIR)}`);
  console.log(`   ${isWindows ? '' : './'}${executableName}`);
  console.log('\n📦 To distribute:');
  console.log(`   Zip the entire "${path.basename(PKG_OUTPUT_DIR)}" folder`);
  console.log('   Share with users - no installation required!\n');

} catch (error) {
  console.warn('⚠️  Could not read file stats:', error.message);
}
