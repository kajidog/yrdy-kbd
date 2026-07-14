import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initializeBrowserLogger } from '@yrdy-kbd/web-shared'
import './index.css'
import App from './app/App.tsx'

initializeBrowserLogger({
  clientToken: import.meta.env.VITE_DD_CLIENT_TOKEN,
  site: import.meta.env.VITE_DD_SITE,
  service: 'yrdy-kbd-viewer',
  environment: import.meta.env.VITE_DD_ENV,
  version: import.meta.env.VITE_DD_VERSION,
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
