import { useSyncExternalStore } from 'react'
import type { Entry, ServerSettings, Store, WebRecipe } from './store'
import { webKey } from './store'
import type { Category, Recipe } from './types'

// Synk mot er egen server (se server/ i repot). Appen fungerar helt utan den; servern gör att två telefoner delar data
// och att det finns recept från nätet att swipea.

/** Ett recept som servern skickar. */
interface Card {
  id: number
  source: string
  url: string
  title: string
  description?: string | null
  image?: string | null
  totalMinutes?: number | null
  servings?: number | null
  category: Category
  rank: number
}

interface SyncResponse {
  databaseId: string
  cursor: number
  changes: Omit<Entry, 'dirty'>[]
  more: boolean
}

export interface Health {
  ok: boolean
  recipes: Record<string, number>
  importing: boolean
}

export const isConfigured = (s: ServerSettings) => s.url.trim() !== ''

/** En https-sida (som GitHub Pages) får inte anropa en http-adress. Webbläsaren stoppar det innan det når servern. */
export function mixedContentProblem(url: string): string | undefined {
  if (location.protocol !== 'https:' || !/^http:\/\//i.test(url.trim())) return undefined
  try {
    const host = new URL(url.trim()).hostname
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return undefined
  } catch {
    return 'Adressen ser inte giltig ut.'
  }
  return 'Appen körs över https, och då blockerar webbläsaren anrop till en http-adress. Servern behöver en https-adress, se README i server/.'
}

export class ApiError extends Error {}

async function call<T>(s: ServerSettings, path: string, init?: RequestInit): Promise<T> {
  const base = s.url.trim().replace(/\/+$/, '')
  let res: Response
  try {
    res = await fetch(`${base}/api${path}`, {
      ...init,
      headers: {
        ...(s.token ? { 'X-Matpref-Token': s.token } : {}),
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
  } catch {
    throw new ApiError(mixedContentProblem(base) ?? (navigator.onLine ? 'Kunde inte nå servern.' : 'Du är offline.'))
  }
  if (res.status === 401) throw new ApiError('Servern vill ha en annan nyckel.')
  if (!res.ok) throw new ApiError(`Servern svarade ${res.status}.`)
  return (await res.json()) as T
}

export const health = (s: ServerSettings) => call<Health>(s, '/health')

export interface Version {
  /** Commitens korta hash, eller "dev". */
  version: string
  built?: string | null
}

/** Appens egen version, satt när den byggdes. */
export const appVersion: Version = { version: __APP_VERSION__, built: __APP_BUILT__ }

const toWebRecipe = (c: Card): WebRecipe => ({ ...c, id: webKey(c.id) })

/** Gör om ett recept från nätet till ett vanligt recept, så att det kan slumpas, gillas och bli favorit som de andra. */
export const toRecipe = (r: WebRecipe): Recipe => ({
  id: r.id,
  name: r.title,
  category: r.category,
  description: r.description ?? undefined,
  timeMinutes: r.totalMinutes ?? undefined,
  servings: r.servings ?? undefined,
  link: r.url,
  image: r.image ?? undefined,
  source: r.source,
})

export interface SyncStatus {
  state: 'off' | 'syncing' | 'ok' | 'error'
  message?: string
  /** Om senaste synken nådde servern. Ligger kvar medan nästa synk pågår, så att statusen inte blinkar. */
  connected?: boolean
  /** Serverns version, från senaste lyckade synken. */
  server?: Version
}

/** Synkar den lokala databasen med servern: när något ändras, när appen kommer tillbaka i förgrunden och en gång i minuten. */
export class Syncer {
  status: SyncStatus = { state: 'off' }
  private listeners = new Set<() => void>()
  private running?: Promise<void>
  private again = false
  private timer?: ReturnType<typeof setTimeout>
  private lastServer = ''
  private statusFor = ''

  constructor(private store: Store) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getStatus = () => this.status

  private setStatus(status: SyncStatus) {
    this.status = status
    for (const fn of this.listeners) fn()
  }

  start() {
    const soon = () => {
      clearTimeout(this.timer)
      this.timer = setTimeout(() => void this.sync(), 1000)
    }
    const unsubscribe = this.store.subscribe(() => {
      const server = JSON.stringify(this.store.meta.server)
      if (server !== this.lastServer) {
        this.lastServer = server
        void this.sync()
      } else if (this.store.dirtyEntries().length > 0) soon()
    })
    const onVisible = () => document.visibilityState === 'visible' && void this.sync()
    const onOnline = () => void this.sync()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    const interval = setInterval(() => document.visibilityState === 'visible' && void this.sync(), 60_000)
    this.lastServer = JSON.stringify(this.store.meta.server)
    void this.sync()
    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      clearInterval(interval)
      clearTimeout(this.timer)
    }
  }

  /** Synkar nu. Pågår en synk redan körs en till direkt efteråt. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = this.run().finally(() => {
      this.running = undefined
      if (this.again) {
        this.again = false
        void this.sync()
      }
    })
    return this.running
  }

  private async run() {
    const settings = this.store.meta.server
    if (!isConfigured(settings)) return this.setStatus({ state: 'off' })
    const before = JSON.stringify(settings)
    const prev = this.status
    // Byttes servern ut gäller inte förra statusen längre.
    const same = prev.state !== 'off' && this.statusFor === before
    this.statusFor = before
    this.setStatus({ state: 'syncing', connected: same ? prev.connected : undefined, server: same ? prev.server : undefined })
    try {
      // Skicka det som ändrats här och ta emot allt nytt från servern, tills båda är ikapp.
      for (let round = 0; round < 50; round++) {
        const sent = this.store.dirtyEntries().slice(0, 1000)
        const res = await call<SyncResponse>(settings, '/sync', {
          method: 'POST',
          body: JSON.stringify({
            databaseId: this.store.meta.databaseId,
            cursor: this.store.meta.cursor,
            changes: sent.map(({ key, value, updatedAt, device }) => ({ key, value, updatedAt, device })),
          }),
        })
        const knownBefore = this.store.meta.databaseId
        this.store.applyRemote(res.changes)
        this.store.markSynced(sent)
        this.store.setMeta({ databaseId: res.databaseId, cursor: res.cursor })
        // En ny eller återställd server: skicka upp allt vi har.
        if (knownBefore && knownBefore !== res.databaseId) this.store.markAllDirty()
        if (!res.more && this.store.dirtyEntries().length === 0) break
      }
      // Nya recept från nätet, så att leken finns offline.
      for (let round = 0; round < 50; round++) {
        const after = Math.max(0, ...[...this.store.recipes.keys()].filter((k) => k.startsWith('web-')).map((k) => Number(k.slice(4))))
        const res = await call<{ recipes: Card[]; more: boolean }>(settings, `/recipes?after=${after}&limit=500`)
        this.store.addRecipes(res.recipes.map(toWebRecipe))
        if (!res.more) break
      }
      // En äldre server utan /version räknas ändå som ansluten.
      const server = await call<Version>(settings, '/version').catch(() => undefined)
      this.store.setMeta({ lastSyncedAt: Date.now() })
      this.setStatus({ state: 'ok', connected: true, server })
    } catch (e) {
      this.setStatus({
        state: 'error',
        message: e instanceof ApiError ? e.message : 'Synken misslyckades.',
        connected: false,
        server: this.status.server,
      })
    }
  }
}

export function useSyncStatus(syncer: Syncer) {
  return useSyncExternalStore(syncer.subscribe, syncer.getStatus)
}
