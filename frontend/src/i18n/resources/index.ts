import { shellResources, shellCatalog } from './shell'
import { authResources, authCatalog } from './auth'
import { homeResources, homeCatalog } from './home'
import { uploadResources, uploadCatalog } from './upload'
import { systemResources, systemCatalog } from './system'
import { settingsResources, settingsCatalog } from './settings'
import { groupsResources, groupsCatalog } from './groups'
import { promptsResources, promptsCatalog } from './prompts'
import { imagesResources, imagesCatalog } from './images'
import { imageEditorResources, imageEditorCatalog } from './image-editor'
import { metadataResources, metadataCatalog } from './metadata'
import { searchResources, searchCatalog } from './search'
import { wallpaperResources, wallpaperCatalog } from './wallpaper'
import { imageGenerationResources, imageGenerationCatalog } from './image-generation'
import { moduleGraphResources, moduleGraphCatalog } from './module-graph'

export { shellResources, shellCatalog } from './shell'
export { authResources, authCatalog } from './auth'
export { homeResources, homeCatalog } from './home'
export { uploadResources, uploadCatalog } from './upload'
export { systemResources, systemCatalog } from './system'
export { settingsResources, settingsCatalog } from './settings'
export { groupsResources, groupsCatalog } from './groups'
export { promptsResources, promptsCatalog } from './prompts'
export { imagesResources, imagesCatalog } from './images'
export { imageEditorResources, imageEditorCatalog } from './image-editor'
export { metadataResources, metadataCatalog } from './metadata'
export { searchResources, searchCatalog } from './search'
export { wallpaperResources, wallpaperCatalog } from './wallpaper'
export { imageGenerationResources, imageGenerationCatalog } from './image-generation'
export { moduleGraphResources, moduleGraphCatalog } from './module-graph'
export type { LocaleCode, ScopedLocaleResources, TranslationCatalog, TranslationDictionary } from './types'

export const featureLocaleResources = {
  "shell": shellResources,
  "auth": authResources,
  "home": homeResources,
  "upload": uploadResources,
  "system": systemResources,
  "settings": settingsResources,
  "groups": groupsResources,
  "prompts": promptsResources,
  "images": imagesResources,
  "image-editor": imageEditorResources,
  "metadata": metadataResources,
  "search": searchResources,
  "wallpaper": wallpaperResources,
  "image-generation": imageGenerationResources,
  "module-graph": moduleGraphResources,
} as const

export const featureLocaleCatalog = {
  ...shellCatalog,
  ...authCatalog,
  ...homeCatalog,
  ...uploadCatalog,
  ...systemCatalog,
  ...settingsCatalog,
  ...groupsCatalog,
  ...promptsCatalog,
  ...imagesCatalog,
  ...imageEditorCatalog,
  ...metadataCatalog,
  ...searchCatalog,
  ...wallpaperCatalog,
  ...imageGenerationCatalog,
  ...moduleGraphCatalog,
} as const

export type FeatureLocaleResourceScope = keyof typeof featureLocaleResources
