import { describe, expect, it } from 'vitest'
import type { WebRecipe } from './store'
import { Store } from './store'

const web = (n: number, rank: number, category: WebRecipe['category'] = 'fast'): WebRecipe => ({
  id: `web-${n}`,
  source: 'ICA',
  url: `https://www.ica.se/recept/r-${n}/`,
  title: `Rätt ${n}`,
  category,
  rank,
})
const pool = [web(1, 0.5), web(2, 0.1, 'storkok'), web(3, 0.9), web(4, 0.3)]

const phone = (me: 'a' | 'b') => {
  const s = new Store()
  s.setMeta({ me, deviceId: `phone-${me}` })
  return s
}

/** Skickar allt osynkat från en telefon till en annan, som servern gör. */
const sync = (from: Store, to: Store) => {
  const sent = from.dirtyEntries()
  to.applyRemote(sent.map(({ key, value, updatedAt, device }) => ({ key, value, updatedAt, device })))
  from.markSynced(sent)
}

const ids = (list: WebRecipe[]) => list.map((r) => r.id)

describe('kortleken', () => {
  it('är i serverns ordning och samma för båda', () => {
    expect(ids(phone('a').deck(pool))).toEqual(['web-2', 'web-4', 'web-1', 'web-3'])
    expect(ids(phone('b').deck(pool))).toEqual(['web-2', 'web-4', 'web-1', 'web-3'])
    expect(ids(phone('a').deck(pool, 'storkok'))).toEqual(['web-2'])
  })

  it('visar först det den andra gillat och hoppar över det den andra sagt nej till', () => {
    const a = phone('a')
    const b = phone('b')
    a.swipe('web-3', true)
    a.swipe('web-4', false)
    sync(a, b)
    expect(ids(b.deck(pool))).toEqual(['web-3', 'web-2', 'web-1'])
    expect(ids(a.deck(pool))).toEqual(['web-2', 'web-1'])
  })

  it('ger en match när båda gillar samma rätt, och ångra tar bort den', () => {
    const a = phone('a')
    const b = phone('b')
    a.swipe('web-1', true)
    sync(a, b)
    b.swipe('web-1', true)
    expect(b.isMatch('web-1')).toBe(true)
    sync(b, a)
    expect(ids(a.matches(pool))).toEqual(['web-1'])

    a.swipe('web-1', null)
    expect(a.matches(pool)).toEqual([])
    expect(ids(a.deck(pool))[0]).toBe('web-1')
  })

  it('kan ta bort en match utan att rätten kommer tillbaka', () => {
    const a = phone('a')
    a.swipe('web-2', true)
    a.setMeta({ me: 'b' })
    a.swipe('web-2', true)
    a.hideMatch('web-2')
    expect(a.matches(pool)).toEqual([])
    expect(ids(a.deck(pool))).not.toContain('web-2')
  })
})

describe('synk', () => {
  it('låter den senaste ändringen vinna, oavsett ordning', () => {
    const a = phone('a')
    const b = phone('b')
    a.toggleFavorite('lasagne')
    sync(a, b)
    b.toggleFavorite('lasagne')
    // A har varit offline och ändrar efter B. Nu kommer B:s äldre ändring fram först.
    a.toggleFavorite('lasagne')
    a.toggleFavorite('lasagne')
    sync(b, a)
    expect(a.state().favorites).toEqual(['lasagne'])
    sync(a, b)
    expect(b.state().favorites).toEqual(['lasagne'])
  })

  it('skickar bara det som ändrats sedan senaste synken, men inte exempelreceptens swipes', () => {
    const a = phone('a')
    a.rate('a', 'tacos', 'like')
    a.swipe('demo-1', true)
    expect(a.dirtyEntries().map((e) => e.key)).toEqual(['rating/a/tacos'])
    const sent = a.dirtyEntries()
    a.rate('a', 'tacos', 'dislike')
    a.markSynced(sent)
    expect(a.dirtyEntries().map((e) => [e.key, e.value])).toEqual([['rating/a/tacos', 'dislike']])
  })

  it('bygger upp appens tillstånd från nycklarna', () => {
    const a = phone('a')
    a.rename('a', 'Axel')
    a.rate('b', 'lasagne', 'dislike')
    a.markCooked('tacos', '2026-10-18')
    a.importState({
      version: 1,
      names: { a: 'Person 1', b: 'Kim' },
      ratings: { a: { tacos: 'like' }, b: {} },
      favorites: ['tacos'],
      cooked: { tacos: '2026-10-01' },
    })
    expect(a.state()).toEqual({
      version: 1,
      names: { a: 'Axel', b: 'Kim' },
      ratings: { a: { tacos: 'like' }, b: { lasagne: 'dislike' } },
      favorites: ['tacos'],
      cooked: { tacos: '2026-10-18' },
    })
  })
})
