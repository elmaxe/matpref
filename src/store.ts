import type { AppState, Category, PersonId, Rating, Recipe } from './types'
import { CATEGORIES, PERSON_IDS } from './types'

// Den lokala databasen. Allt appen vet sparas här först (IndexedDB), så att den fungerar helt offline.
// Data lagras som nycklar med senaste ändringstid, t.ex. "rating/a/lasagne" = "like" eller "recipe/lasagne" = { name, ... }. Har ni en server synkas nycklarna dit
// (se sync.ts) och den senaste ändringen av varje nyckel vinner, oavsett vilken telefon den kom från.

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export interface Entry {
  key: string
  value: Json
  updatedAt: number
  device: string
  /** Ändrad här men inte synkad till servern än. */
  dirty?: boolean
}

/** Ett recept från nätet: från servern, eller ett av exempelrecepten när ingen server är inkopplad. */
export interface WebRecipe {
  /** "web-12" för serverns recept, "demo-3" för exempelrecept. Samma id används för betyg och favoriter. */
  id: string
  source: string
  url: string
  title: string
  description?: string | null
  image?: string | null
  totalMinutes?: number | null
  servings?: number | null
  category: Category
  /** Platsen i den gemensamma leken. Bestäms av servern, lägst först. */
  rank: number
}

export interface ServerSettings {
  url: string
  token: string
}

export interface Meta {
  deviceId: string
  /** Vem som använder den här telefonen (och swipar). Väljs en gång per telefon, ingen inloggning. */
  me: PersonId
  meChosen?: boolean
  server: ServerSettings
  /** Serverns databas-id och hur långt vi har synkat. */
  databaseId?: string
  cursor: number
  lastSyncedAt?: number
  migrated?: boolean
}

export const isDemo = (id: string) => id.startsWith('demo-')
export const webKey = (serverId: number) => `web-${serverId}`
export const swipeKey = (p: PersonId, id: string) => `swipe/${p}/${id}`
export const recipeKey = (id: string) => `recipe/${id}`

/** Ett recept som det sparas i databasen: utan id (det står i nyckeln) och utan tomma fält. */
export function recipeValue(r: Recipe): Json {
  const v: { [key: string]: Json } = { name: r.name.trim(), category: r.category }
  if (r.description?.trim()) v.description = r.description.trim()
  if (r.timeMinutes) v.timeMinutes = r.timeMinutes
  if (r.servings) v.servings = r.servings
  if (r.tags?.length) v.tags = r.tags
  if (r.ingredients?.length) v.ingredients = r.ingredients
  if (r.steps?.length) v.steps = r.steps
  if (r.link?.trim()) v.link = r.link.trim()
  if (r.image) v.image = r.image
  return v
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined)
const positive = (v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined)

/** Läser ett recept ur databasen. Det kan komma från en annan telefon, så allt kontrolleras. */
export function parseRecipe(id: string, v: Json): Recipe | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined
  if (typeof v.name !== 'string' || !v.name.trim() || !CATEGORIES.some((c) => c.id === v.category)) return undefined
  return {
    id,
    name: v.name,
    category: v.category as Category,
    description: typeof v.description === 'string' ? v.description : undefined,
    timeMinutes: positive(v.timeMinutes),
    servings: positive(v.servings),
    tags: strings(v.tags),
    ingredients: strings(v.ingredients),
    steps: strings(v.steps),
    link: typeof v.link === 'string' ? v.link : undefined,
    image: typeof v.image === 'string' ? v.image : undefined,
  }
}

const same = (a: Json, b: Json) => a === b || (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b))

const randomId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

export const defaultMeta = (): Meta => ({ deviceId: randomId(), me: 'a', server: { url: '', token: '' }, cursor: 0 })

