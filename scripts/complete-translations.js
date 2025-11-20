const fs = require('fs');
const path = require('path');

const FRONTEND_LOCALES_DIR = path.join(__dirname, '../frontend/src/i18n/locales');
const REFERENCE_LANG = 'en';
const TARGET_LANGS = ['ja', 'zh-CN', 'zh-TW'];
const NAMESPACES = [
    'common', 'settings', 'navigation', 'gallery', 'imageDetail', 'upload',
    'imageGroups', 'search', 'promptManagement', 'workflows', 'imageGeneration',
    'generationHistory', 'servers', 'errors', 'validation', 'wildcards'
];

// Load JSON file
function loadJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error.message);
        return null;
    }
}

// Save JSON file with proper formatting
function saveJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\r\n', 'utf8');
}

// Get value from nested object using dot notation
function getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
}

// Set value in nested object using dot notation
function setNestedValue(obj, path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((current, key) => {
        if (!current[key]) current[key] = {};
        return current[key];
    }, obj);
    target[lastKey] = value;
}

// Get all key paths from object
function getAllKeyPaths(obj, prefix = '') {
    let paths = [];
    for (const key in obj) {
        const fullPath = prefix ? `${prefix}.${key}` : key;
        if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
            paths = paths.concat(getAllKeyPaths(obj[key], fullPath));
        } else {
            paths.push(fullPath);
        }
    }
    return paths;
}

// Translation mappings for common terms
const translations = {
    // Common UI elements
    'Click to copy': { ja: 'クリックしてコピー', 'zh-CN': '点击复制', 'zh-TW': '點擊複製' },
    'Thumbnail': { ja: 'サムネイル', 'zh-CN': '缩略图', 'zh-TW': '縮圖' },
    'Original': { ja: 'オリジナル', 'zh-CN': '原图', 'zh-TW': '原圖' },
    'Video': { ja: '動画', 'zh-CN': '视频', 'zh-TW': '影片' },
    'None': { ja: 'なし', 'zh-CN': '无', 'zh-TW': '無' },
    'Enabled': { ja: '有効', 'zh-CN': '启用', 'zh-TW': '啟用' },
    'Disabled': { ja: '無効', 'zh-CN': '禁用', 'zh-TW': '停用' },
    'Save': { ja: '保存', 'zh-CN': '保存', 'zh-TW': '儲存' },
    'Refresh': { ja: '更新', 'zh-CN': '刷新', 'zh-TW': '重新整理' },

    // Already translated in common.json, skip it
};

// Try to auto-translate based on English value
function autoTranslate(enValue, targetLang) {
    // Check direct match
    if (translations[enValue]) {
        return translations[enValue][targetLang];
    }

    // For now, return the English value with a marker
    // In production, you'd use a translation API here
    return `[${targetLang}] ${enValue}`;
}

console.log('Starting translation completion process...\n');

let totalAdded = 0;
let filesModified = 0;

TARGET_LANGS.forEach(targetLang => {
    console.log(`\nProcessing language: ${targetLang}`);
    console.log('='.repeat(50));

    NAMESPACES.forEach(namespace => {
        const refPath = path.join(FRONTEND_LOCALES_DIR, REFERENCE_LANG, `${namespace}.json`);
        const targetPath = path.join(FRONTEND_LOCALES_DIR, targetLang, `${namespace}.json`);

        const refData = loadJson(refPath);
        if (!refData) {
            console.log(`  ⚠️  Reference file not found: ${namespace}.json`);
            return;
        }

        let targetData = loadJson(targetPath);
        if (!targetData) {
            console.log(`  ⚠️  Target file not found: ${namespace}.json - Skipping`);
            return;
        }

        const refPaths = getAllKeyPaths(refData);
        const targetPaths = getAllKeyPaths(targetData);
        const missingPaths = refPaths.filter(p => !targetPaths.includes(p));

        if (missingPaths.length === 0) {
            console.log(`  ✓  ${namespace}.json - No missing keys`);
            return;
        }

        console.log(`  📝 ${namespace}.json - Adding ${missingPaths.length} missing keys`);

        missingPaths.forEach(path => {
            const enValue = getNestedValue(refData, path);
            const translatedValue = autoTranslate(enValue, targetLang);
            setNestedValue(targetData, path, translatedValue);
            totalAdded++;
        });

        saveJson(targetPath, targetData);
        filesModified++;
        console.log(`     ✓  Saved`);
    });
});

console.log('\n' + '='.repeat(50));
console.log(`\n✅ Translation completion finished!`);
console.log(`   Files modified: ${filesModified}`);
console.log(`   Keys added: ${totalAdded}`);
console.log(`\n⚠️  Note: Auto-translated keys are marked with [lang] prefix.`);
console.log(`   Please review and update them with proper translations.\n`);
