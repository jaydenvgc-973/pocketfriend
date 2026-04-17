// Lock to portrait — ignore rotation to prevent state resets
if (typeof screen !== 'undefined' && screen.orientation?.lock) {
  screen.orientation.lock('portrait').catch(() => {});
}

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)