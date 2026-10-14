import { ErrorBoundary } from './ErrorBoundary'
import { createRoot } from 'react-dom/client'
import App from './App'
import { lazy, Suspense } from 'react'
const LivePhone = lazy(() => import('./live/LivePhone'))
import './styles.css'
import './ui/chrome.css'
createRoot(document.getElementById('root')!).render(<ErrorBoundary label="app">{location.pathname.replace(/\/$/, '') === '/live' ? <Suspense fallback={null}><LivePhone /></Suspense> : <App />}</ErrorBoundary>)
