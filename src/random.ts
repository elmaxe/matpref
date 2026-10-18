import type { AppState, Filters, PersonId, Recipe } from './types'
import { PERSON_IDS } from './types'

const DAY = 24 * 60 * 60 * 1000

export const peopleFor = (who: Filters['who']): PersonId[] => (who === 'both' ? PERSON_IDS : [who])

/** En rätt räknas som ny (inspiration) om ingen har tyckt till om den, den inte är favorit och ni aldrig lagat den. */
export function isNew(recipe: Recipe, state: AppState): boolean {
  return (
    PERSON_IDS.every((p) => !state.ratings[p][recipe.id]) &&
    !state.favorites.includes(recipe.id) &&
    !state.cooked[recipe.id]
  )
}

export function candidates(all: Recipe[], state: AppState, filters: Filters): Recipe[] {
  const people = peopleFor(filters.who)
  return all.filter((r) => {
    if (filters.categories.length > 0 && !filters.categories.includes(r.category)) return false
    if (people.some((p) => state.ratings[p][r.id] === 'dislike')) return false
    switch (filters.source) {
      case 'favorites':
        return state.favorites.includes(r.id)
      case 'liked':
        return people.every((p) => state.ratings[p][r.id] === 'like')
      case 'new':
        return isNew(r, state)
      default:
        return true
    }
  })
}

/** Gillade rätter och favoriter dyker upp oftare, nyligen lagade mer sällan. */
export function weight(recipe: Recipe, state: AppState, filters: Filters, now = Date.now()): number {
  let w = 1
  for (const p of peopleFor(filters.who)) if (state.ratings[p][recipe.id] === 'like') w += 1
  if (state.favorites.includes(recipe.id)) w *= 2
  const cooked = state.cooked[recipe.id]
  if (cooked) {
    const daysAgo = (now - new Date(cooked).getTime()) / DAY
    if (daysAgo < 7) w *= 0.15
    else if (daysAgo < 14) w *= 0.5
  }
  return w
}

/** Väljer en rätt viktat slumpmässigt. Undviker `avoidId` (förra resultatet) om det finns fler att välja på. */
export function pick(
  list: Recipe[],
  state: AppState,
  filters: Filters,
  avoidId?: string,
  rand: () => number = Math.random,
  now = Date.now(),
): Recipe | undefined {
  const pool = list.length > 1 && avoidId ? list.filter((r) => r.id !== avoidId) : list
  if (pool.length === 0) return undefined
  const weights = pool.map((r) => weight(r, state, filters, now))
  let x = rand() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < pool.length; i++) {
    x -= weights[i]
    if (x < 0) return pool[i]
  }
  return pool[pool.length - 1]
}