/** Lagring på disk. IndexedDB i webbläsaren, eller bara minnet om den inte går att öppna (t.ex. i tester). */
export interface Backend {
  load(): Promise<{ entries: Entry[]; recipes: WebRecipe[]; meta?: Meta }>
  save(entries: Entry[], recipes: WebRecipe[], meta: Meta): Promise<void>
  clear(): Promise<void>
}

export const memoryBackend = (): Backend => ({
  load: async () => ({ entries: [], recipes: [] }),
  save: async () => {},
  clear: async () => {},
})

export class Store {
  entries = new Map<string, Entry>()
  recipes = new Map<string, WebRecipe>()
  meta: Meta = defaultMeta()
  /** Ökar vid varje ändring, så att React vet när den ska rita om. */
  version = 0
  private listeners = new Set<() => void>()
  private lastTs = 0
  private pendingEntries = new Map<string, Entry>()
  private pendingRecipes = new Map<string, WebRecipe>()
  private saveTimer?: ReturnType<typeof setTimeout>
  private cache?: { version: number; state: AppState }
  private recipeCache?: { version: number; list: Recipe[] }
  private seedList: Recipe[] = []

  constructor(private backend: Backend = memoryBackend()) {}

  async load() {
    const { entries, recipes, meta } = await this.backend.load()
    for (const e of entries) this.entries.set(e.key, e)
    for (const r of recipes) this.recipes.set(r.id, r)
    if (meta) this.meta = { ...defaultMeta(), ...meta, server: { ...defaultMeta().server, ...meta.server } }
    this.lastTs = Math.max(0, ...entries.map((e) => e.updatedAt))
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getVersion = () => this.version

  private changed() {
    this.version++
    for (const fn of this.listeners) fn()
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flush(), 50)
  }

  /** Skriver det som har ändrats till disk. */
  async flush() {
    clearTimeout(this.saveTimer)
    const entries = [...this.pendingEntries.values()]
    const recipes = [...this.pendingRecipes.values()]
    this.pendingEntries.clear()
    this.pendingRecipes.clear()
    await this.backend.save(entries, recipes, this.meta)
  }

  /** En tid som alltid ökar, även om telefonens klocka går fel åt andra hållet efter en synk. */
  private now() {
    this.lastTs = Math.max(Date.now(), this.lastTs + 1)
    return this.lastTs
  }

  get(key: string): Json {
    return this.entries.get(key)?.value ?? null
  }

  set(key: string, value: Json) {
    this.setMany([[key, value]])
  }

  setMany(pairs: [string, Json][]) {
    let any = false
    for (const [key, value] of pairs) {
      if (same(this.get(key), value)) continue
      const e: Entry = { key, value, updatedAt: this.now(), device: this.meta.deviceId, dirty: true }
      this.entries.set(key, e)
      this.pendingEntries.set(key, e)
      any = true
    }
    if (any) this.changed()
  }

  setMeta(patch: Partial<Meta>) {
    this.meta = { ...this.meta, ...patch }
    this.changed()
  }

  /** Ändringar som ska till servern. Exempelreceptens swipes stannar på telefonen. */
  dirtyEntries() {
    return [...this.entries.values()].filter((e) => e.dirty && !isDemo(e.key.split('/').pop()!))
  }

  /** Efter en lyckad synk: det som skickades är inte längre osynkat, om det inte har ändrats igen under tiden. */
  markSynced(sent: Entry[]) {
    for (const s of sent) {
      const e = this.entries.get(s.key)
      if (e && e.updatedAt === s.updatedAt && e.device === s.device && e.dirty) {
        const clean = { ...e, dirty: false }
        this.entries.set(s.key, clean)
        this.pendingEntries.set(s.key, clean)
      }
    }
    this.changed()
  }

  /** Servern är ny eller återställd: skicka upp allt igen. */
  markAllDirty() {
    for (const e of this.entries.values()) {
      const d = { ...e, dirty: true }
      this.entries.set(e.key, d)
      this.pendingEntries.set(e.key, d)
    }
    this.changed()
  }

