import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installLabelClickGuard } from './lib/label-click-guard'
import './index.css'

installLabelClickGuard()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
