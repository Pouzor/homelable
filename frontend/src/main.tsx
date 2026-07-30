import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import LiveView from './components/LiveView.tsx'
import RackLab from './rack/components/RackLab.tsx'

const isLiveView = window.location.pathname === '/view'
// Front-only rack canvas prototype — no backend, no persistence.
const isRackLab = window.location.pathname === '/racklab'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isLiveView ? <LiveView /> : isRackLab ? <RackLab /> : <App />}
  </StrictMode>,
)
