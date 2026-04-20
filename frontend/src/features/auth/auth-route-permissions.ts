/** Resolve the page-view permission key that matches one app pathname. */
export function resolveRoutePermissionKey(pathname: string) {
  if (pathname === '/') {
    return 'page.home.view'
  }

  if (pathname === '/groups' || pathname.startsWith('/groups/')) {
    return 'page.groups.view'
  }

  if (pathname === '/prompts') {
    return 'page.prompts.view'
  }

  if (pathname === '/generation' || pathname === '/graph') {
    return 'page.generation.view'
  }

  if (pathname === '/wildcards') {
    return 'page.wildcards.view'
  }

  if (pathname.startsWith('/images/') && pathname.endsWith('/metadata')) {
    return 'page.metadata-editor.view'
  }

  if (pathname.startsWith('/images/')) {
    return 'page.image-detail.view'
  }

  if (pathname === '/upload') {
    return 'page.upload.view'
  }

  if (pathname === '/settings') {
    return 'page.settings.view'
  }

  if (pathname === '/wallpaper') {
    return 'page.wallpaper.view'
  }

  if (pathname === '/wallpaper/runtime') {
    return 'page.wallpaper.runtime.view'
  }

  return null
}
