const fs = require('fs');
const path = require('path');

const FRONTEND_LOCALES_DIR = path.join(__dirname, '../frontend/src/i18n/locales');
const LANGUAGES = ['en', 'ko', 'ja', 'zh-CN', 'zh-TW'];
const NAMESPACES = [
    'common', 'settings', 'navigation', 'gallery', 'imageDetail', 'upload',
    'imageGroups', 'search', 'promptManagement', 'workflows', 'imageGeneration',
    'generationHistory', 'servers', 'errors', 'validation', 'wildcards', 'auth'
];

// Utility to recursively get all keys from a nested object
function getAllKeys(obj, prefix = '') {
    let keys = [];
    for (const key in obj) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
            keys = keys.concat(getAllKeys(obj[key], fullKey));
        } else {
            keys.push(fullKey);
        }
    }
    return keys;
}

// Load a JSON file
function loadJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        return null;
    }
}

// Main analysis
function analyzeTranslations() {
    const results = {
        summary: {},
        missingFiles: [],
        missingKeys: {},
        statistics: {}
    };

    // Use English as the reference
    const reference = 'en';

    LANGUAGES.forEach(lang => {
        results.summary[lang] = {
            totalNamespaces: NAMESPACES.length,
            existingNamespaces: 0,
            missingNamespaces: []
        };
        results.missingKeys[lang] = {};
        results.statistics[lang] = {
            totalKeys: 0,
            translatedKeys: 0,
            missingKeys: 0
        };
    });

    // Analyze each namespace
    NAMESPACES.forEach(namespace => {
        const refPath = path.join(FRONTEND_LOCALES_DIR, reference, `${namespace}.json`);
        const refData = loadJson(refPath);

        if (!refData) {
            console.log(`Warning: Reference file not found: ${refPath}`);
            return;
        }

        const refKeys = getAllKeys(refData);

        LANGUAGES.forEach(lang => {
            if (lang === reference) {
                results.summary[lang].existingNamespaces++;
                results.statistics[lang].totalKeys += refKeys.length;
                results.statistics[lang].translatedKeys += refKeys.length;
                return;
            }

            const langPath = path.join(FRONTEND_LOCALES_DIR, lang, `${namespace}.json`);
            const langData = loadJson(langPath);

            if (!langData) {
                results.summary[lang].missingNamespaces.push(namespace);
                results.missingFiles.push({ lang, namespace });
                results.statistics[lang].totalKeys += refKeys.length;
                results.statistics[lang].missingKeys += refKeys.length;
                return;
            }

            results.summary[lang].existingNamespaces++;
            const langKeys = getAllKeys(langData);
            const missingKeys = refKeys.filter(key => !langKeys.includes(key));

            if (missingKeys.length > 0) {
                if (!results.missingKeys[lang][namespace]) {
                    results.missingKeys[lang][namespace] = [];
                }
                results.missingKeys[lang][namespace] = missingKeys;
            }

            results.statistics[lang].totalKeys += refKeys.length;
            results.statistics[lang].translatedKeys += (refKeys.length - missingKeys.length);
            results.statistics[lang].missingKeys += missingKeys.length;
        });
    });

    return results;
}

// Display results
const results = analyzeTranslations();

console.log('\n=== i18n Translation Completeness Report ===\n');

// Overall statistics
console.log('Overall Statistics:');
console.log('-------------------');
LANGUAGES.forEach(lang => {
    const stats = results.statistics[lang];
    const percentage = stats.totalKeys > 0
        ? ((stats.translatedKeys / stats.totalKeys) * 100).toFixed(2)
        : 0;
    console.log(`${lang.padEnd(8)}: ${stats.translatedKeys}/${stats.totalKeys} keys (${percentage}% complete)`);
});

// Missing files
if (results.missingFiles.length > 0) {
    console.log('\n\nMissing Translation Files:');
    console.log('--------------------------');
    results.missingFiles.forEach(({ lang, namespace }) => {
        console.log(`  [${lang}] ${namespace}.json`);
    });
}

// Missing keys by language
console.log('\n\nMissing Translation Keys:');
console.log('-------------------------');
LANGUAGES.forEach(lang => {
    if (lang === 'en') return; // Skip reference language

    const missingKeys = results.missingKeys[lang];
    const namespaces = Object.keys(missingKeys);

    if (namespaces.length > 0) {
        console.log(`\n[${lang}]`);
        namespaces.forEach(namespace => {
            const keys = missingKeys[namespace];
            if (keys.length > 0) {
                console.log(`  ${namespace}.json: ${keys.length} missing keys`);
                keys.forEach(key => {
                    console.log(`    - ${key}`);
                });
            }
        });
    }
});

// Summary by namespace
console.log('\n\nNamespace Summary:');
console.log('------------------');
LANGUAGES.forEach(lang => {
    const summary = results.summary[lang];
    console.log(`${lang}: ${summary.existingNamespaces}/${summary.totalNamespaces} namespaces`);
    if (summary.missingNamespaces.length > 0) {
        console.log(`  Missing: ${summary.missingNamespaces.join(', ')}`);
    }
});

console.log('\n');

// Write detailed report to file
const reportPath = path.join(__dirname, '../i18n-completeness-report.json');
fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
console.log(`Detailed report saved to: ${reportPath}\n`);
