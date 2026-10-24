#!/usr/bin/env node

/**
 * CoNAI - Deployment Helper
 * Interactive deployment script
 */

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

const ROOT_DIR = path.resolve(__dirname, '..');
const BUILD_OUTPUT_DIR = path.join(ROOT_DIR, 'build-output');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  console.log('🚀 CoNAI - Deployment Helper\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('Select deployment type:\n');
  console.log('  1. Portable Package (Windows/Linux/Mac standalone)');
  console.log('  2. Docker Container (Recommended for servers)');
  console.log('  3. Single Executable (SEA - Experimental)');
  console.log('  4. Build All\n');

  const choice = await question('Enter choice (1-4): ');

  console.log('');

  try {
    switch (choice.trim()) {
      case '1':
        await buildPortable();
        break;
      case '2':
        await buildDocker();
        break;
      case '3':
        await buildSEA();
        break;
      case '4':
        await buildAll();
        break;
      default:
        console.log('❌ Invalid choice');
        process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Deployment failed:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

async function buildPortable() {
  console.log('📦 Building Portable Package...\n');

  execSync('npm run build:integrated', { cwd: ROOT_DIR, stdio: 'inherit' });
  execSync('npm run build:bundle', { cwd: ROOT_DIR, stdio: 'inherit' });
  execSync('npm run build:portable', { cwd: ROOT_DIR, stdio: 'inherit' });

  const portableDir = path.join(BUILD_OUTPUT_DIR, 'portable');
  const size = getDirectorySize(portableDir);

  console.log('\n✅ Portable build complete!\n');
  console.log('📊 Summary:');
  console.log(`   Location: ${portableDir}`);
  console.log(`   Size: ${(size / 1024 / 1024).toFixed(2)} MB`);
  console.log('\n📦 Distribution:');
  console.log('   1. Zip the "build-output/portable" folder');
  console.log('   2. Share with users');
  console.log('   3. Users unzip and run start.bat/start.sh');
  console.log('   4. No installation required!\n');
}

/** The image is built from the root Dockerfile (the one Coolify deploys); compose files pick CPU or GPU. */
async function buildDocker() {
  console.log('🐳 Docker image from the root Dockerfile\n');
  console.log('  CPU: docker compose up -d --build');
  console.log('  GPU: docker compose -f compose.yaml -f compose.gpu.yaml up -d --build\n');

  const deploy = await question('Build and start the CPU image with Docker Compose now? (y/n): ');

  if (deploy.toLowerCase() === 'y') {
    console.log('\n🚀 Deploying with Docker Compose...\n');
    execSync('docker compose up -d --build', { cwd: ROOT_DIR, stdio: 'inherit' });
    console.log('\n✅ Deployment complete!');
    console.log('🌐 Access at: http://localhost:1666\n');
  }
}

async function buildSEA() {
  console.log('⚡ Building Single Executable Application...\n');
  console.log('⚠️  Note: SEA is experimental and may have limitations\n');

  execSync('npm run build:integrated', { cwd: ROOT_DIR, stdio: 'inherit' });
  execSync('npm run build:bundle', { cwd: ROOT_DIR, stdio: 'inherit' });
  execSync('npm run build:sea', { cwd: ROOT_DIR, stdio: 'inherit' });

  const seaDir = path.join(BUILD_OUTPUT_DIR, 'sea');
  console.log('\n✅ SEA build complete!');
  console.log(`📊 Location: ${seaDir}\n`);
}

async function buildAll() {
  console.log('🔨 Building All Deployment Types...\n');

  execSync('npm run build:integrated', { cwd: ROOT_DIR, stdio: 'inherit' });
  execSync('npm run build:bundle', { cwd: ROOT_DIR, stdio: 'inherit' });

  console.log('\n📦 Building Portable...');
  execSync('npm run build:portable', { cwd: ROOT_DIR, stdio: 'inherit' });

  console.log('\n⚡ Building SEA...');
  execSync('npm run build:sea', { cwd: ROOT_DIR, stdio: 'inherit' });

  console.log('\n✅ All builds complete!\n');
  console.log('📁 Build Output Structure:');
  console.log('   build-output/');
  console.log('   ├── portable/    (Standalone package)');
  console.log('   └── sea/         (Single executable)');
  console.log('   Docker images build from the root Dockerfile (docker compose up -d --build).\n');

  const portableSize = getDirectorySize(path.join(BUILD_OUTPUT_DIR, 'portable'));
  const seaSize = getDirectorySize(path.join(BUILD_OUTPUT_DIR, 'sea'));

  console.log('📊 Size Summary:');
  console.log(`   Portable: ${(portableSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   SEA:      ${(seaSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   Total:    ${((portableSize + seaSize) / 1024 / 1024).toFixed(2)} MB\n`);
}

function getDirectorySize(dirPath) {
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
}

main();
