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
const generalPreferences = read('frontend/src/features/settings/components/general-preferences-sections.tsx');
const settingsPage = read('frontend/src/features/settings/settings-page.tsx');
const settingsTabs = read('frontend/src/features/settings/settings-tabs.ts');
const settingsTabNav = read('frontend/src/features/settings/components/settings-tab-nav.tsx');

for (const key of HEADER_NAVIGATION_KEYS) {
  assertIncludes(backendTypes, `'${key}'`, 'backend header navigation keys');
  assertIncludes(frontendTypes, `'${key}'`, 'frontend header navigation keys');
  assertIncludes(generalPreferences, `key: '${key}'`, 'appearance checklist options');
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
assertIncludes(generalPreferences, 'HEADER_NAVIGATION_OPTIONS.map', 'appearance checklist rendering');
assertIncludes(settingsPage, "['public-header-navigation-settings']", 'settings page public nav cache sync');
assertIncludes(settingsPage, 'isGeneralDraftDirty', 'settings page general draft dirty check');
assertIncludes(settingsPage, 'hasImageSaveChanges: isImageSaveDraftDirty', 'settings page image-save draft dirty check');
assertIncludes(settingsPage, 'hasGenerationThrottleChanges: isGenerationThrottleDraftDirty', 'settings page generation throttle draft dirty check');
assertIncludes(generalPreferences, 'disabled={!generalDraft || isSaving || !hasChanges}', 'preference save only enables for draft changes');
for (const section of ['general', 'appearance', 'library', 'media', 'auto', 'generation', 'integration', 'system']) {
  assertIncludes(settingsTabs, `value: '${section}'`, 'settings information architecture');
}
assertIncludes(settingsTabs, "folders: 'library'", 'legacy folder settings link');
assertIncludes(settingsTabs, "'llm-connections': 'generation'", 'legacy LLM settings link');
assertIncludes(settingsTabNav, 'SETTINGS_TAB_GROUP_LABELS', 'grouped settings navigation');
assertIncludes(settingsPage, "useSearchParams()", 'settings URL section state');
assertIncludes(settingsPage, 'showGenerationThrottle={false}', 'media section generation split');
assertIncludes(settingsPage, 'showMediaSettings={false}', 'generation section media split');

console.log('Header navigation settings contracts verified.');
