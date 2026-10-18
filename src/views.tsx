import { useEffect, useRef, useState } from 'react'
import { CategoryChips, RecipeCard, RecipeList, Segmented, categoryLabel, displayName } from './components'
import { candidates, isNew, pick } from './random'
import { newRecipeUrl } from './recipes'
import type { Server } from './server'
import { WEB_PREFIX, isConfigured } from './server'
import type { Actions } from './storage'
import { decodeState, encodeState } from './storage'
import type { AppState, Category, Filters, PersonId, Recipe, Source, Who } from './types'
import { PERSON_IDS } from './types'
import { Matches, ServerPanel, SwipeDeck } from './swipe'

interface ViewProps {
  recipes: Recipe[]
  state: AppState
  actions: Actions
}

export function RandomView({
  recipes,
  state,
  actions,
  filters,
  setFilters,
}: ViewProps & { filters: Filters; setFilters: (f: Filters) => void }) {
  const [result, setResult] = useState<Recipe>()
  const [spinning, setSpinning] = useState<string>()
  const [cookedNow, setCookedNow] = useState(false)
  const timer = useRef<number>(undefined)
  const pool = candidates(recipes, state, filters)

  useEffect(() => () => window.clearInterval(timer.current), [])

  const roll = () => {
    const chosen = pick(pool, state, filters, result?.id)
    if (!chosen) return
    setCookedNow(false)
    setResult(undefined)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion || pool.length < 2) {
      setResult(chosen)
      return
    }
    let ticks = 0
    window.clearInterval(timer.current)
    timer.current = window.setInterval(() => {
      ticks++
      if (ticks > 12) {
        window.clearInterval(timer.current)
        setSpinning(undefined)
        setResult(chosen)
        return
      }
      setSpinning(pool[Math.floor(Math.random() * pool.length)].name)
    }, 70)
  }

  const whoOptions: { id: Who; label: string }[] = [
    { id: 'both', label: 'Båda' },
    ...PERSON_IDS.map((p) => ({ id: p as Who, label: displayName(state, p) })),
  ]
  const sourceOptions: { id: Source; label: string }[] = [
    { id: 'all', label: 'Alla' },
    { id: 'favorites', label: 'Favoriter' },
    { id: 'liked', label: 'Gillade' },
    { id: 'new', label: 'Nya' },
  ]

  return (
    <section>
      <div className="panel">
        <div className="field">
          <span className="field-label">Vad blir det?</span>
          <CategoryChips value={filters.categories} onChange={(categories) => setFilters({ ...filters, categories })} />
        </div>
        <Segmented label="Vem äter?" options={whoOptions} value={filters.who} onChange={(who) => setFilters({ ...filters, who })} />
        <Segmented label="Välj bland" options={sourceOptions} value={filters.source} onChange={(source) => setFilters({ ...filters, source })} />
        <p className="meta pool">
          {pool.length === 0 ? 'Inga rätter matchar, prova att ändra urvalet.' : `${pool.length} ${pool.length === 1 ? 'rätt' : 'rätter'} i potten`}
        </p>
        <button className="roll" onClick={roll} disabled={pool.length === 0 || !!spinning}>
          🎲 {result ? 'Slumpa igen' : 'Slumpa!'}
        </button>
      </div>

      {spinning && (
        <div className="spinner" aria-live="polite">
          {spinning}
        </div>
      )}

      {result && !spinning && (
        <div className="result" aria-live="polite">
          <RecipeCard key={result.id} recipe={result} state={state} actions={actions} big />
          <button
            className="primary"
            disabled={cookedNow}
            onClick={() => {
              actions.markCooked(result.id)
              setCookedNow(true)
            }}
          >
            {cookedNow ? 'Smaklig måltid! 🍴' : 'Vi lagar den!'}
          </button>
          {cookedNow && <p className="meta center">Glöm inte att tycka till med 👍 eller 👎 efteråt.</p>}
        </div>
      )}
    </section>
  )
}

export function RecipesView({ recipes, state, actions }: ViewProps) {
  const [query, setQuery] = useState('')
  const [cats, setCats] = useState<Category[]>([])
  const q = query.trim().toLowerCase()
  const list = recipes.filter(
    (r) =>
      (cats.length === 0 || cats.includes(r.category)) &&
      (!q || [r.name, r.description, ...(r.tags ?? []), ...(r.ingredients ?? [])].some((t) => t?.toLowerCase().includes(q))),
  )
  return (
    <section>
      <div className="panel">
        <input
          className="search"
          type="search"
          placeholder="Sök rätt, ingrediens eller tagg"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Sök recept"
        />
        <CategoryChips value={cats} onChange={setCats} />
      </div>
      <RecipeList list={list} state={state} actions={actions} empty="Inga recept matchar sökningen." />
      <AddRecipe />
    </section>
  )
}

function AddRecipe() {
  return (
    <div className="panel add">
      <h3>Saknas en rätt?</h3>
      <p>
        Recepten ligger som filer i <code>recipes/</code> i repot. Lägg till en fil så blir det en pull request, och när den är
        mergad finns rätten i appen.
      </p>
      <a className="button" href={newRecipeUrl} target="_blank" rel="noreferrer">
        Lägg till recept på GitHub ↗
      </a>
    </div>
  )
}

