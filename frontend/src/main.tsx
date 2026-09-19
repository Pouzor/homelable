import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import LiveView from './components/LiveView.tsx'
import PublicDocs from './documentation/components/PublicDocs.tsx'
import { isDocsViewPath, isLiveViewPath } from './utils/basePath.ts'

// Three pages share one bundle: the app, the read-only canvas, and the
// read-only documentation. Which one boots is decided by the path alone, before
// any store or session exists.
const isLiveView = isLiveViewPath(window.location.pathname)
const isDocsView = isDocsViewPath(window.location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isLiveView ? <LiveView /> : isDocsView ? <PublicDocs /> : <App />}
  </StrictMode>,
)
