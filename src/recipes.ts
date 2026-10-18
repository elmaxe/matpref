import type { Recipe } from './types'

// Grundrecepten i recipes/*.json byggs in i appen och läggs in i databasen första gången den startar (se Store.seed).
// Sedan är det databasen som gäller: recept läggs till, ändras och tas bort i appen och synkas som allt annat.
const modules = import.meta.glob<Omit<Recipe, 'id'>>('../recipes/*.json', { eager: true, import: 'default' })

export const seedRecipes: Recipe[] = Object.entries(modules)
  .map(([path, data]) => ({ ...data, id: path.split('/').pop()!.replace(/\.json$/, '') }))
  .sort((a, b) => a.name.localeCompare(b.name, 'sv'))