export function FavoritesView({ recipes, state, actions, onRoll }: ViewProps & { onRoll: () => void }) {
  const list = recipes.filter((r) => state.favorites.includes(r.id))
  return (
    <section>
      <div className="panel intro">
        <p>Era gemensamma favoriter. Tryck på ♡ på en rätt för att lägga till den.</p>
        {list.length > 1 && (
          <button className="primary" onClick={onRoll}>
            🎲 Slumpa bland favoriter
          </button>
        )}
      </div>
      <RecipeList list={list} state={state} actions={actions} empty="Inga favoriter än." />
    </section>
  )
}

export function InspirationView({ recipes, state, actions, server, onRoll }: ViewProps & { server: Server; onRoll: () => void }) {
  // Matchningarna visas för sig, så här blir det bara era egna recept.
  const list = recipes.filter((r) => isNew(r, state) && !r.id.startsWith(WEB_PREFIX))
  return (
    <section>
      {isConfigured(server.settings) ? (
        <SwipeDeck server={server} state={state} />
      ) : (
        <div className="panel intro">
          <p>Vill ni swipea recept från nätet och se vad ni båda gillar? Koppla in en server under fliken Vi.</p>
        </div>
      )}
      <Matches server={server} state={state} actions={actions} />
      <h2 className="section-title">Nytt för er</h2>
      <div className="panel intro">
        <p>Rätter som ingen av er har testat eller tyckt till om än. Dags att prova något nytt?</p>
        {list.length > 1 && (
          <button className="primary" onClick={onRoll}>
            ✨ Slumpa något nytt
          </button>
        )}
      </div>
      <RecipeList
        list={list}
        state={state}
        actions={actions}
        empty="Ni har testat allt! Lägg till fler recept via GitHub så dyker de upp här."
      />
      <AddRecipe />
    </section>
  )
}

export function PeopleView({ recipes, state, actions, server }: ViewProps & { server: Server }) {
  return (
    <section>
      {PERSON_IDS.map((p) => (
        <PersonPanel key={p} person={p} recipes={recipes} state={state} actions={actions} />
      ))}
      <ServerPanel server={server} state={state} />
      <SyncPanel state={state} actions={actions} />
    </section>
  )
}

function PersonPanel({ person, recipes, state, actions }: ViewProps & { person: PersonId }) {
  const byRating = (rating: 'like' | 'dislike') => recipes.filter((r) => state.ratings[person][r.id] === rating)
  const name = displayName(state, person)
  return (
    <div className="panel person">
      <label className="field">
        <span className="field-label">Namn</span>
        <input value={state.names[person]} onChange={(e) => actions.rename(person, e.target.value)} placeholder={name} />
      </label>
      {(['like', 'dislike'] as const).map((rating) => {
        const list = byRating(rating)
        return (
          <div key={rating}>
            <h4>
              {rating === 'like' ? `👍 ${name} gillar` : `👎 ${name} gillar inte`} ({list.length})
            </h4>
            {list.length === 0 ? (
              <p className="meta">Inget här än. Tyck till om rätter under Recept.</p>
            ) : (
              <ul className="pref-list">
                {list.map((r) => (
                  <li key={r.id}>
                    <span>
                      {r.name} <span className={`badge cat-${r.category}`}>{categoryLabel(r.category)}</span>
                    </span>
                    <button className="icon-btn small" aria-label={`Ta bort ${r.name}`} onClick={() => actions.rate(person, r.id, rating)}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SyncPanel({ state, actions }: { state: AppState; actions: Actions }) {
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  const link = `${location.origin}${location.pathname}#import=${encodeState(state)}`

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Matpref', text: 'Våra matlistor', url: link })
      else {
        await navigator.clipboard.writeText(link)
        setMsg('Länken är kopierad.')
      }
    } catch {
      // Användaren avbröt delningen.
    }
  }

  const doImport = () => {
    try {
      const value = code.includes('#import=') ? code.split('#import=')[1] : code
      actions.importState(decodeState(value))
      setCode('')
      setMsg('Klart! Listorna är ihopslagna.')
    } catch {
      setMsg('Koden gick inte att läsa.')
    }
  }

  return (
    <div className="panel">
      <h3>Synka mellan telefoner</h3>
      <p className="meta">
        Listorna sparas bara på den här enheten. Dela en länk till den andra telefonen och öppna den där, så slås listorna ihop.
      </p>
      <button className="primary" onClick={share}>
        Dela mina listor
      </button>
      <label className="field">
        <span className="field-label">Eller klistra in en länk eller kod</span>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="https://…#import=…" />
      </label>
      <button onClick={doImport} disabled={!code.trim()}>
        Importera
      </button>
      {msg && <p className="meta">{msg}</p>}
      <button
        className="danger"
        onClick={() => {
          if (confirm('Rensa alla listor, favoriter och namn på den här enheten?')) actions.reset()
        }}
      >
        Rensa allt på den här enheten
      </button>
    </div>
  )
}
