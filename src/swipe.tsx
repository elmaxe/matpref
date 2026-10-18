import { useCallback, useEffect, useRef, useState } from 'react'
import { RecipeCard, Segmented, categoryLabel, displayName } from './components'
import type { Card, Health, Server } from './server'
import { ApiError, api, isConfigured, mixedContentProblem, toRecipe } from './server'
import type { Actions } from './storage'
import type { AppState, Category } from './types'
import { CATEGORIES, PERSON_IDS } from './types'

const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Något gick fel.')

/** Kortleken från servern. Swipea höger på det du vill äta; gillar ni båda samma rätt blir det en match. */
export function SwipeDeck({ server, state }: { server: Server; state: AppState }) {
  const { settings, refreshMatches } = server
  const [category, setCategory] = useState<Category | 'all'>('all')
  const [cards, setCards] = useState<Card[]>([])
  const [remaining, setRemaining] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [last, setLast] = useState<Card>()
  const [match, setMatch] = useState<Card>()
  const [dx, setDx] = useState(0)
  const [leaving, setLeaving] = useState<'left' | 'right'>()
  const drag = useRef<{ x: number; id: number }>(undefined)
  // Kort som är swipade men där servern inte har svarat än, så att de inte kommer tillbaka när leken fylls på.
  const pending = useRef(new Set<number>())
  const cardsRef = useRef(cards)
  cardsRef.current = cards
  const [stalled, setStalled] = useState(false)
  const cat = category === 'all' ? undefined : category

  const load = useCallback(
    async (replace: boolean) => {
      setLoading(true)
      try {
        const deck = await api.deck(settings, cat)
        setError(undefined)
        setRemaining(deck.remaining)
        const known = new Set(replace ? [] : cardsRef.current.map((c) => c.id))
        const fresh = deck.cards.filter((c) => !known.has(c.id) && !pending.current.has(c.id))
        setCards((current) => (replace ? fresh : [...current, ...fresh.filter((c) => !current.some((x) => x.id === c.id))]))
        // Kom inget nytt är leken slut för stunden. Sluta fylla på tills nästa swipe.
        setStalled(!replace && fresh.length === 0)
      } catch (e) {
        setError(message(e))
      } finally {
        setLoading(false)
      }
    },
    [settings, cat],
  )

  useEffect(() => {
    setCards([])
    void load(true)
  }, [load])

  const top = cards[0]

  const swipe = useCallback(
    async (card: Card, liked: boolean) => {
      setLeaving(undefined)
      setDx(0)
      setStalled(false)
      setCards((cs) => cs.filter((c) => c.id !== card.id))
      setRemaining((r) => Math.max(0, r - 1))
      pending.current.add(card.id)
      try {
        const res = await api.swipe(settings, card.id, liked)
        setLast(card)
        setError(undefined)
        if (res.match) {
          setMatch(res.match)
          void refreshMatches()
        }
      } catch (e) {
        // Lägg tillbaka kortet så att swipen inte försvinner tyst.
        setCards((cs) => [card, ...cs.filter((c) => c.id !== card.id)])
        setRemaining((r) => r + 1)
        setError(message(e))
      } finally {
        pending.current.delete(card.id)
      }
    },
    [settings, refreshMatches],
  )

  // Fyll på i förväg så att det alltid finns kort.
  useEffect(() => {
    if (!loading && !error && !stalled && cards.length < 5 && remaining > cards.length) void load(false)
  }, [cards.length, remaining, loading, error, stalled, load])

  const fling = useCallback(
    (liked: boolean) => {
      if (!top || leaving) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return void swipe(top, liked)
      setLeaving(liked ? 'right' : 'left')
      window.setTimeout(() => void swipe(top, liked), 180)
    },
    [top, leaving, swipe],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || match) return
      if (e.key === 'ArrowLeft') fling(false)
      if (e.key === 'ArrowRight') fling(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fling, match])

  const undo = async () => {
    if (!last) return
    try {
      await api.undo(settings, last.id)
      setCards((cs) => [last, ...cs.filter((c) => c.id !== last.id)])
      setRemaining((r) => r + 1)
      setLast(undefined)
      void refreshMatches()
    } catch (e) {
      setError(message(e))
    }
  }

  const categoryOptions: { id: Category | 'all'; label: string }[] = [
    { id: 'all', label: 'Alla' },
    ...CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
  ]
  const offset = leaving === 'right' ? 600 : leaving === 'left' ? -600 : dx

  return (
    <div className="panel swipe">
      <Segmented label={`Swipea som ${displayName(state, settings.me)}`} options={categoryOptions} value={category} onChange={setCategory} />

      {error && (
        <div className="swipe-error">
          <p>{error}</p>
          <button onClick={() => void load(cards.length === 0)}>Försök igen</button>
        </div>
      )}

      {top ? (
        <article
          key={top.id}
          className={`swipe-card${drag.current ? ' dragging' : ''}`}
          style={{ transform: `translateX(${offset}px) rotate(${offset / 20}deg)` }}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('a, button')) return
            drag.current = { x: e.clientX, id: e.pointerId }
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => drag.current?.id === e.pointerId && setDx(e.clientX - drag.current.x)}
          onPointerUp={() => {
            drag.current = undefined
            if (Math.abs(dx) > 100) fling(dx > 0)
            else setDx(0)
          }}
          onPointerCancel={() => {
            drag.current = undefined
            setDx(0)
          }}
        >
          <span className="stamp yes" style={{ opacity: Math.max(0, offset / 100) }}>
            Ja!
          </span>
          <span className="stamp no" style={{ opacity: Math.max(0, -offset / 100) }}>
            Nej
          </span>
          {top.image ? (
            <img src={top.image} alt="" referrerPolicy="no-referrer" draggable={false} />
          ) : (
            <div className="swipe-noimg" aria-hidden>
              🍽
            </div>
          )}
          <div className="swipe-body">
            <div>
              <span className={`badge cat-${top.category}`}>{categoryLabel(top.category)}</span>
              {top.totalMinutes && <span className="meta">⏱ {top.totalMinutes} min</span>}
              <span className="meta">{top.source}</span>
            </div>
            <h3>{top.title}</h3>
            {top.description && <p className="desc clamp">{top.description}</p>}
            <a href={top.url} target="_blank" rel="noreferrer">
              Visa receptet på {top.source} ↗
            </a>
          </div>
        </article>
      ) : (
        !error && (
          <p className="empty">
            {loading ? 'Hämtar recept…' : 'Slut på recept just nu. Servern hämtar fler av sig själv, titta in igen senare.'}
          </p>
        )
      )}

      <div className="swipe-actions">
        <button className="icon-btn big no" aria-label="Nej tack" disabled={!top} onClick={() => fling(false)}>
          ✕
        </button>
        <button className="icon-btn" aria-label="Ångra senaste" disabled={!last} onClick={undo}>
          ↶
        </button>
        <button className="icon-btn big yes" aria-label="Ja, det vill jag äta" disabled={!top} onClick={() => fling(true)}>
          ♥
        </button>
      </div>
      {top && <p className="meta center">{remaining} kvar att swipea</p>}

      {match && (
        <div className="match-overlay" role="dialog" aria-modal="true" aria-label="Det blev match">
          <div className="panel">
            <h2>Det blev match! 🎉</h2>
            <p>
              {PERSON_IDS.map((p) => displayName(state, p)).join(' och ')} vill båda äta <strong>{match.title}</strong>. Den finns nu
              bland era matchningar och i slumpen.
            </p>
            <a className="button" href={match.url} target="_blank" rel="noreferrer">
              Visa receptet ↗
            </a>
            <button onClick={() => setMatch(undefined)}>Fortsätt swipea</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Recepten ni båda har swipat höger på. */
export function Matches({ server, state, actions }: { server: Server; state: AppState; actions: Actions }) {
  const [error, setError] = useState<string>()
  if (server.matches.length === 0) return null
  return (
    <>
      <h2 className="section-title">Era matchningar ({server.matches.length})</h2>
      {error && <p className="meta">{error}</p>}
      <div className="list">
        {server.matches.map((m) => (
          <RecipeCard
            key={m.recipe.id}
            recipe={toRecipe(m.recipe)}
            state={state}
            actions={actions}
            extra={
              <button
                className="link-btn muted"
                onClick={async () => {
                  try {
                    await server.removeMatch(m.recipe.id)
                    setError(undefined)
                  } catch (e) {
                    setError(message(e))
                  }
                }}
              >
                Ta bort från matchningar
              </button>
            }
          />
        ))}
      </div>
    </>
  )
}

/** Inställningar för servern, under fliken Vi. */
export function ServerPanel({ server, state }: { server: Server; state: AppState }) {
  const { settings, setSettings } = server
  const [status, setStatus] = useState<string>()
  const [testing, setTesting] = useState(false)
  const problem = settings.url.trim() ? mixedContentProblem(settings.url) : undefined

  const test = async () => {
    setTesting(true)
    try {
      const h: Health = await api.health(settings)
      const counts = Object.entries(h.recipes)
      const total = counts.reduce((sum, [, n]) => sum + n, 0)
      setStatus(
        `Ansluten! ${total} recept${counts.length ? ` (${counts.map(([s, n]) => `${s} ${n}`).join(', ')})` : ''}.` +
          (h.importing ? ' Hämtar fler just nu.' : ''),
      )
      void server.refreshMatches()
    } catch (e) {
      setStatus(message(e))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="panel">
      <h3>Server för swipe</h3>
      <p className="meta">
        Med en egen server kan ni swipea recept från ICA, Arla, Coop och Köket.se under Inspiration. Rätter ni båda gillar sparas som
        matchningar. Se <code>server/</code> i repot för hur den sätts upp.
      </p>
      <label className="field">
        <span className="field-label">Adress</span>
        <input
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="https://nas.exempel.ts.net"
          value={settings.url}
          onChange={(e) => setSettings({ ...settings, url: e.target.value })}
        />
      </label>
      {problem && <p className="meta warn">{problem}</p>}
      <label className="field">
        <span className="field-label">Nyckel (om servern har en)</span>
        <input type="password" value={settings.token} onChange={(e) => setSettings({ ...settings, token: e.target.value })} />
      </label>
      <Segmented
        label="Vem använder den här telefonen?"
        options={PERSON_IDS.map((p) => ({ id: p, label: displayName(state, p) }))}
        value={settings.me}
        onChange={(me) => setSettings({ ...settings, me })}
      />
      <button onClick={test} disabled={!isConfigured(settings) || testing}>
        {testing ? 'Testar…' : 'Testa anslutningen'}
      </button>
      {status && <p className="meta">{status}</p>}
    </div>
  )
}
