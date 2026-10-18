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

/**
 * Gör om det som skrevs i adressfältet till serverns basadress: "matpref.example.se/api/health" blir
 * "https://matpref.example.se". Utan https:// skulle webbläsaren tolka adressen som en sökväg på GitHub Pages.
 */
export function normalizeUrl(url: string) {
  const u = url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api(\/.*)?$/i, '')
  if (!u) return ''
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : `https://${u}`
}

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
  const base = normalizeUrl(s.url)
  // Ett "enkelt" anrop enligt CORS: inga egna headers och JSON skickad som text/plain. Då skickar webbläsaren anropet
  // direkt i stället för att först fråga servern (en preflight), som vissa webbläsare och proxyer inte släpper igenom.
  let res: Response
  try {
    const url = new URL(`${base}/api${path}`)
    if (s.token) url.searchParams.set('token', s.token)
    res = await fetch(url, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'text/plain;charset=UTF-8' } : {},
    })
  } catch {
    throw new ApiError(mixedContentProblem(base) ?? (navigator.onLine ? await whyUnreachable(base) : 'Du är offline.'))
  }
  if (res.status === 401) throw new ApiError('Servern vill ha en annan nyckel.')
  if (!res.ok) {
    const body = (await res.json().catch(() => undefined)) as { error?: string } | undefined
    throw new ApiError(body?.error ? `${body.error}.` : `Servern svarade ${res.status}.`)
  }
  return (await res.json()) as T
}

/**
 * Webbläsaren säger bara "failed to fetch", oavsett orsak. Ett anrop utan CORS skiljer på om servern inte går att nå
 * alls från den här enheten, eller om den svarar men webbläsaren stoppar svaret.
 */
async function whyUnreachable(base: string) {
  let host = base
  try {
    host = new URL(base).host
    await fetch(`${base}/healthz`, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(5000) })
    return `${host} svarar, men webbläsaren stoppade svaret. Kolla serverns logg efter fel, och att Matpref__AllowedOrigins__0 är ${location.origin}.`
  } catch {
    return `Den här enheten når inte ${host}. Är Tailscale på? I Chrome kan sidan också behöva tillåtelse att nå enheter i lokala nätverket (under låset bredvid adressen).`
  }
}

export type NewRecipe = Omit<Recipe, 'id'>

/** Låter servern hämta ett recept från en länk (t.ex. ICA). Webbläsaren får inte läsa andra sajter själv. */
export async function fetchRecipe(s: ServerSettings, link: string): Promise<NewRecipe> {
  const r = await call<NewRecipe & { [key: string]: unknown }>(s, `/fetch-recipe?url=${encodeURIComponent(link.trim())}`)
  return {
    name: r.name,
    category: r.category,
    description: r.description ?? undefined,
    image: r.image ?? undefined,
    timeMinutes: r.timeMinutes ?? undefined,
    servings: r.servings ?? undefined,
    ingredients: r.ingredients,
    steps: r.steps,
    tags: r.tags,
    link: r.link,
  }
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
