import { createHashRouter } from 'react-router-dom'
import { AppShell } from '@/components/layout/app-shell'
import {
  GroupRoute,
  HomeRoute,
  ImageDetailRoute,
  ImageMetadataEditRoute,
  LoginRoute,
  NotFoundRoute,
  PromptRoute,
  SettingsRoute,
  UploadRoute,
} from '@/app/lazy-routes'

export const appRouter = createHashRouter([
  {
    path: '/login',
    element: <LoginRoute />,
  },
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <HomeRoute />,
      },
      {
        path: 'groups',
        element: <GroupRoute />,
      },
      {
        path: 'groups/:groupId',
        element: <GroupRoute />,
      },
      {
        path: 'prompts',
        element: <PromptRoute />,
      },
      {
        path: 'images/:compositeHash',
        element: <ImageDetailRoute />,
      },
      {
        path: 'images/:compositeHash/metadata',
        element: <ImageMetadataEditRoute />,
      },
      {
        path: 'upload',
        element: <UploadRoute />,
      },
      {
        path: 'settings',
        element: <SettingsRoute />,
      },
      {
        path: '*',
        element: <NotFoundRoute />,
      },
    ],
  },
])
