import { useEffect, useMemo, useRef, useState } from 'react'
import { RecipeCard, Segmented, categoryLabel, displayName } from './components'
import { demoRecipes } from './demo'
import type { Health, SyncStatus, Syncer, Version } from './server'
import { ApiError, appVersion, health, isConfigured, mixedContentProblem, normalizeUrl, toRecipe, useSyncStatus } from './server'
import type { Actions } from './storage'
import { PREVIEW_LABEL } from './storage'
import type { Store, WebRecipe } from './store'
import type { AppState, Category, PersonId } from './types'
import { CATEGORIES, PERSON_IDS } from './types'

/** Recepten att swipea bland: serverns, eller exempelrecepten om ingen server är inkopplad. */
export function swipePool(store: Store): WebRecipe[] {
  return isConfigured(store.meta.server) ? [...store.recipes.values()] : demoRecipes
}

/** Recepten från nätet som matchningar kan komma från. Med server bara serverns, så att båda telefonerna visar samma. */
export const allWebRecipes = (store: Store) =>
  isConfigured(store.meta.server) ? [...store.recipes.values()] : [...store.recipes.values(), ...demoRecipes]

/** Kortleken. Swipea höger på det du vill äta; gillar ni båda samma rätt blir det en match. Allt sker lokalt och synkas sedan. */
export function SwipeDeck({ store, state }: { store: Store; state: AppState }) {
  const [category, setCategory] = useState<Category | 'all'>('all')
  const [last, setLast] = useState<string>()
  const [match, setMatch] = useState<WebRecipe>()
  const [dx, setDx] = useState(0)
  const [leaving, setLeaving] = useState<'left' | 'right'>()
  const drag = useRef<{ x: number; id: number }>(undefined)
  const demo = !isConfigured(store.meta.server)
  const me = store.meta.me
  const other: PersonId = me === 'a' ? 'b' : 'a'

  const deck = useMemo(
    () => store.deck(swipePool(store), category === 'all' ? undefined : category),
    // store.version ändras vid varje ändring i databasen.
    [store, store.version, category],
  )
  const top = deck[0]

  const swipe = (r: WebRecipe, liked: boolean) => {
    setLeaving(undefined)
    setDx(0)
    store.swipe(r.id, liked)
    setLast(r.id)
    if (liked && store.isMatch(r.id)) setMatch(r)
  }

  const fling = (liked: boolean) => {
    if (!top || leaving) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return swipe(top, liked)
    setLeaving(liked ? 'right' : 'left')
    window.setTimeout(() => swipe(top, liked), 180)
  }

  const flingRef = useRef(fling)
  flingRef.current = fling
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || match) return
      if (e.key === 'ArrowLeft') flingRef.current(false)
      if (e.key === 'ArrowRight') flingRef.current(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [match])

  const undo = () => {
    if (!last) return
    store.swipe(last, null)
    setLast(undefined)
  }

  const categoryOptions: { id: Category | 'all'; label: string }[] = [
    { id: 'all', label: 'Alla' },
    ...CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
  ]
  const offset = leaving === 'right' ? 600 : leaving === 'left' ? -600 : dx

  return (
    <div className="panel swipe">
      {demo && (
        <p className="demo-note">
          Ingen server inkopplad, så här är exempelrecept att testa med. Byt till {displayName(state, other)} nedan för att swipea som
          den andra och se en match. Koppla in en server under Vi för riktiga recept och synk mellan telefonerna.
        </p>
      )}
      {demo ? (
        // Utan server finns bara den här telefonen, så låt den swipea som båda för att testa.
        <Segmented
          label="Testa som"
          options={PERSON_IDS.map((p) => ({ id: p, label: displayName(state, p) }))}
          value={me}
          onChange={(p) => store.setMeta({ me: p })}
        />
      ) : (
        <p className="meta">Du swipar som {displayName(state, me)}. Byt under Vi.</p>
      )}
      <Segmented label="Vad blir det?" options={categoryOptions} value={category} onChange={setCategory} />

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
        <p className="empty">
          {demo
            ? `Slut på exempelrecept för ${displayName(state, me)}.`
            : store.recipes.size === 0
              ? 'Inga recept från servern än. De hämtas vid nästa synk.'
              : 'Slut på recept just nu. Servern hämtar fler av sig själv, titta in igen senare.'}
        </p>
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
      {top && <p className="meta center">{deck.length} kvar att swipea</p>}

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
export function Matches({ store, state, actions }: { store: Store; state: AppState; actions: Actions }) {
  const matches = store.matches(allWebRecipes(store))
  if (matches.length === 0) return null
  return (
    <>
      <h2 className="section-title">Era matchningar ({matches.length})</h2>
      <div className="list">
        {matches.map((r) => (
          <RecipeCard
            key={r.id}
            recipe={toRecipe(r)}
            state={state}
            actions={actions}
            extra={
              <button className="link-btn muted" onClick={() => store.hideMatch(r.id)}>
                Ta bort från matchningar
              </button>
            }
          />
        ))}
      </div>
    </>
  )
}

const time = (ms: number) =>
  new Date(ms).toLocaleString('sv-SE', { weekday: 'short', hour: '2-digit', minute: '2-digit' })

/** Serverns namn utan https:// och sökväg, t.ex. "matpref.tail.elmarsson.se". */
export function serverHost(url: string) {
  try {
    return new URL(url.trim()).host
  } catch {
    return url.trim()
  }
}

type Light = 'green' | 'red' | 'yellow' | 'gray'

/** Grönt när servern svarade senast, rött när den inte gjorde det, gult medan vi ansluter för första gången. */
function light(status: SyncStatus): Light {
  if (status.state === 'off') return 'gray'
  if (status.connected === true) return 'green'
  if (status.connected === false) return 'red'
  return 'yellow'
}

function lightText(status: SyncStatus, host: string) {
  if (status.state === 'off') return 'Ingen server, allt sparas på telefonen'
  if (status.connected === true) return `Ansluten till ${host}`
  if (status.connected === false) return `Når inte ${host}`
  return `Ansluter till ${host}…`
}

/** Liten statusrad uppe i hörnet: vilken server appen synkar med och om den går att nå. */
export function ServerBadge({ store, syncer, onClick }: { store: Store; syncer: Syncer; onClick: () => void }) {
  const status = useSyncStatus(syncer)
  const host = serverHost(store.meta.server.url)
  return (
    <button className="server-badge" onClick={onClick} title={lightText(status, host)}>
      <span className={`dot ${light(status)}`} aria-hidden />
      <span className="server-badge-text">{status.state === 'off' ? 'Ingen server' : host}</span>
      <span className="sr-only">{lightText(status, host)}</span>
    </button>
  )
}

const built = (v: Version) =>
  v.built ? ` (byggd ${new Date(v.built).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' })})` : ''

/**
 * Vem som använder telefonen. Ingen inloggning: servern ska bara gå att nå via ert VPN, och det räcker att varje telefon
 * vet vem den tillhör. Visas som en fråga första gången och går att ändra under Vi.
 */
export function WhoAmI({ store, state, first }: { store: Store; state: AppState; first?: boolean }) {
  const choose = (me: PersonId) => store.setMeta({ me, meChosen: true })
  if (first) {
    return (
      <div className="panel notice">
        <h3>Vem är du?</h3>
        <p className="meta">Det sparas på den här telefonen, så att dina swipes och betyg blir dina. Namnen ändrar ni under Vi.</p>
        <div className="row">
          {PERSON_IDS.map((p) => (
            <button key={p} className="primary" onClick={() => choose(p)}>
              {displayName(state, p)}
            </button>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="panel">
      <Segmented
        label="Den här telefonen tillhör"
        options={PERSON_IDS.map((p) => ({ id: p, label: displayName(state, p) }))}
        value={store.meta.me}
        onChange={choose}
      />
    </div>
  )
}

/** Inställningar och status för servern, under fliken Vi. */
export function ServerPanel({ store, syncer }: { store: Store; syncer: Syncer }) {
  const status = useSyncStatus(syncer)
  const [url, setUrl] = useState(store.meta.server.url)
  const [token, setToken] = useState(store.meta.server.token)
  const [info, setInfo] = useState<string>()
  const problem = url.trim() ? mixedContentProblem(normalizeUrl(url)) : undefined
  const saved = store.meta.server
  const changed = normalizeUrl(url) !== saved.url || token.trim() !== saved.token
  const pending = store.dirtyEntries().length

  const save = async () => {
    const clean = normalizeUrl(url)
    setUrl(clean)
    setToken(token.trim())
    store.setMeta({ server: { url: clean, token: token.trim() } })
    setInfo(undefined)
    if (!clean) return
    await syncer.sync()
    try {
      const h: Health = await health(store.meta.server)
      const counts = Object.entries(h.recipes)
      const total = counts.reduce((sum, [, n]) => sum + n, 0)
      setInfo(
        `Servern har ${total} recept${counts.length ? ` (${counts.map(([s, n]) => `${s} ${n}`).join(', ')})` : ''}.` +
          (h.importing ? ' Den hämtar fler just nu.' : ''),
      )
    } catch (e) {
      if (!(e instanceof ApiError)) throw e
    }
  }

  return (
    <div className="panel">
      <h3>Server</h3>
      <p className="meta">
        Allt sparas på telefonen och fungerar offline. Med en egen server synkas era listor, favoriter och swipes mellan
        telefonerna, och ni får recept från ICA, Arla, Coop och Köket.se att swipea. Se <code>server/</code> i repot.
      </p>
      <label className="field">
        <span className="field-label">Adress</span>
        <input
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="https://matpref.ert-tailnet.ts.net"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      {problem && <p className="meta warn">{problem}</p>}
      {PREVIEW_LABEL && (
        <p className="meta warn">Det här är en förhandsvisning. Kopplar du in samma server som i den riktiga appen delar de data.</p>
      )}
      <label className="field">
        <span className="field-label">Nyckel (om servern har en)</span>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} />
      </label>
      <button className={changed ? 'primary' : ''} onClick={save} disabled={!changed && (!isConfigured(saved) || status.state === 'syncing')}>
        {changed ? (url.trim() ? 'Spara och synka' : 'Koppla från servern') : 'Synka nu'}
      </button>
      {isConfigured(saved) && (
        <>
          <p className="server-status">
            <span className={`dot ${light(status)}`} aria-hidden />
            {lightText(status, serverHost(saved.url))}
          </p>
          <p className="meta" aria-live="polite">
            {status.state === 'syncing'
              ? 'Synkar…'
              : status.state === 'error'
                ? `${status.message} Ändringar sparas på telefonen och synkas när servern går att nå.`
                : store.meta.lastSyncedAt
                  ? `Synkad ${time(store.meta.lastSyncedAt)}.`
                  : 'Inte synkad än.'}
            {pending > 0 && status.state !== 'syncing' && ` ${pending} ${pending === 1 ? 'ändring väntar' : 'ändringar väntar'} på att synkas.`}
          </p>
        </>
      )}
      {info && <p className="meta">{info}</p>}
      <p className="meta versions">
        Appen: {appVersion.version}
        {built(appVersion)}
        {isConfigured(saved) && (
          <>
            <br />
            Servern: {status.server ? `${status.server.version}${built(status.server)}` : 'okänd'}
          </>
        )}
      </p>
    </div>
  )
}