  /** Tar emot ändringar från servern. Den senaste ändringen av en nyckel vinner. */
  applyRemote(changes: Omit<Entry, 'dirty'>[]) {
    let any = false
    for (const c of changes) {
      this.lastTs = Math.max(this.lastTs, c.updatedAt)
      const local = this.entries.get(c.key)
      if (local && !newer(c, local)) continue
      const e = { ...c, dirty: false }
      this.entries.set(c.key, e)
      this.pendingEntries.set(c.key, e)
      any = true
    }
    if (any) this.changed()
  }

  addRecipes(list: WebRecipe[]) {
    if (list.length === 0) return
    for (const r of list) {
      this.recipes.set(r.id, r)
      this.pendingRecipes.set(r.id, r)
    }
    this.changed()
  }

  /** Rensar allt på den här telefonen. Med server hämtas det som finns där igen vid nästa synk. */
  async reset() {
    const { deviceId, server, me, meChosen } = this.meta
    this.entries.clear()
    this.recipes.clear()
    this.pendingEntries.clear()
    this.pendingRecipes.clear()
    this.meta = { ...defaultMeta(), deviceId, server, me, meChosen, migrated: true }
    await this.backend.clear()
    this.seed(this.seedList)
    this.changed()
  }

  // Recept

  /**
   * Lägger in grundrecepten (recipes/ i repot) i databasen, de som inte redan finns där. De får tiden 1, så att en
   * ändring eller borttagning från någon av telefonerna alltid vinner över dem.
   */
  seed(list: Recipe[]) {
    this.seedList = list
    let any = false
    for (const r of list) {
      const key = recipeKey(r.id)
      if (this.entries.has(key)) continue
      const e: Entry = { key, value: recipeValue(r), updatedAt: 1, device: 'seed', dirty: true }
      this.entries.set(key, e)
      this.pendingEntries.set(key, e)
      any = true
    }
    if (any) this.changed()
  }

  /** Era recept, i bokstavsordning. */
  ownRecipes(): Recipe[] {
    if (this.recipeCache?.version === this.version) return this.recipeCache.list
    const list: Recipe[] = []
    for (const { key, value } of this.entries.values()) {
      if (!key.startsWith('recipe/')) continue
      const r = parseRecipe(key.slice('recipe/'.length), value)
      if (r) list.push(r)
    }
    list.sort((a, b) => a.name.localeCompare(b.name, 'sv'))
    this.recipeCache = { version: this.version, list }
    return list
  }

  /** Sparar ett nytt eller ändrat recept. Ett nytt får ett id av namnet. */
  saveRecipe(r: Omit<Recipe, 'id'> & { id?: string }): string {
    let id = r.id
    if (!id) {
      const base = slug(r.name) || 'ratt'
      id = base
      while (this.entries.has(recipeKey(id))) id = `${base}-${Math.random().toString(36).slice(2, 6)}`
    }
    this.set(recipeKey(id), recipeValue({ ...r, id }))
    return id
  }

  deleteRecipe(id: string) {
    this.set(recipeKey(id), null)
  }

  /** Appens tillstånd i den form resten av appen använder. */
  state(): AppState {
    if (this.cache?.version === this.version) return this.cache.state
    const s: AppState = { version: 1, names: { a: 'Person 1', b: 'Person 2' }, ratings: { a: {}, b: {} }, favorites: [], cooked: {} }
    for (const { key, value } of this.entries.values()) {
      if (value === null) continue
      const [kind, a, b] = key.split('/')
      if (kind === 'name' && isPerson(a) && typeof value === 'string') s.names[a] = value
      else if (kind === 'rating' && isPerson(a) && b && (value === 'like' || value === 'dislike')) s.ratings[a][b] = value
      else if (kind === 'favorite' && a && value === true) s.favorites.push(a)
      else if (kind === 'cooked' && a && typeof value === 'string') s.cooked[a] = value
    }
    this.cache = { version: this.version, state: s }
    return s
  }

