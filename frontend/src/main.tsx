import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installLabelClickGuard } from './lib/label-click-guard'
import { installWallpaperHostBridge } from './features/wallpaper/wallpaper-host-bridge'
import './index.css'

installLabelClickGuard()
// Lively / Wallpaper Engine call their globals on the live wallpaper before the lazy route loads.
if (window.location.hash.startsWith('#/wallpaper/runtime')) installWallpaperHostBridge()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
