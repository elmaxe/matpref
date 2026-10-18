import { useMemo, useSyncExternalStore } from 'react'
import { openDb, idbBackend, readAll } from './idb'
import { Store } from './store'
import type { AppState, PersonId, Rating } from './types'
import { PERSON_IDS } from './types'

export const PREVIEW_LABEL: string | undefined = import.meta.env.VITE_PREVIEW_LABEL

// Där listorna låg innan appen fick sin lokala databas. Läses bara en gång, för att flytta över dem.
const MAIN_KEY = 'matpref:v1'

export const emptyState = (): AppState => ({
  version: 1,
  names: { a: 'Person 1', b: 'Person 2' },
  ratings: { a: {}, b: {} },
  favorites: [],
  cooked: {},
})

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Tar emot okänd data (localStorage eller import) och gör om den till ett giltigt tillstånd. */
export function sanitize(raw: unknown): AppState {
  const s = emptyState()
  if (!isRecord(raw)) return s
  for (const p of PERSON_IDS) {
    const name = isRecord(raw.names) ? raw.names[p] : undefined
    if (typeof name === 'string' && name.trim()) s.names[p] = name.trim().slice(0, 40)
    const ratings = isRecord(raw.ratings) ? raw.ratings[p] : undefined
    if (isRecord(ratings)) {
      for (const [id, r] of Object.entries(ratings)) if (r === 'like' || r === 'dislike') s.ratings[p][id] = r
    }
  }
  if (Array.isArray(raw.favorites)) s.favorites = [...new Set(raw.favorites.filter((f): f is string => typeof f === 'string'))]
  if (isRecord(raw.cooked)) {
    for (const [id, d] of Object.entries(raw.cooked)) if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) s.cooked[id] = d
  }
  return s
}

/** Slår ihop importerad data med den lokala. Vid krock vinner det importerade, utom att senaste lagningsdatum behålls. */
export function merge(local: AppState, incoming: AppState): AppState {
  const defaults = emptyState().names
  const out = sanitize(local)
  for (const p of PERSON_IDS) {
    if (incoming.names[p] !== defaults[p]) out.names[p] = incoming.names[p]
    out.ratings[p] = { ...local.ratings[p], ...incoming.ratings[p] }
  }
  out.favorites = [...new Set([...local.favorites, ...incoming.favorites])]
  for (const [id, d] of Object.entries(incoming.cooked)) if (!out.cooked[id] || out.cooked[id] < d) out.cooked[id] = d
  return out
}

export function encodeState(state: AppState): string {
  const bytes = new TextEncoder().encode(JSON.stringify(state))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeState(code: string): AppState {
  const b64 = code.trim().replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return sanitize(JSON.parse(new TextDecoder().decode(bytes)))
}

export const today = () => new Date().toLocaleDateString('sv-SE')

const DB_NAME = PREVIEW_LABEL ? `matpref:${import.meta.env.BASE_URL}` : 'matpref'

function readLocal(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

/**
 * Öppnar den lokala databasen. Första gången flyttas det som tidigare låg i localStorage hit. En förhandsvisning startar
 * med en kopia av den riktiga appens data, men utan serverinställningar, så att den inte synkar om du inte ber den.
 */
export async function openStore(): Promise<Store> {
  let store: Store
  try {
    store = new Store(idbBackend(await openDb(DB_NAME)))
    await store.load()
  } catch {
    // Ingen IndexedDB (t.ex. vissa privata lägen): appen fungerar, men glömmer allt när den stängs.
    store = new Store()
  }
  if (store.meta.migrated) return store

  let copied = false
  if (PREVIEW_LABEL) {
    try {
      const main = await readAll(await openDb('matpref'))
      if (main.meta?.migrated) {
        store.applyRemote(main.entries)
        store.markAllDirty()
        store.addRecipes(main.recipes)
        store.setMeta({ me: main.meta.me, meChosen: main.meta.meChosen })
        copied = true
      }
    } catch {
      // Ingen riktig app att kopiera från.
    }
  }
  if (!copied) {
    const old = readLocal(PREVIEW_LABEL ? `${MAIN_KEY}:${import.meta.env.BASE_URL}` : MAIN_KEY) ?? readLocal(MAIN_KEY)
    if (old) store.importState(sanitize(old))
    const server = readLocal('matpref:server') as { url?: string; token?: string; me?: PersonId } | undefined
    if (!PREVIEW_LABEL && server?.url) store.setMeta({ server: { url: server.url, token: server.token ?? '' } })
    if (server?.me === 'a' || server?.me === 'b') store.setMeta({ me: server.me, meChosen: true })
  }
  store.setMeta({ migrated: true })
  await store.flush()
  return store
}

/** Appens tillstånd och åtgärder, ovanpå den lokala databasen. */
export function useAppState(store: Store) {
  useSyncExternalStore(store.subscribe, store.getVersion)
  const state = store.state()
  const actions = useMemo(
    () => ({
      rate: (person: PersonId, id: string, rating: Rating) => store.rate(person, id, rating),
      toggleFavorite: (id: string) => store.toggleFavorite(id),
      markCooked: (id: string) => store.markCooked(id, today()),
      rename: (person: PersonId, name: string) => store.rename(person, name),
      importState: (incoming: AppState) => store.importState(incoming),
      reset: () => void store.reset(),
    }),
    [store],
  )
  return { state, actions }
}

export type Actions = ReturnType<typeof useAppState>['actions']
