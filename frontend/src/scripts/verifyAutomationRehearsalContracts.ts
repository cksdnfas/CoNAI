import { ok } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const releaseReadinessTab = readFileSync(join(root, 'src/features/settings/components/release-readiness-tab.tsx'), 'utf8')
const releaseReadinessHistory = readFileSync(join(root, 'src/features/settings/release-readiness-history.ts'), 'utf8')
const rehearsalDoc = readFileSync(join(root, '../docs/systems/automation-rehearsal-contracts.md'), 'utf8')
const frontendPackageJson = readFileSync(join(root, 'package.json'), 'utf8')

ok(releaseReadinessHistory.includes('ReleaseReadinessAutomationRehearsalContract'), 'history should define automation rehearsal contracts')
ok(releaseReadinessHistory.includes('reviewedAutomationRehearsalIds: string[]'), 'history records should persist reviewed automation rehearsal ids')
ok(releaseReadinessHistory.includes("automationRehearsal: Array<ReleaseReadinessAutomationRehearsalContract & { status: 'reviewed' | 'open' }>"), 'history records should persist automation rehearsal review status')
ok(releaseReadinessHistory.includes('## Automation Rehearsal'), 'handoff Markdown should export automation rehearsal evidence')

ok(releaseReadinessTab.includes('AUTOMATION_REHEARSAL_ITEMS'), 'release readiness tab should define automation rehearsal items')
ok(releaseReadinessTab.includes('reviewedAutomationRehearsals'), 'release readiness UI should track reviewed rehearsal state')
ok(releaseReadinessTab.includes('toggleAutomationRehearsalItem'), 'release readiness UI should let operators review individual rehearsals')
ok(releaseReadinessTab.includes('data-release-readiness-automation-rehearsal="true"'), 'release readiness UI should expose the rehearsal surface')
ok(releaseReadinessTab.includes("'cleanup-staging-dry-run'"), 'rehearsal contracts should cover cleanup staging dry-runs')
ok(releaseReadinessTab.includes("'workflow-recovery-replay-dry-run'"), 'rehearsal contracts should cover workflow recovery replay dry-runs')
ok(releaseReadinessTab.includes("'release-candidate-command-dry-run'"), 'rehearsal contracts should cover release candidate command dry-runs')
ok(releaseReadinessTab.includes('does not delete, rerun, push, deploy, restart, or call external services'), 'rehearsal UI should preserve side-effect boundaries')
ok(releaseReadinessHistory.includes("[${item.status === 'reviewed' ? 'x' : ' '}"), 'handoff Markdown should export rehearsal review status')
ok(!releaseReadinessTab.includes('deleteImages('), 'rehearsal surface should not call destructive media cleanup')
ok(!releaseReadinessTab.includes('fetch('), 'rehearsal surface should not call backend action endpoints')

ok(rehearsalDoc.includes('dry-run evidence and local diffs only'), 'rehearsal docs should describe dry-run-only behavior')
ok(rehearsalDoc.includes('must not push, deploy, restart'), 'rehearsal docs should preserve release side-effect boundaries')
ok(rehearsalDoc.includes('npm run verify:automation-rehearsal-contracts'), 'rehearsal docs should include verifier anchor')
ok(frontendPackageJson.includes('"verify:automation-rehearsal-contracts"'), 'frontend package should expose the rehearsal verifier')

console.log('Automation rehearsal contracts verified.')
