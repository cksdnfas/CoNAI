import fs from 'fs';
import path from 'path';

const backendRoot = process.cwd();
const repoRoot = path.resolve(backendRoot, '..');

const HEADER_NAVIGATION_KEYS = [
  'access',
  'home',
  'groups',
  'prompts',
  'generation',
  'upload',
  'wallpaper',
  'settings',
  'search',
  'queue',
  'account',
];

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertIncludes(content: string, needle: string, label: string) {
  if (!content.includes(needle)) {
    throw new Error(`${label} missing: ${needle}`);
  }
}

const backendTypes = read('backend/src/types/settings.ts');
const frontendTypes = read('frontend/src/types/settings.ts');
const storage = read('backend/src/services/settingsServiceStorage.ts');
const updates = read('backend/src/services/settingsServiceUpdates.ts');
const settingsRoutes = read('backend/src/routes/settings.ts');
const registerRoutes = read('backend/src/startup/registerAppRoutes.ts');
const apiSettings = read('frontend/src/lib/api-settings.ts');
const appShell = read('frontend/src/components/layout/app-shell.tsx');
const generalTab = read('frontend/src/features/settings/components/general-tab.tsx');
const settingsPage = read('frontend/src/features/settings/settings-page.tsx');

for (const key of HEADER_NAVIGATION_KEYS) {
  assertIncludes(backendTypes, `'${key}'`, 'backend header navigation keys');
  assertIncludes(frontendTypes, `'${key}'`, 'frontend header navigation keys');
  assertIncludes(generalTab, `key: '${key}'`, 'general tab checklist options');
}

assertIncludes(storage, 'getDefaultHeaderNavigationSettings()', 'default header navigation settings');
assertIncludes(storage, 'normalizeHeaderNavigationSettings(loadedSettings.general?.headerNavigation)', 'loaded header navigation merge');
assertIncludes(storage, 'defaults.general.headerNavigation', 'missing-field header navigation check');
assertIncludes(updates, 'headerNavigation:', 'general settings nested header navigation merge');
assertIncludes(settingsRoutes, 'validHeaderNavigationItemKeys', 'header navigation validation');
assertIncludes(settingsRoutes, 'headerNavigation must be an object', 'header navigation object validation');
assertIncludes(registerRoutes, "/api/settings/header-navigation-public", 'public header navigation endpoint');
assertIncludes(apiSettings, 'getPublicHeaderNavigationSettings', 'frontend public header navigation API');
assertIncludes(appShell, 'getPublicHeaderNavigationSettings', 'app shell public header navigation query');
assertIncludes(appShell, 'headerNavigation[item.id] !== false', 'app shell nav item visibility gate');
assertIncludes(appShell, 'headerNavigation.queue !== false', 'app shell queue visibility gate');
assertIncludes(appShell, 'headerNavigation.search !== false', 'app shell search visibility gate');
assertIncludes(appShell, 'headerNavigation.account !== false', 'app shell account visibility gate');
assertIncludes(generalTab, 'HEADER_NAVIGATION_OPTIONS.map', 'general tab checklist rendering');
assertIncludes(settingsPage, "['public-header-navigation-settings']", 'settings page public nav cache sync');
assertIncludes(settingsPage, 'isGeneralDraftDirty', 'settings page general draft dirty check');
assertIncludes(settingsPage, 'hasImageSaveChanges={isImageSaveDraftDirty}', 'settings page image-save draft dirty check');
assertIncludes(settingsPage, 'hasGenerationThrottleChanges={isGenerationThrottleDraftDirty}', 'settings page generation throttle draft dirty check');
assertIncludes(generalTab, 'disabled={!generalDraft || isSaving || !hasChanges}', 'general tab save only enables for draft changes');

console.log('Header navigation settings contracts verified.');
