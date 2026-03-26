import { Suspense, lazy, type ReactNode } from 'react'

const LoginPageLazy = lazy(async () => {
  const module = await import('@/features/auth/login-page')
  return { default: module.LoginPage }
})

const GroupPageLazy = lazy(async () => {
  const module = await import('@/features/groups/group-page')
  return { default: module.GroupPage }
})

const HomePageLazy = lazy(async () => {
  const module = await import('@/features/home/home-page')
  return { default: module.HomePage }
})

const ImageDetailPageLazy = lazy(async () => {
  const module = await import('@/features/images/image-detail-page')
  return { default: module.ImageDetailPage }
})

const ImageMetadataEditPageLazy = lazy(async () => {
  const module = await import('@/features/metadata/image-metadata-edit-page')
  return { default: module.ImageMetadataEditPage }
})

const PromptPageLazy = lazy(async () => {
  const module = await import('@/features/prompts/prompt-page')
  return { default: module.PromptPage }
})

const SettingsPageLazy = lazy(async () => {
  const module = await import('@/features/settings/settings-page')
  return { default: module.SettingsPage }
})

const NotFoundPageLazy = lazy(async () => {
  const module = await import('@/features/system/not-found-page')
  return { default: module.NotFoundPage }
})

const UploadPageLazy = lazy(async () => {
  const module = await import('@/features/upload/upload-page')
  return { default: module.UploadPage }
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

export function GroupRoute() {
  return withSuspense(<GroupPageLazy />)
}

export function HomeRoute() {
  return withSuspense(<HomePageLazy />)
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
