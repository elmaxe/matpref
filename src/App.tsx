import { useEffect, useState } from 'react'
import { recipes } from './recipes'
import { decodeState, useAppState } from './storage'
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

export default function App() {
  const { state, ...actions } = useAppState()
  const [tab, setTab] = useState<Tab>('random')
  const [filters, setFilters] = useState<Filters>({ categories: [], who: 'both', source: 'all' })
  const [pendingImport, setPendingImport] = useState(readImport)

  useEffect(() => {
    if (location.hash.startsWith('#import=')) history.replaceState(null, '', location.pathname + location.search)
  }, [])

  useEffect(() => window.scrollTo(0, 0), [tab])

  const rollFrom = (source: Filters['source']) => {
    setFilters({ ...filters, source })
    setTab('random')
  }

  const props = { recipes, state, actions }

  return (
    <div className="app">
      <header>
        <h1>{TITLES[tab]}</h1>
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

        {tab === 'random' && <RandomView {...props} filters={filters} setFilters={setFilters} />}
        {tab === 'recipes' && <RecipesView {...props} />}
        {tab === 'favorites' && <FavoritesView {...props} onRoll={() => rollFrom('favorites')} />}
        {tab === 'new' && <InspirationView {...props} onRoll={() => rollFrom('new')} />}
        {tab === 'people' && <PeopleView {...props} />}
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
