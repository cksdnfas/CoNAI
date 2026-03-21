import { createHashRouter } from 'react-router-dom'
import { AppShell } from '@/components/layout/app-shell'
import { LoginPage } from '@/features/auth/login-page'
import { HomePage } from '@/features/home/home-page'
import { ImageDetailPage } from '@/features/images/image-detail-page'
import { SettingsPage } from '@/features/settings/settings-page'
import { NotFoundPage } from '@/features/system/not-found-page'
import { UploadPage } from '@/features/upload/upload-page'

export const appRouter = createHashRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        path: 'images/:compositeHash',
        element: <ImageDetailPage />,
      },
      {
        path: 'upload',
        element: <UploadPage />,
      },
      {
        path: 'settings',
        element: <SettingsPage />,
      },
      {
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
])
