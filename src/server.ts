import { useCallback, useEffect, useState } from 'react'
import type { Category, PersonId, Recipe } from './types'

// Servern (se server/ i repot) håller leken med recept från nätet och era swipes. Allt annat i appen fungerar utan den.

export interface ServerSettings {
  url: string
  token: string
  me: PersonId
}

/** Ett recept från servern. Bara metadata och en länk till originalet. */
export interface Card {
  id: number
  source: string
  url: string
  title: string
  description?: string | null
  image?: string | null
  totalMinutes?: number | null
  servings?: number | null
  category: Category
}

export interface MatchItem {
  recipe: Card
  matchedAt: string
}

export interface Health {
  ok: boolean
  recipes: Record<string, number>
  importing: boolean
}

const SETTINGS_KEY = 'matpref:server'
const MATCHES_KEY = 'matpref:matches'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Privat läge eller full lagring.
  }
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
  return (res.status === 204 ? undefined : await res.json()) as T
}

export const api = {
  health: (s: ServerSettings) => call<Health>(s, '/health'),
  deck: (s: ServerSettings, category?: Category, limit = 20) =>
    call<{ cards: Card[]; remaining: number }>(
      s,
      `/deck?user=${s.me}&limit=${limit}${category ? `&category=${category}` : ''}`,
    ),
  swipe: (s: ServerSettings, recipeId: number, liked: boolean) =>
    call<{ match: Card | null }>(s, '/swipes', { method: 'POST', body: JSON.stringify({ user: s.me, recipeId, liked }) }),
  undo: (s: ServerSettings, recipeId: number) => call<void>(s, `/swipes/${s.me}/${recipeId}`, { method: 'DELETE' }),
  matches: (s: ServerSettings) => call<MatchItem[]>(s, '/matches'),
  removeMatch: (s: ServerSettings, recipeId: number) => call<void>(s, `/matches/${recipeId}`, { method: 'DELETE' }),
}

export const WEB_PREFIX = 'web-'

/** Gör om en matchning till ett vanligt recept, så att den kan slumpas, gillas och bli favorit som de andra. */
export const toRecipe = (c: Card): Recipe => ({
  id: `${WEB_PREFIX}${c.id}`,
  name: c.title,
  category: c.category,
  description: c.description ?? undefined,
  timeMinutes: c.totalMinutes ?? undefined,
  servings: c.servings ?? undefined,
  link: c.url,
  image: c.image ?? undefined,
  source: c.source,
})

export function useServer() {
  const [settings, setSettingsState] = useState<ServerSettings>(() => read(SETTINGS_KEY, { url: '', token: '', me: 'a' }))
  // Matchningarna sparas lokalt också, så att de finns kvar offline och i slumpen.
  const [matches, setMatches] = useState<MatchItem[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(MATCHES_KEY) ?? '[]')
      return Array.isArray(raw) ? raw : []
    } catch {
      return []
    }
  })

  const setSettings = useCallback((s: ServerSettings) => {
    setSettingsState(s)
    write(SETTINGS_KEY, s)
  }, [])

  const storeMatches = useCallback((m: MatchItem[]) => {
    setMatches(m)
    write(MATCHES_KEY, m)
  }, [])

  const refreshMatches = useCallback(async () => {
    if (!isConfigured(settings)) return
    try {
      storeMatches(await api.matches(settings))
    } catch {
      // Behåll de sparade matchningarna.
    }
  }, [settings, storeMatches])

  const removeMatch = useCallback(
    async (recipeId: number) => {
      await api.removeMatch(settings, recipeId)
      storeMatches(matches.filter((m) => m.recipe.id !== recipeId))
    },
    [settings, matches, storeMatches],
  )

  // Hämta när appen öppnas och när den kommer tillbaka i förgrunden, så att den andras matchningar dyker upp.
  useEffect(() => {
    void refreshMatches()
    const onVisible = () => document.visibilityState === 'visible' && void refreshMatches()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshMatches])

  return { settings, setSettings, matches, refreshMatches, removeMatch }
}

export type Server = ReturnType<typeof useServer>