  rate(person: PersonId, id: string, rating: Rating) {
    const key = `rating/${person}/${id}`
    this.set(key, this.get(key) === rating ? null : rating)
  }

  toggleFavorite(id: string) {
    this.set(`favorite/${id}`, this.get(`favorite/${id}`) === true ? null : true)
  }

  markCooked(id: string, date: string) {
    this.set(`cooked/${id}`, date)
  }

  rename(person: PersonId, name: string) {
    this.set(`name/${person}`, name.slice(0, 40))
  }

  /** Slår ihop data från en delningslänk: det importerade vinner, utom att senaste lagningsdatum behålls. */
  importState(incoming: AppState) {
    const pairs: [string, Json][] = []
    for (const p of PERSON_IDS) {
      if (incoming.names[p] !== (p === 'a' ? 'Person 1' : 'Person 2')) pairs.push([`name/${p}`, incoming.names[p]])
      for (const [id, r] of Object.entries(incoming.ratings[p])) pairs.push([`rating/${p}/${id}`, r])
    }
    for (const id of incoming.favorites) pairs.push([`favorite/${id}`, true])
    const cooked = this.state().cooked
    for (const [id, d] of Object.entries(incoming.cooked)) if (!cooked[id] || cooked[id] < d) pairs.push([`cooked/${id}`, d])
    this.setMany(pairs)
  }

  // Swipe

  swipe(id: string, liked: boolean | null) {
    this.set(swipeKey(this.meta.me, id), liked)
  }

  /**
   * Leken för den som använder telefonen. Ordningen är densamma för er båda: först det den andra redan har gillat
   * (där kan det bli match direkt), sedan resten efter serverns ordning. Det den andra har sagt nej till visas inte.
   */
  deck(pool: WebRecipe[], category?: Category): WebRecipe[] {
    const me = this.meta.me
    const other = me === 'a' ? 'b' : 'a'
    const partnerAt = (id: string) => this.entries.get(swipeKey(other, id))?.updatedAt ?? 0
    return pool
      .filter((r) => this.get(swipeKey(me, r.id)) === null && this.get(swipeKey(other, r.id)) !== false)
      // Recept servern har tagit bort, t.ex. efterrätter som kom med innan filtret blev bättre.
      .filter((r) => this.get(`hidden/${r.id}`) !== true)
      .filter((r) => !category || r.category === category)
      .sort((x, y) => {
        const px = this.get(swipeKey(other, x.id)) === true
        const py = this.get(swipeKey(other, y.id)) === true
        if (px !== py) return px ? -1 : 1
        if (px) return partnerAt(x.id) - partnerAt(y.id)
        return x.rank - y.rank
      })
  }

  isMatch(id: string) {
    return this.get(swipeKey('a', id)) === true && this.get(swipeKey('b', id)) === true && this.get(`hidden/${id}`) !== true
  }

  /** Recept ni båda har swipat höger på, senaste matchningen först. */
  matches(pool: Iterable<WebRecipe>): WebRecipe[] {
    const at = (id: string) =>
      Math.max(this.entries.get(swipeKey('a', id))?.updatedAt ?? 0, this.entries.get(swipeKey('b', id))?.updatedAt ?? 0)
    return [...pool].filter((r) => this.isMatch(r.id)).sort((x, y) => at(y.id) - at(x.id))
  }

  hideMatch(id: string) {
    this.set(`hidden/${id}`, true)
  }
}

const isPerson = (p: string | undefined): p is PersonId => p === 'a' || p === 'b'

/** "Kycklinggryta med ris" blir "kycklinggryta-med-ris". */
const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

/** Om ändring a är nyare än b. Lika tid avgörs av enhetens id, så att alla telefoner och servern väljer samma. */
export const newer = (a: { updatedAt: number; device: string }, b: { updatedAt: number; device: string }) =>
  a.updatedAt > b.updatedAt || (a.updatedAt === b.updatedAt && a.device > b.device)
