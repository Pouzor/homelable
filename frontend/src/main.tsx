import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import LiveView from './components/LiveView.tsx'
import { isLiveViewPath } from './utils/basePath.ts'

const isLiveView = isLiveViewPath(window.location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isLiveView ? <LiveView /> : <App />}
  </StrictMode>,
)
