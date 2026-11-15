import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* BrowserRouter (not HashRouter): Vite's dev server serves index.html
        for unknown paths, so deep links like /transfers/7 work locally. */}
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
