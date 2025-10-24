#!/usr/bin/env node

/**
 * ComfyUI Image Manager - Bundle Script
 * 모든 의존성을 단일 JavaScript 파일로 번들링
 */

const { build } = require('esbuild');
const fs = require('fs-extra');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const BACKEND_DIST = path.join(ROOT_DIR, 'backend', 'dist');
const BUNDLE_OUTPUT = path.join(BACKEND_DIST, 'bundle.js');
const ENTRY_POINT = path.join(BACKEND_DIST, 'index.js');

console.log('📦 ComfyUI Image Manager - Bundling\n');

// Check if backend is built
if (!fs.existsSync(ENTRY_POINT)) {
  console.error('❌ Backend dist not found. Run "npm run build:integrated" first.');
  process.exit(1);
}

console.log('🔧 Bundling with esbuild...');
console.log(`   Entry: ${path.relative(ROOT_DIR, ENTRY_POINT)}`);
console.log(`   Output: ${path.relative(ROOT_DIR, BUNDLE_OUTPUT)}\n`);

build({
  entryPoints: [ENTRY_POINT],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: BUNDLE_OUTPUT,
  external: [
    // Native modules that cannot be bundled
    'sharp',
    'better-sqlite3',
    'canvas',
    'ffmpeg-static',
    'ffprobe-static',
    'blake2',
    'argon2'
  ],
  minify: false,  // Disabled for better error messages
  sourcemap: true,
  treeShaking: true,
  metafile: true,
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': '"production"'
  },
  banner: {
    js: `// ComfyUI Image Manager - Bundled Backend
// Generated: ${new Date().toISOString()}
// Node.js ${process.version}
`
  }
})
  .then((result) => {
    console.log('\n✅ Bundle created successfully!\n');

    // Display bundle stats
    if (result.metafile) {
      const outputs = Object.keys(result.metafile.outputs);
      outputs.forEach((output) => {
        const stats = result.metafile.outputs[output];
        const sizeKB = (stats.bytes / 1024).toFixed(2);
        console.log(`📊 Bundle size: ${sizeKB} KB`);
      });

      // Display largest dependencies
      const inputs = Object.entries(result.metafile.inputs);
      const sorted = inputs
        .sort((a, b) => b[1].bytes - a[1].bytes)
        .slice(0, 10);

      console.log('\n📦 Top 10 largest dependencies:');
      sorted.forEach(([file, info]) => {
        const sizeKB = (info.bytes / 1024).toFixed(2);
        const fileName = path.basename(file);
        console.log(`   ${fileName.padEnd(40)} ${sizeKB.padStart(10)} KB`);
      });
    }

    // Check for native modules
    const bundleContent = fs.readFileSync(BUNDLE_OUTPUT, 'utf8');
    const nativeModules = ['sharp', 'better-sqlite3', 'ffmpeg-static', 'ffprobe-static'];
    const foundNative = nativeModules.filter((mod) =>
      bundleContent.includes(`require("${mod}")`) ||
      bundleContent.includes(`require('${mod}')`)
    );

    if (foundNative.length > 0) {
      console.log('\n⚠️  Native modules detected (will be copied separately):');
      foundNative.forEach((mod) => {
        console.log(`   - ${mod}`);
      });
    }

    console.log('\n🚀 Next step: npm run build:sea\n');
  })
  .catch((error) => {
    console.error('\n❌ Bundle failed:', error.message);
    if (error.errors) {
      error.errors.forEach((err) => {
        console.error(`   ${err.text}`);
      });
    }
    process.exit(1);
  });
