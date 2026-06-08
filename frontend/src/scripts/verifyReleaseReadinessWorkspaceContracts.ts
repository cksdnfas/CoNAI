import { ok } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const settingsTabs = readFileSync(join(root, 'src/features/settings/settings-tabs.ts'), 'utf8')
const settingsTabNav = readFileSync(join(root, 'src/features/settings/components/settings-tab-nav.tsx'), 'utf8')
const settingsPage = readFileSync(join(root, 'src/features/settings/settings-page.tsx'), 'utf8')
const releaseReadinessTab = readFileSync(join(root, 'src/features/settings/components/release-readiness-tab.tsx'), 'utf8')

ok(settingsTabs.includes("'release-readiness'"), 'settings tab union should include release-readiness')
ok(settingsTabs.includes("{ value: 'release-readiness' }"), 'settings tab list should expose release-readiness')
ok(settingsTabNav.includes("'release-readiness': { ko: '릴리즈 준비', en: 'Release readiness' }"), 'settings nav should label release-readiness')
ok(settingsPage.includes("import('./components/release-readiness-tab')"), 'settings page should lazy-load the release readiness tab')
ok(settingsPage.includes("activeTab === 'release-readiness'"), 'settings page should render the release readiness tab')
ok(releaseReadinessTab.includes('REVIEW_ITEMS'), 'release readiness workspace should have local review checklist items')
ok(releaseReadinessTab.includes("'completed-work'"), 'release readiness checklist should include completed work review')
ok(releaseReadinessTab.includes("'caveats'"), 'release readiness checklist should include caveat review')
ok(releaseReadinessTab.includes("'evidence'"), 'release readiness checklist should include evidence review')
ok(releaseReadinessTab.includes("'decisions'"), 'release readiness checklist should include user-owned decision review')
ok(releaseReadinessTab.includes('EVIDENCE_ITEMS'), 'release readiness workspace should expose evidence tiles')
ok(releaseReadinessTab.includes('npm run verify:release-readiness'), 'release readiness evidence should include the canonical release check')
ok(releaseReadinessTab.includes('python -m graphify update .'), 'release readiness evidence should include Graphify refresh')
ok(releaseReadinessTab.includes('USER_DECISIONS'), 'release readiness workspace should separate user-owned release decisions')
ok(releaseReadinessTab.includes("'alpha-push'"), 'release decisions should include alpha push approval')
ok(releaseReadinessTab.includes("'demo-update'"), 'release decisions should include demo host update approval')
ok(releaseReadinessTab.includes("'restart-smoke'"), 'release decisions should include restart/smoke approval')
ok(releaseReadinessTab.includes("'cleanup'"), 'release decisions should include destructive cleanup approval')
ok(!releaseReadinessTab.includes('buildApiUrl('), 'release readiness workspace should not call backend action endpoints')
ok(!releaseReadinessTab.includes('fetch('), 'release readiness workspace should not perform release side effects')
ok(!releaseReadinessTab.includes('triggerBlobDownload'), 'release readiness workspace should not trigger generated handoff downloads yet')

console.log('Release readiness workspace contracts verified.')
