import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), 'src')
const homeSearchUi = readFileSync(resolve(root, 'features/home/components/home-search-ui.tsx'), 'utf8')

assert.ok(
  homeSearchUi.includes('let homeSearchDrawerContentLoadPromise'),
  'home search drawer lazy import should be cached for preload and click paths',
)
assert.ok(
  homeSearchUi.includes("import('./home-search-drawer-content')"),
  'home search drawer content should remain split behind a dynamic import',
)
assert.ok(
  homeSearchUi.includes('homeSearchDrawerContentLoadPromise = null'),
  'home search drawer loader should reset after chunk-load failures so retries still work',
)
assert.ok(
  homeSearchUi.includes('const HomeSearchDrawerContentLazy = lazy(loadHomeSearchDrawerContent)'),
  'React.lazy must use the shared cached drawer loader',
)
assert.match(
  homeSearchUi,
  /void loadHomeSearchDrawerContent\(\)\s*\n\s*openDrawer\(\)/,
  'header open should start loading the drawer chunk before setting open state',
)
assert.ok(
  homeSearchUi.includes('scheduleHomeSearchDrawerContentPreload'),
  'drawer chunk should have a scheduled preload path',
)
assert.ok(
  homeSearchUi.includes('requestIdleCallback') && homeSearchUi.includes('{ timeout: 2500 }'),
  'scheduled preload should prefer requestIdleCallback with a timeout',
)
assert.ok(
  homeSearchUi.includes('window.setTimeout') && homeSearchUi.includes('}, 1200)'),
  'scheduled preload should fall back to a delayed timer when idle callbacks are unavailable',
)
assert.match(
  homeSearchUi,
  /useEffect\(\(\) => \{\s*if \(!active\) \{\s*return\s*}\s*return scheduleHomeSearchDrawerContentPreload\(\)/,
  'drawer preload should only be scheduled while the home search surface is active',
)

console.log('Home search drawer loading contracts verified.')
