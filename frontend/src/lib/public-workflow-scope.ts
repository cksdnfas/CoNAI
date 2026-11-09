// The app uses a hash router: the page path lives in location.hash ("#/public/workflows/<slug>").
const PUBLIC_WORKFLOW_PAGE_PATH = /^#\/public\/workflows\/([^/?#]+)/

/**
 * On a shared workflow page the server accepts the page's slug in place of generation/gallery permissions for the
 * inputs that page needs. Read from the URL so every caller, including previews rendered from a saved draft, is
 * scoped without plumbing.
 */
export function withPublicWorkflowScope(path: string, params = new URLSearchParams()) {
  const slug = PUBLIC_WORKFLOW_PAGE_PATH.exec(window.location.hash)?.[1]
  if (slug) params.set('publicWorkflow', decodeURIComponent(slug))
  const query = params.toString()
  return `${path}${query ? `?${query}` : ''}`
}
