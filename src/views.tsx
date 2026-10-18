import type { FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { CategoryChips, RecipeCard, RecipeForm, RecipeList, Segmented, categoryLabel, displayName } from './components'
import { candidates, isNew, pick } from './random'
import type { NewRecipe, Syncer } from './server'
import { ApiError, fetchRecipe, isConfigured } from './server'
import type { Store } from './store'
import type { Actions } from './storage'
import { decodeState, encodeState } from './storage'
import type { AppState, Category, Filters, PersonId, Recipe, Source, Who } from './types'
import { PERSON_IDS } from './types'
import { Matches, ServerPanel, SwipeDeck, WhoAmI } from './swipe'

interface ViewProps {
  recipes: Recipe[]
  state: AppState
  actions: Actions
  me: PersonId
}

export function RandomView({
  recipes,
  state,
  actions,
  me,
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
          <RecipeCard key={result.id} recipe={result} state={state} actions={actions} me={me} big />
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

export function RecipesView({ recipes, state, actions, me, store }: ViewProps & { store: Store }) {
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
      <RecipeList list={list} state={state} actions={actions} me={me} empty="Inga recept matchar sökningen." />
      <AddRecipe store={store} actions={actions} />
    </section>
  )
}

/**
 * Lägg till en egen rätt: från en länk (servern hämtar sidan och fyller i formuläret) eller för hand. Den sparas i
 * databasen och synkas till den andra telefonen som allt annat.
 */
function AddRecipe({ store, actions }: { store: Store; actions: Actions }) {
  const [draft, setDraft] = useState<NewRecipe>()
  const [link, setLink] = useState('')
  const [fetching, setFetching] = useState(false)
  const [message, setMessage] = useState<string>()
  const server = store.meta.server

  const fetchLink = async (e: FormEvent) => {
    e.preventDefault()
    if (!link.trim()) return
    setFetching(true)
    setMessage(undefined)
    try {
      setDraft(await fetchRecipe(server, link))
      setLink('')
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Kunde inte hämta receptet.')
    } finally {
      setFetching(false)
    }
  }

  if (draft) {
    return (
      <div className="panel">
        <h3>{draft.name ? 'Stämmer det?' : 'Ny rätt'}</h3>
        {draft.link && <p className="meta">Hämtat från {new URL(draft.link).hostname.replace(/^www\./, '')}. Ändra det du vill och spara.</p>}
        <RecipeForm
          recipe={draft}
          onSave={(r) => {
            actions.saveRecipe(r)
            setMessage(`${r.name} är tillagd.`)
            setDraft(undefined)
          }}
          onCancel={() => setDraft(undefined)}
        />
      </div>
    )
  }
  return (
    <div className="panel add">
      <h3>Saknas en rätt?</h3>
      {isConfigured(server) ? (
        <form className="row" onSubmit={fetchLink}>
          <input
            type="url"
            inputMode="url"
            placeholder="Klistra in en länk, t.ex. från ICA"
            aria-label="Länk till ett recept"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <button type="submit" className="primary" disabled={!link.trim() || fetching}>
            {fetching ? 'Hämtar…' : 'Hämta'}
          </button>
        </form>
      ) : (
        <p className="meta">Med en server kan du klistra in en länk till ett recept, t.ex. från ICA, och få det ifyllt.</p>
      )}
      {message && <p className="meta">{message}</p>}
      <button onClick={() => setDraft({ name: '', category: 'fast' })}>Skriv in själv</button>
    </div>
  )
}

export function FavoritesView({ recipes, state, actions, me, onRoll }: ViewProps & { onRoll: () => void }) {
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
      <RecipeList list={list} state={state} actions={actions} me={me} empty="Inga favoriter än." />
    </section>
  )
}

export function InspirationView({ recipes, state, actions, me, store, onRoll }: ViewProps & { store: Store; onRoll: () => void }) {
  // Matchningarna från nätet visas för sig, så här blir det bara era egna recept.
  const list = recipes.filter((r) => isNew(r, state) && !r.source)
  return (
    <section>
      <SwipeDeck store={store} state={state} />
      <Matches store={store} state={state} actions={actions} />
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
        me={me}
        empty="Ni har testat allt! Lägg till fler rätter under Recept så dyker de upp här."
      />
      <AddRecipe store={store} actions={actions} />
    </section>
  )
}

export function PeopleView({ recipes, state, actions, me, store, syncer }: ViewProps & { store: Store; syncer: Syncer }) {
  return (
    <section>
      <WhoAmI store={store} state={state} />
      {PERSON_IDS.map((p) => (
        <PersonPanel key={p} person={p} recipes={recipes} state={state} actions={actions} me={me} />
      ))}
      <ServerPanel store={store} syncer={syncer} />
      <SyncPanel state={state} actions={actions} />
    </section>
  )
}

function PersonPanel({ person, recipes, state, actions, me }: ViewProps & { person: PersonId }) {
  const byRating = (rating: 'like' | 'dislike') => recipes.filter((r) => state.ratings[person][r.id] === rating)
  const name = displayName(state, person)
  // Den andras namn och betyg visas, men bara den själv kan ändra dem.
  const mine = person === me
  return (
    <div className="panel person">
      {mine ? (
        <label className="field">
          <span className="field-label">Ditt namn</span>
          <input value={state.names[person]} onChange={(e) => actions.rename(e.target.value)} placeholder={name} />
        </label>
      ) : (
        <h3>{name}</h3>
      )}
      {(['like', 'dislike'] as const).map((rating) => {
        const list = byRating(rating)
        return (
          <div key={rating}>
            <h4>
              {rating === 'like' ? `👍 ${name} gillar` : `👎 ${name} gillar inte`} ({list.length})
            </h4>
            {list.length === 0 ? (
              <p className="meta">{mine ? 'Inget här än. Tyck till om rätter under Recept.' : 'Inget här än.'}</p>
            ) : (
              <ul className="pref-list">
                {list.map((r) => (
                  <li key={r.id}>
                    <span>
                      {r.name} <span className={`badge cat-${r.category}`}>{categoryLabel(r.category)}</span>
                    </span>
                    {mine && (
                      <button className="icon-btn small" aria-label={`Ta bort ${r.name}`} onClick={() => actions.rate(r.id, rating)}>
                        ✕
                      </button>
                    )}
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
      <h3>Dela utan server</h3>
      <p className="meta">
        Utan server finns listorna bara på den här telefonen. Dela en länk till den andra telefonen och öppna den där, så slås
        listorna ihop.
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
          if (confirm('Rensa alla listor, favoriter, swipes och namn på den här enheten? Med server hämtas det som finns där igen.')) actions.reset()
        }}
      >
        Rensa allt på den här enheten
      </button>
    </div>
  )
}
