import { Navigate, createHashRouter } from 'react-router-dom'
import { ProtectedAppShell } from '@/features/auth/protected-app-shell'
import { RequireAuthPermission } from '@/features/auth/require-auth-permission'
import {
  AccessOverviewRoute,
  GroupRoute,
  HomeRoute,
  ImageDetailRoute,
  ImageGenerationRoute,
  ImageMetadataEditRoute,
  LoginRoute,
  PublicComfyWorkflowRoute,
  NotFoundRoute,
  PromptRoute,
  SettingsRoute,
  UploadRoute,
  WallpaperEditorRoute,
  WallpaperRuntimeRoute,
} from '@/app/lazy-routes'

export const appRouter = createHashRouter([
  {
    path: '/login',
    element: <LoginRoute />,
  },
  {
    path: '/',
    element: <ProtectedAppShell />,
    children: [
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
        path: 'settings',
        element: <RequireAuthPermission permissionKey="page.settings.view"><SettingsRoute /></RequireAuthPermission>,
      },
      {
        path: 'wallpaper',
        element: <RequireAuthPermission permissionKey="page.wallpaper.view"><WallpaperEditorRoute /></RequireAuthPermission>,
      },
      {
        path: 'wallpaper/runtime',
        element: <RequireAuthPermission permissionKey="page.wallpaper.runtime.view"><WallpaperRuntimeRoute /></RequireAuthPermission>,
      },
      {
        path: '*',
        element: <NotFoundRoute />,
      },
    ],
  },
])
