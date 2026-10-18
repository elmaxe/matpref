import { useCallback, useEffect, useState } from 'react'
import type { AppState, PersonId, Rating } from './types'
import { PERSON_IDS } from './types'

export const PREVIEW_LABEL: string | undefined = import.meta.env.VITE_PREVIEW_LABEL

const MAIN_KEY = 'matpref:v1'
// En förhandsvisning delar localStorage med den riktiga appen (samma domän), så den sparar under en egen nyckel
// men startar med en kopia av era riktiga listor.
const KEY = PREVIEW_LABEL ? `${MAIN_KEY}:${import.meta.env.BASE_URL}` : MAIN_KEY

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

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY) ?? (KEY !== MAIN_KEY ? localStorage.getItem(MAIN_KEY) : null)
    return raw ? sanitize(JSON.parse(raw)) : emptyState()
  } catch {
    return emptyState()
  }
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

export function useAppState() {
  const [state, setState] = useState<AppState>(load)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      // Privat läge eller full lagring: appen fungerar ändå, men sparar inte.
    }
  }, [state])

  const rate = useCallback((person: PersonId, id: string, rating: Rating) => {
    setState((s) => {
      const mine = { ...s.ratings[person] }
      if (mine[id] === rating) delete mine[id]
      else mine[id] = rating
      return { ...s, ratings: { ...s.ratings, [person]: mine } }
    })
  }, [])

  const toggleFavorite = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      favorites: s.favorites.includes(id) ? s.favorites.filter((f) => f !== id) : [...s.favorites, id],
    }))
  }, [])

  const markCooked = useCallback((id: string) => {
    setState((s) => ({ ...s, cooked: { ...s.cooked, [id]: today() } }))
  }, [])

  const rename = useCallback((person: PersonId, name: string) => {
    setState((s) => ({ ...s, names: { ...s.names, [person]: name.slice(0, 40) } }))
  }, [])

  const importState = useCallback((incoming: AppState) => setState((s) => merge(s, incoming)), [])
  const reset = useCallback(() => setState(emptyState()), [])

  return { state, rate, toggleFavorite, markCooked, rename, importState, reset }
}

export type Actions = Omit<ReturnType<typeof useAppState>, 'state'>
