const fs = require('fs-extra');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

// User guides the chat and MCP read with get_app_guide (backend/src/services/appGuides.ts looks next to the app).
function copyUserGuides(target) {
  const source = path.join(ROOT_DIR, 'docs', 'GUIDE');
  if (!fs.existsSync(source)) {
    console.warn('   ⚠️  docs/GUIDE not found, the chat cannot read the user guides');
    return;
  }
  fs.ensureDirSync(target);
  let copied = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      fs.copyFileSync(path.join(source, entry.name), path.join(target, entry.name));
      copied++;
    }
  }
  console.log(`   ✅ Copied ${copied} user guides`);
}

module.exports = { copyUserGuides };
