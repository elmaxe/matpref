import type { ReactNode } from 'react'
import { useState } from 'react'
import type { Actions } from './storage'
import type { AppState, Category, Recipe } from './types'
import { CATEGORIES, PERSON_IDS } from './types'

export const categoryLabel = (c: Category) => CATEGORIES.find((x) => x.id === c)?.label ?? c

export const displayName = (state: AppState, p: 'a' | 'b') => state.names[p].trim() || (p === 'a' ? 'Person 1' : 'Person 2')

export function CategoryChips({ value, onChange }: { value: Category[]; onChange: (v: Category[]) => void }) {
  return (
    <div className="chips" role="group" aria-label="Kategorier">
      <button className="chip" aria-pressed={value.length === 0} onClick={() => onChange([])}>
        Alla
      </button>
      {CATEGORIES.map((c) => (
        <button
          key={c.id}
          className={`chip cat-${c.id}`}
          aria-pressed={value.includes(c.id)}
          title={c.hint}
          onClick={() => onChange(value.includes(c.id) ? value.filter((x) => x !== c.id) : [...value, c.id])}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { id: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

interface CardProps {
  recipe: Recipe
  state: AppState
  actions: Actions
  defaultOpen?: boolean
  big?: boolean
  /** Extra knappar längst ned på kortet. */
  extra?: ReactNode
}

export function RecipeCard({ recipe, state, actions, defaultOpen = false, big = false, extra }: CardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const fav = state.favorites.includes(recipe.id)
  const cooked = state.cooked[recipe.id]
  const hasDetails = !!(recipe.ingredients?.length || recipe.steps?.length)

  return (
    <article className={`card${big ? ' card-big' : ''}`}>
      {recipe.image && <img className="card-img" src={recipe.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      <div className="card-head">
        <div>
          <span className={`badge cat-${recipe.category}`}>{categoryLabel(recipe.category)}</span>
          {recipe.timeMinutes && <span className="meta">⏱ {recipe.timeMinutes} min</span>}
          {recipe.servings && <span className="meta">🍽 {recipe.servings} port</span>}
          {recipe.source && <span className="meta">{recipe.source}</span>}
          <h3>{recipe.name}</h3>
        </div>
        <button
          className={`icon-btn heart${fav ? ' on' : ''}`}
          aria-pressed={fav}
          aria-label={fav ? 'Ta bort från favoriter' : 'Lägg till i favoriter'}
          onClick={() => actions.toggleFavorite(recipe.id)}
        >
          {fav ? '♥' : '♡'}
        </button>
      </div>

      {recipe.description && <p className="desc">{recipe.description}</p>}

      <div className="ratings">
        {PERSON_IDS.map((p) => {
          const r = state.ratings[p][recipe.id]
          const name = displayName(state, p)
          return (
            <div className="rating" key={p}>
              <span className="rating-name">{name}</span>
              <button
                className="icon-btn small"
                aria-pressed={r === 'like'}
                aria-label={`${name} gillar`}
                onClick={() => actions.rate(p, recipe.id, 'like')}
              >
                👍
              </button>
              <button
                className="icon-btn small"
                aria-pressed={r === 'dislike'}
                aria-label={`${name} gillar inte`}
                onClick={() => actions.rate(p, recipe.id, 'dislike')}
              >
                👎
              </button>
            </div>
          )
        })}
      </div>

      {cooked && <p className="meta cooked">Senast lagad {cooked}</p>}

      {!hasDetails && recipe.link && (
        <a className="link-btn" href={recipe.link} target="_blank" rel="noreferrer">
          Visa receptet{recipe.source ? ` på ${recipe.source}` : ''} ↗
        </a>
      )}
      {hasDetails && (
        <button className="link-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Dölj recept' : 'Visa recept'}
        </button>
      )}
      {open && (
        <div className="details">
          {recipe.ingredients?.length ? (
            <>
              <h4>Ingredienser</h4>
              <ul>
                {recipe.ingredients.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </>
          ) : null}
          {recipe.steps?.length ? (
            <>
              <h4>Gör så här</h4>
              <ol>
                {recipe.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </>
          ) : null}
          {recipe.link && (
            <p>
              <a href={recipe.link} target="_blank" rel="noreferrer">
                Originalrecept ↗
              </a>
            </p>
          )}
        </div>
      )}
      {extra}
    </article>
  )
}

export function RecipeList({ list, state, actions, empty }: { list: Recipe[]; state: AppState; actions: Actions; empty: string }) {
  if (list.length === 0) return <p className="empty">{empty}</p>
  return (
    <div className="list">
      {list.map((r) => (
        <RecipeCard key={r.id} recipe={r} state={state} actions={actions} />
      ))}
    </div>
  )
}
