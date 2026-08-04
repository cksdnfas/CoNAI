import { Suspense, lazy, type ReactNode } from 'react'
import { registerTranslationCatalog, type TranslationCatalog } from '@/i18n'

const LAZY_ROUTE_RELOAD_PREFIX = 'conai:lazy-route:reload:'

type RouteModuleLoader<TModule = unknown> = () => Promise<TModule>

type CatalogModuleLoader = () => Promise<TranslationCatalog>

async function loadRouteModuleWithCatalog<TModule>(
  routeLoader: () => Promise<TModule>,
  catalogLoaders: CatalogModuleLoader[],
): Promise<TModule> {
  const [routeModule, ...catalogs] = await Promise.all([
    routeLoader(),
    ...catalogLoaders.map((loader) => loader()),
  ])

  for (const catalog of catalogs) {
    registerTranslationCatalog(catalog)
  }

  return routeModule
}

const routeModuleLoaders = {
  login: () => import('@/features/auth/login-page'),
  'access-overview': () => import('@/features/auth/access-overview-page'),
  'group-page': () => loadRouteModuleWithCatalog(
    () => import('@/features/groups/group-page'),
    [() => import('@/i18n/resources/groups').then((module) => module.groupsCatalog), () => import('@/i18n/resources/images').then((module) => module.imagesCatalog)],
  ),
  'home-page': () => loadRouteModuleWithCatalog(
    () => import('@/features/home/home-page'),
    [() => import('@/i18n/resources/home').then((module) => module.homeCatalog), () => import('@/i18n/resources/search').then((module) => module.searchCatalog), () => import('@/i18n/resources/images').then((module) => module.imagesCatalog)],
  ),
  'image-generation-page': () => loadRouteModuleWithCatalog(
    () => import('@/features/image-generation/image-generation-page'),
    [() => import('@/i18n/resources/image-generation').then((module) => module.imageGenerationCatalog), () => import('@/i18n/resources/module-graph').then((module) => module.moduleGraphCatalog), () => import('@/i18n/resources/images').then((module) => module.imagesCatalog)],
  ),
  'public-comfy-workflow-page': () => loadRouteModuleWithCatalog(
    () => import('@/features/image-generation/public-comfy-workflow-page'),
    [() => import('@/i18n/resources/image-generation').then((module) => module.imageGenerationCatalog), () => import('@/i18n/resources/images').then((module) => module.imagesCatalog)],
  ),
  'wildcard-page': () => loadRouteModuleWithCatalog(
    () => import('@/features/image-generation/wildcard-page'),
    [() => import('@/i18n/resources/image-generation').then((module) => module.imageGenerationCatalog)],
  ),
  'image-detail-page': () => loadRouteModuleWithCatalog(
    () => import('@/features/images/image-detail-page'),
    [() => import('@/i18n/resources/images').then((module) => module.imagesCatalog), () => import('@/i18n/resources/image-editor').then((module) => module.imageEditorCatalog)],
  ),
  'image-metadata-edit-page': () => loadRouteModuleWithCatalog(
    () => import('@/features/metadata/image-metadata-edit-page'),
    [() => import('@/i18n/resources/metadata').then((module) => module.metadataCatalog), () => import('@/i18n/resources/images').then((module) => module.imagesCatalog)],
  ),
  'prompt-page': () => loadRouteModuleWithCatalog(
    () => import('@/features/prompts/prompt-page'),
    [() => import('@/i18n/resources/prompts').then((module) => module.promptsCatalog)],
  ),
  'settings-page': () => loadRouteModuleWithCatalog(
    () => import('@/features/settings/settings-page'),
    [() => import('@/i18n/resources/settings').then((module) => module.settingsCatalog)],
  ),
  'not-found-page': () => loadRouteModuleWithCatalog(
    () => import('@/features/system/not-found-page'),
    [() => import('@/i18n/resources/system').then((module) => module.systemCatalog)],
  ),
  'upload-page': () => loadRouteModuleWithCatalog(
    () => import('@/features/upload/upload-page'),
    [() => import('@/i18n/resources/upload').then((module) => module.uploadCatalog)],
  ),
  'wallpaper-editor-page': () => loadRouteModuleWithCatalog(
    () => import('@/features/wallpaper/wallpaper-editor-page'),
    [() => import('@/i18n/resources/wallpaper').then((module) => module.wallpaperCatalog)],
  ),
  'wallpaper-runtime-page': () => loadRouteModuleWithCatalog(
    () => import('@/features/wallpaper/wallpaper-runtime-page'),
    [() => import('@/i18n/resources/wallpaper').then((module) => module.wallpaperCatalog)],
  ),
} as const satisfies Record<string, RouteModuleLoader>

