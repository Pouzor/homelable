import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import LiveView from './components/LiveView.tsx'

const isLiveView = window.location.pathname === '/view'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isLiveView ? <LiveView /> : <App />}
  </StrictMode>,
)
