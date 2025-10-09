const { execSync } = require('child_process');
const path = require('path');

console.log('📦 Preparing backend for packaging...');

const backendDir = path.join(__dirname, '..', 'backend');

try {
  // Install production dependencies only
  console.log('Installing production dependencies...');
  execSync('npm install --omit=dev --ignore-scripts', {
    cwd: backendDir,
    stdio: 'inherit'
  });

  console.log('✅ Backend prepared successfully');
} catch (error) {
  console.error('❌ Failed to prepare backend:', error);
  process.exit(1);
}
