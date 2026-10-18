// Kontrollerar att alla recept i recipes/ följer formatet. Körs i CI och före bygget.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = new URL('../recipes/', import.meta.url).pathname
const categories = ['fast', 'storkok', 'finmiddag']
const allowed = new Set(['name', 'category', 'description', 'timeMinutes', 'servings', 'tags', 'ingredients', 'steps', 'link'])

const isStringList = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.trim() !== '')
const isPositiveInt = (v) => Number.isInteger(v) && v > 0

const errors = []
const names = new Map()
const files = readdirSync(dir).filter((f) => f.endsWith('.json'))

for (const file of files) {
  const fail = (msg) => errors.push(`${file}: ${msg}`)
  if (!/^[a-z0-9]+(-[a-z0-9]+)*\.json$/.test(file)) fail('filnamnet får bara innehålla a-z, 0-9 och bindestreck (t.ex. "pasta-carbonara.json")')

  let r
  try {
    r = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  } catch (e) {
    fail(`ogiltig JSON (${e.message})`)
    continue
  }
  if (typeof r !== 'object' || r === null || Array.isArray(r)) {
    fail('filen måste innehålla ett objekt')
    continue
  }

  for (const key of Object.keys(r)) if (!allowed.has(key)) fail(`okänt fält "${key}"`)
  if (typeof r.name !== 'string' || r.name.trim() === '') fail('"name" saknas')
  if (!categories.includes(r.category)) fail(`"category" måste vara en av ${categories.join(', ')}`)
  if ('description' in r && typeof r.description !== 'string') fail('"description" måste vara text')
  if ('timeMinutes' in r && !isPositiveInt(r.timeMinutes)) fail('"timeMinutes" måste vara ett positivt heltal')
  if ('servings' in r && !isPositiveInt(r.servings)) fail('"servings" måste vara ett positivt heltal')
  for (const key of ['tags', 'ingredients', 'steps']) if (key in r && !isStringList(r[key])) fail(`"${key}" måste vara en lista med text`)
  if ('link' in r && !/^https?:\/\/\S+$/.test(r.link)) fail('"link" måste vara en http(s)-länk')

  if (typeof r.name === 'string') {
    const key = r.name.trim().toLowerCase()
    if (names.has(key)) fail(`samma namn som ${names.get(key)}`)
    names.set(key, file)
  }
}

if (files.length === 0) errors.push('inga recept hittades i recipes/')

if (errors.length > 0) {
  console.error(`Fel i recepten:\n${errors.map((e) => `  - ${e}`).join('\n')}`)
  process.exit(1)
}
console.log(`${files.length} recept ser bra ut.`)
