import type { Recipe } from './types'

// Alla recept läses in från recipes/*.json när appen byggs. Lägg till en fil där för att lägga till ett recept.
const modules = import.meta.glob<Omit<Recipe, 'id'>>('../recipes/*.json', { eager: true, import: 'default' })

export const recipes: Recipe[] = Object.entries(modules)
  .map(([path, data]) => ({ ...data, id: path.split('/').pop()!.replace(/\.json$/, '') }))
  .sort((a, b) => a.name.localeCompare(b.name, 'sv'))

export const REPO_URL = 'https://github.com/elmaxe/matpref'

const template = {
  name: 'Namn på rätten',
  category: 'fast',
  description: 'En mening om rätten.',
  timeMinutes: 30,
  servings: 4,
  tags: [],
  ingredients: ['Ingrediens 1', 'Ingrediens 2'],
  steps: ['Steg 1', 'Steg 2'],
}

/** Öppnar GitHubs "ny fil"-sida med en receptmall, därifrån skapas en PR. */
export const newRecipeUrl = `${REPO_URL}/new/main/recipes?filename=${encodeURIComponent('ny-ratt.json')}&value=${encodeURIComponent(JSON.stringify(template, null, 2) + '\n')}`
