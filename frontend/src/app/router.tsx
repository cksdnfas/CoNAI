import { Navigate, createHashRouter, useSearchParams, type RouteObject } from 'react-router-dom'
import { RouteErrorBoundary } from '@/app/route-error-boundary'
import { ProtectedAppShell } from '@/features/auth/protected-app-shell'
import { RequireAuthPermission } from '@/features/auth/require-auth-permission'
import {
  AccessOverviewRoute,
  CharacterLibraryRoute,
  CodexChatRoute,
  GroupRoute,
  HomeRoute,
  ImageDetailRoute,
  ImageGenerationRoute,
  ImageMetadataEditRoute,
  LoginRoute,
  PublicComfyWorkflowRoute,
  WildcardRoute,
  NotFoundRoute,
  PromptRoute,
  SettingsRoute,
  FilesRoute,
  SpriteRoute,
  AudioRoute,
  PostsRoute,
  UploadRoute,
  WallpaperEditorRoute,
  WallpaperRuntimeRoute,
} from '@/app/lazy-routes'

/** Move legacy pathname-based wallpaper links into the hash router before it reads location. */
function normalizeLegacyWallpaperRuntimeLocation() {
  if (window.location.pathname !== '/wallpaper/runtime' || window.location.hash) {
    return
  }

  window.history.replaceState(
    window.history.state,
    '',
    `/#/wallpaper/runtime${window.location.search}`,
  )
}

normalizeLegacyWallpaperRuntimeLocation()

function SettingsAccess() {
  const [params] = useSearchParams()
  const personal = params.get('section') === 'mine' || (params.get('section') === 'chat' && params.get('view') === 'mine')
  return <RequireAuthPermission permissionKey={personal ? 'page.chat.view' : 'page.settings.view'}><SettingsRoute /></RequireAuthPermission>
}

/**
 * Dev-only routes. `import.meta.env.DEV` is replaced with `false` in production builds, so the branch (and the
 * dynamic import inside it) is dropped and the catalog chunk is never emitted.
 */
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: '/dev/ui',
        lazy: async () => {
          const module = await import('@/features/dev-ui-catalog/ui-catalog-page')
          return { Component: module.UiCatalogPage }
        },
        errorElement: <RouteErrorBoundary />,
      },
    ]
  : []

export const appRouter = createHashRouter([
  ...devRoutes,
  {
    path: '/login',
    element: <LoginRoute />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    // Outside the app shell: a runtime key (`k`) opens it in logged-out kiosk browsers such as Lively.
    path: '/wallpaper/runtime',
    element: <WallpaperRuntimeRoute />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: '/',
    element: <ProtectedAppShell />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        path: 'extensions',
        lazy: async () => {
          const { PluginsPage } = await import('@/features/plugins/plugins-page')
          return { Component: PluginsPage }
        },
      },
      {
        path: 'ext/:pluginId/:pageId',
        lazy: async () => {
          const { PluginPage } = await import('@/features/plugins/plugin-page')
          return { Component: PluginPage }
        },
      },
      {
        path: 'access',
        element: <AccessOverviewRoute />,
      },
      {
        index: true,
        element: <HomeRoute />,
      },
      {
        path: 'groups',
        element: <RequireAuthPermission permissionKey="page.groups.view"><GroupRoute /></RequireAuthPermission>,
      },
      {
        path: 'groups/:groupId',
        element: <RequireAuthPermission permissionKey="page.groups.view"><GroupRoute /></RequireAuthPermission>,
      },
      {
        path: 'prompts',
        element: <RequireAuthPermission permissionKey="page.prompts.view"><PromptRoute /></RequireAuthPermission>,
      },
      {
        path: 'generation',
        element: <RequireAuthPermission permissionKey="page.generation.view"><ImageGenerationRoute /></RequireAuthPermission>,
      },
      {
        path: 'audio',
        element: <RequireAuthPermission permissionKey="page.audio.view"><AudioRoute /></RequireAuthPermission>,
      },
      {
        path: 'posts',
        element: <RequireAuthPermission permissionKey="page.posts.view"><PostsRoute /></RequireAuthPermission>,
      },
      {
        path: 'sprite',
        element: <RequireAuthPermission permissionKey="page.sprite.view"><SpriteRoute /></RequireAuthPermission>,
      },
      {
        path: 'wildcards',
        element: <RequireAuthPermission permissionKey="page.wildcards.view"><WildcardRoute /></RequireAuthPermission>,
      },
      {
        path: 'characters',
        element: <RequireAuthPermission permissionKey="page.characters.view"><CharacterLibraryRoute /></RequireAuthPermission>,
      },
      {
        path: 'chat/resources',
        lazy: async () => {
          const { ChatResourcesPage } = await import('@/features/codex-chat/chat-resources-page')
          return { Component: ChatResourcesPage }
        },
      },
      {
        path: 'chat',
        element: <RequireAuthPermission permissionKey="page.chat.view"><CodexChatRoute /></RequireAuthPermission>,
      },
      {
        path: 'public/workflows/:slug',
        element: <PublicComfyWorkflowRoute />,
      },
      {
        path: 'graph',
        element: <Navigate to="/generation?tab=workflows" replace />,
      },
      {
        path: 'images/:compositeHash',
        element: <RequireAuthPermission permissionKey="page.image-detail.view"><ImageDetailRoute /></RequireAuthPermission>,
      },
      {
        path: 'images/:compositeHash/metadata',
        element: <RequireAuthPermission permissionKey="page.metadata-editor.view"><ImageMetadataEditRoute /></RequireAuthPermission>,
      },
      {
        path: 'upload',
        element: <RequireAuthPermission permissionKey="page.upload.view"><UploadRoute /></RequireAuthPermission>,
      },
      {
        path: 'files',
        element: <RequireAuthPermission permissionKey="page.files.view"><FilesRoute /></RequireAuthPermission>,
      },
      {
        path: 'settings',
        element: <SettingsAccess />,
      },
      {
        path: 'wallpaper',
        element: <RequireAuthPermission permissionKey="page.wallpaper.view"><WallpaperEditorRoute /></RequireAuthPermission>,
      },
      {
        path: '*',
        element: <NotFoundRoute />,
      },
    ],
  },
])
