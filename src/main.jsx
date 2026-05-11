import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import PreviewGate from './components/PreviewGate.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <PreviewGate>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </PreviewGate>
    </ErrorBoundary>
  </React.StrictMode>,
)
