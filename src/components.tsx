import type { FormEvent, ReactNode } from 'react'
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

/** Formulär för ett nytt eller ändrat recept. Ingredienser och steg skrivs en per rad. */
export function RecipeForm({
  recipe,
  onSave,
  onCancel,
  onDelete,
}: {
  recipe?: Recipe
  onSave: (r: Omit<Recipe, 'id'> & { id?: string }) => void
  onCancel: () => void
  onDelete?: () => void
}) {
  const [name, setName] = useState(recipe?.name ?? '')
  const [category, setCategory] = useState<Category>(recipe?.category ?? 'fast')
  const [description, setDescription] = useState(recipe?.description ?? '')
  const [time, setTime] = useState(recipe?.timeMinutes?.toString() ?? '')
  const [servings, setServings] = useState(recipe?.servings?.toString() ?? '')
  const [ingredients, setIngredients] = useState(recipe?.ingredients?.join('\n') ?? '')
  const [steps, setSteps] = useState(recipe?.steps?.join('\n') ?? '')
  const [tags, setTags] = useState(recipe?.tags?.join(', ') ?? '')
  const [link, setLink] = useState(recipe?.link ?? '')
  const lines = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean)
  const number = (t: string) => (Number(t) > 0 ? Math.round(Number(t)) : undefined)

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onSave({
      id: recipe?.id,
      name: name.trim(),
      category,
      description: description.trim() || undefined,
      timeMinutes: number(time),
      servings: number(servings),
      ingredients: lines(ingredients),
      steps: lines(steps),
      tags: tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
      link: link.trim() || undefined,
    })
  }

  return (
    <form className="recipe-form" onSubmit={save}>
      <label className="field">
        <span className="field-label">Namn</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
      </label>
      <Segmented
        label="Kategori"
        options={CATEGORIES.map((c) => ({ id: c.id, label: c.label }))}
        value={category}
        onChange={setCategory}
      />
      <label className="field">
        <span className="field-label">Beskrivning</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
      </label>
      <div className="row">
        <label className="field">
          <span className="field-label">Tid (min)</span>
          <input type="number" inputMode="numeric" min={1} value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Portioner</span>
          <input type="number" inputMode="numeric" min={1} value={servings} onChange={(e) => setServings(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span className="field-label">Ingredienser, en per rad</span>
        <textarea rows={5} value={ingredients} onChange={(e) => setIngredients(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Gör så här, ett steg per rad</span>
        <textarea rows={5} value={steps} onChange={(e) => setSteps(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Taggar, med komma emellan</span>
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="pasta, vegetariskt" />
      </label>
      <label className="field">
        <span className="field-label">Länk till receptet</span>
        <input type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />
      </label>
      <div className="row">
        <button type="submit" className="primary" disabled={!name.trim()}>
          Spara
        </button>
        <button type="button" onClick={onCancel}>
          Avbryt
        </button>
        {onDelete && (
          <button type="button" className="danger" onClick={() => confirm(`Ta bort ${recipe?.name}?`) && onDelete()}>
            Ta bort
          </button>
        )}
      </div>
    </form>
  )
}

export function RecipeCard({ recipe, state, actions, defaultOpen = false, big = false, extra }: CardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <article className="card">
        <RecipeForm
          recipe={recipe}
          onSave={(r) => {
            actions.saveRecipe(r)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
          onDelete={() => actions.deleteRecipe(recipe.id)}
        />
      </article>
    )
  }
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
      {/* Recept från nätet (matchningar) har en källa och ändras inte här. */}
      {!recipe.source && (
        <button className="link-btn muted" onClick={() => setEditing(true)}>
          Ändra receptet
        </button>
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
