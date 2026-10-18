import { useEffect, useMemo, useState } from 'react'
import type { Syncer } from './server'
import { toRecipe } from './server'
import { PREVIEW_LABEL, decodeState, useAppState } from './storage'
import type { Store } from './store'
import { ServerBadge, WhoAmI, allWebRecipes } from './swipe'
import type { AppState, Filters } from './types'
import { FavoritesView, InspirationView, PeopleView, RandomView, RecipesView } from './views'

type Tab = 'random' | 'recipes' | 'favorites' | 'new' | 'people'

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'random', icon: '🎲', label: 'Slumpa' },
  { id: 'recipes', icon: '📖', label: 'Recept' },
  { id: 'favorites', icon: '♥', label: 'Favoriter' },
  { id: 'new', icon: '✨', label: 'Inspiration' },
  { id: 'people', icon: '👥', label: 'Vi' },
]

const TITLES: Record<Tab, string> = {
  random: 'Vad ska vi äta?',
  recipes: 'Alla recept',
  favorites: 'Favoriter',
  new: 'Inspiration',
  people: 'Våra listor',
}

function readImport(): AppState | undefined {
  const m = location.hash.match(/^#import=(.+)$/)
  if (!m) return undefined
  try {
    return decodeState(m[1])
  } catch {
    return undefined
  }
}

export default function App({ store, syncer }: { store: Store; syncer: Syncer }) {
  const { state, actions, me } = useAppState(store)
  const [tab, setTab] = useState<Tab>('random')
  const [filters, setFilters] = useState<Filters>({ categories: [], who: 'both', source: 'all' })
  const [pendingImport, setPendingImport] = useState(readImport)
  // Rätter ni har matchat på från nätet blir vanliga recept: de kan slumpas, gillas och bli favoriter.
  const recipes = useMemo(
    () => [...store.ownRecipes(), ...store.matches(allWebRecipes(store)).map(toRecipe)].sort((a, b) => a.name.localeCompare(b.name, 'sv')),
    // Räkna om när databasen ändras.
    [store, state],
  )

  useEffect(() => {
    if (location.hash.startsWith('#import=')) history.replaceState(null, '', location.pathname + location.search)
  }, [])

  // Inga pilfunktioner utan klamrar här: nyare Chrome låter scrollTo returnera ett Promise, och React tror då att det
  // är en städfunktion och kraschar när fliken byts.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [tab])

  const rollFrom = (source: Filters['source']) => {
    setFilters({ ...filters, source })
    setTab('random')
  }

  const props = { recipes, state, actions, me }

  return (
    <div className="app">
      <header>
        {PREVIEW_LABEL && (
          <p className="preview-banner">Förhandsvisning av {PREVIEW_LABEL}. Ändringar här påverkar inte den riktiga appen.</p>
        )}
        <div className="header-row">
          <h1>{TITLES[tab]}</h1>
          <ServerBadge store={store} syncer={syncer} onClick={() => setTab('people')} />
        </div>
      </header>

      <main>
        {pendingImport && (
          <div className="panel notice">
            <p>
              Vill du slå ihop listorna från länken ({pendingImport.names.a} och {pendingImport.names.b}) med dem på den här
              enheten?
            </p>
            <div className="row">
              <button
                className="primary"
                onClick={() => {
                  actions.importState(pendingImport)
                  setPendingImport(undefined)
                }}
              >
                Slå ihop
              </button>
              <button onClick={() => setPendingImport(undefined)}>Nej tack</button>
            </div>
          </div>
        )}

        {!store.meta.meChosen && <WhoAmI store={store} state={state} first />}

        {tab === 'random' && <RandomView {...props} filters={filters} setFilters={setFilters} />}
        {tab === 'recipes' && <RecipesView {...props} store={store} />}
        {tab === 'favorites' && <FavoritesView {...props} onRoll={() => rollFrom('favorites')} />}
        {tab === 'new' && <InspirationView {...props} store={store} onRoll={() => rollFrom('new')} />}
        {tab === 'people' && <PeopleView {...props} store={store} syncer={syncer} />}
      </main>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            <span className="tab-icon" aria-hidden>
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
