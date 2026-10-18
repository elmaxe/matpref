export type Category = 'fast' | 'storkok' | 'finmiddag'

export const CATEGORIES: { id: Category; label: string; hint: string }[] = [
  { id: 'fast', label: 'Snabbt', hint: 'Går fort, till vardags' },
  { id: 'storkok', label: 'Storkok', hint: 'Stora satser, matlådor' },
  { id: 'finmiddag', label: 'Finmiddag', hint: 'När det ska vara lite extra' },
]

export interface Recipe {
  id: string
  name: string
  category: Category
  description?: string
  timeMinutes?: number
  servings?: number
  tags?: string[]
  ingredients?: string[]
  steps?: string[]
  link?: string
  /** Bild, för recept från nätet. */
  image?: string
  /** Sajten receptet kommer från, t.ex. ICA. */
  source?: string
}

export type PersonId = 'a' | 'b'
export const PERSON_IDS: PersonId[] = ['a', 'b']

export type Rating = 'like' | 'dislike'

export interface AppState {
  version: 1
  names: Record<PersonId, string>
  ratings: Record<PersonId, Record<string, Rating>>
  favorites: string[]
  /** Recept-id → datum (ÅÅÅÅ-MM-DD) då ni senast lagade rätten. */
  cooked: Record<string, string>
}

export type Who = 'both' | PersonId
export type Source = 'all' | 'favorites' | 'liked' | 'new'

export interface Filters {
  categories: Category[]
  who: Who
  source: Source
}
