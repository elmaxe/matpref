import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { Syncer } from './server'
import { openStore } from './storage'
import './styles.css'

registerSW({ immediate: true })

const store = await openStore()
const syncer = new Syncer(store)
syncer.start()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App store={store} syncer={syncer} />
  </StrictMode>,
)