function isRecoverableLazyImportError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i.test(message)
}

function loadLazyRoute<TModule>(routeKey: string, loader: () => Promise<TModule>) {
  return loader()
    .then((module) => {
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(`${LAZY_ROUTE_RELOAD_PREFIX}${routeKey}`)
      }

      return module
    })
    .catch((error) => {
      if (typeof window === 'undefined' || !isRecoverableLazyImportError(error)) {
        throw error
      }

      const reloadKey = `${LAZY_ROUTE_RELOAD_PREFIX}${routeKey}`
      const hasReloaded = window.sessionStorage.getItem(reloadKey) === '1'

      if (!hasReloaded) {
        window.sessionStorage.setItem(reloadKey, '1')
        window.location.reload()
        return new Promise<never>(() => {})
      }

      window.sessionStorage.removeItem(reloadKey)
      throw error
    })
}

function resolvePrefetchPath(to: string) {
  try {
    return new URL(to, 'https://conai.local').pathname
  } catch {
    return to.split(/[?#]/, 1)[0] || '/'
  }
}

function getRouteModuleLoader(to: string): RouteModuleLoader | null {
  const pathname = resolvePrefetchPath(to)

  if (pathname === '/login') {
    return routeModuleLoaders.login
  }

  if (pathname === '/access') {
    return routeModuleLoaders['access-overview']
  }

  if (pathname === '/') {
    return routeModuleLoaders['home-page']
  }

  if (pathname === '/groups' || pathname.startsWith('/groups/')) {
    return routeModuleLoaders['group-page']
  }

  if (pathname === '/prompts') {
    return routeModuleLoaders['prompt-page']
  }

  if (pathname === '/generation') {
    return routeModuleLoaders['image-generation-page']
  }

  if (pathname === '/wildcards') {
    return routeModuleLoaders['wildcard-page']
  }

  if (pathname.startsWith('/public/workflows/')) {
    return routeModuleLoaders['public-comfy-workflow-page']
  }

  if (pathname.startsWith('/images/') && pathname.endsWith('/metadata')) {
    return routeModuleLoaders['image-metadata-edit-page']
  }

  if (pathname.startsWith('/images/')) {
    return routeModuleLoaders['image-detail-page']
  }

  if (pathname === '/upload') {
    return routeModuleLoaders['upload-page']
  }

  if (pathname === '/settings') {
    return routeModuleLoaders['settings-page']
  }

  if (pathname === '/wallpaper/runtime') {
    return routeModuleLoaders['wallpaper-runtime-page']
  }

  if (pathname === '/wallpaper') {
    return routeModuleLoaders['wallpaper-editor-page']
  }

  return null
}

export function prefetchAppRoute(to: string) {
  const loader = getRouteModuleLoader(to)
  if (!loader) {
    return
  }

  void loader().catch(() => {
    // Best-effort route warmup only. The actual route loader handles recoverable chunk errors.
  })
}

const LoginPageLazy = lazy(async () => {
  const module = await loadLazyRoute('login', routeModuleLoaders.login)
  return { default: module.LoginPage }
})

const AccessOverviewPageLazy = lazy(async () => {
  const module = await loadLazyRoute('access-overview', routeModuleLoaders['access-overview'])
  return { default: module.AccessOverviewPage }
})

const GroupPageLazy = lazy(async () => {
  const module = await loadLazyRoute('group-page', routeModuleLoaders['group-page'])
  return { default: module.GroupPage }
})

const HomePageLazy = lazy(async () => {
  const module = await loadLazyRoute('home-page', routeModuleLoaders['home-page'])
  return { default: module.HomePage }
})

const ImageGenerationPageLazy = lazy(async () => {
  const module = await loadLazyRoute('image-generation-page', routeModuleLoaders['image-generation-page'])
  return { default: module.ImageGenerationPage }
})

const PublicComfyWorkflowPageLazy = lazy(async () => {
  const module = await loadLazyRoute('public-comfy-workflow-page', routeModuleLoaders['public-comfy-workflow-page'])
  return { default: module.PublicComfyWorkflowPage }
})

const WildcardPageLazy = lazy(async () => {
  const module = await loadLazyRoute('wildcard-page', routeModuleLoaders['wildcard-page'])
  return { default: module.WildcardPage }
})

const ImageDetailPageLazy = lazy(async () => {
  const module = await loadLazyRoute('image-detail-page', routeModuleLoaders['image-detail-page'])
  return { default: module.ImageDetailPage }
})

const ImageMetadataEditPageLazy = lazy(async () => {
  const module = await loadLazyRoute('image-metadata-edit-page', routeModuleLoaders['image-metadata-edit-page'])
  return { default: module.ImageMetadataEditPage }
})

const PromptPageLazy = lazy(async () => {
  const module = await loadLazyRoute('prompt-page', routeModuleLoaders['prompt-page'])
  return { default: module.PromptPage }
})

const SettingsPageLazy = lazy(async () => {
  const module = await loadLazyRoute('settings-page', routeModuleLoaders['settings-page'])
  return { default: module.SettingsPage }
})

const NotFoundPageLazy = lazy(async () => {
  const module = await loadLazyRoute('not-found-page', routeModuleLoaders['not-found-page'])
  return { default: module.NotFoundPage }
})

const UploadPageLazy = lazy(async () => {
  const module = await loadLazyRoute('upload-page', routeModuleLoaders['upload-page'])
  return { default: module.UploadPage }
})

const WallpaperEditorPageLazy = lazy(async () => {
  const module = await loadLazyRoute('wallpaper-editor-page', routeModuleLoaders['wallpaper-editor-page'])
  return { default: module.WallpaperEditorPage }
})

const WallpaperRuntimePageLazy = lazy(async () => {
  const module = await loadLazyRoute('wallpaper-runtime-page', routeModuleLoaders['wallpaper-runtime-page'])
  return { default: module.WallpaperRuntimePage }
})

function RouteFallback() {
  return <div className="min-h-[40vh] rounded-sm bg-surface-low animate-pulse" />
}

function withSuspense(element: ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>
}

export function LoginRoute() {
  return withSuspense(<LoginPageLazy />)
}

export function AccessOverviewRoute() {
  return withSuspense(<AccessOverviewPageLazy />)
}

export function GroupRoute() {
  return withSuspense(<GroupPageLazy />)
}

export function HomeRoute() {
  return withSuspense(<HomePageLazy />)
}

export function ImageGenerationRoute() {
  return withSuspense(<ImageGenerationPageLazy />)
}

export function PublicComfyWorkflowRoute() {
  return withSuspense(<PublicComfyWorkflowPageLazy />)
}

export function WildcardRoute() {
  return withSuspense(<WildcardPageLazy />)
}

export function ImageDetailRoute() {
  return withSuspense(<ImageDetailPageLazy />)
}

export function ImageMetadataEditRoute() {
  return withSuspense(<ImageMetadataEditPageLazy />)
}

export function PromptRoute() {
  return withSuspense(<PromptPageLazy />)
}

export function SettingsRoute() {
  return withSuspense(<SettingsPageLazy />)
}

export function NotFoundRoute() {
  return withSuspense(<NotFoundPageLazy />)
}

export function UploadRoute() {
  return withSuspense(<UploadPageLazy />)
}

export function WallpaperEditorRoute() {
  return withSuspense(<WallpaperEditorPageLazy />)
}

export function WallpaperRuntimeRoute() {
  return withSuspense(<WallpaperRuntimePageLazy />)
}
