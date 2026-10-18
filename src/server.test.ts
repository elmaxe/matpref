import { afterEach, describe, expect, it, vi } from 'vitest'
import { mixedContentProblem, toRecipe } from './server'

describe('mixedContentProblem', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('varnar för http från en https-sida', () => {
    vi.stubGlobal('location', { protocol: 'https:' })
    expect(mixedContentProblem('http://192.168.1.10:8080')).toMatch(/https/)
    expect(mixedContentProblem('https://nas.exempel.ts.net')).toBeUndefined()
    expect(mixedContentProblem('http://localhost:8080')).toBeUndefined()
  })

  it('låter http vara när appen själv körs över http', () => {
    vi.stubGlobal('location', { protocol: 'http:' })
    expect(mixedContentProblem('http://192.168.1.10:8080')).toBeUndefined()
  })
})

it('gör om en matchning till ett recept', () => {
  const r = toRecipe({ id: 7, source: 'ICA', url: 'https://www.ica.se/recept/x-1/', title: 'Tacos', category: 'fast', totalMinutes: 20, image: null })
  expect(r).toMatchObject({ id: 'web-7', name: 'Tacos', link: 'https://www.ica.se/recept/x-1/', timeMinutes: 20, source: 'ICA' })
  expect(r.image).toBeUndefined()
})
