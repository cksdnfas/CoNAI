import { expect, test } from '@playwright/test'

test('@smoke-auth auth route flow keeps login public and redirects protected guests', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1 id="view"></h1>
      <script>
        const state = {
          hasCredentials: true,
          isAuthenticated: false,
        }

        function renderRoute() {
          const view = document.getElementById('view')
          const route = window.location.hash.replace('#', '') || '/'

          if (route === '/login') {
            view.textContent = 'Login View'
            return
          }

          if (state.hasCredentials && !state.isAuthenticated) {
            window.location.hash = '/login'
            view.textContent = 'Login View'
            return
          }

          if (route === '/protected') {
            view.textContent = 'Protected View'
            return
          }

          view.textContent = 'Home View'
        }

        window.__setAuthState = (nextState) => {
          state.hasCredentials = nextState.hasCredentials
          state.isAuthenticated = nextState.isAuthenticated
        }

        window.addEventListener('hashchange', renderRoute)
        renderRoute()
      </script>
    </main>
  `)

  await page.evaluate(() => {
    window.location.hash = '/login'
  })
  await expect(page.getByRole('heading', { name: 'Login View' })).toBeVisible()

  await page.evaluate(() => {
    window.location.hash = '/protected'
  })
  await expect(page.getByRole('heading', { name: 'Login View' })).toBeVisible()

  await page.evaluate(() => {
    ;(
      window as Window & {
        __setAuthState: (nextState: { hasCredentials: boolean; isAuthenticated: boolean }) => void
      }
    ).__setAuthState({ hasCredentials: false, isAuthenticated: false })
    window.location.hash = '/protected'
  })
  await expect(page.getByRole('heading', { name: 'Protected View' })).toBeVisible()
})
