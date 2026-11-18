import { describe, expect, it } from 'vitest'
import { AppConfigSchema, configWarnings, defaultLabel, lighten } from '../../src/config/schema'

describe('app config', () => {
  it('labels may name groups (parents of declared accounts); unknown keys are warned', () => {
    const config = AppConfigSchema.parse({
      accounts: { 'assets:bank': { label: 'Bank' }, 'assets:bank:checking': { label: 'Bank Checking' } },
      categories: { 'expenses:food': { label: 'Food' }, 'expenses:nope': { label: 'Nope' } }
    })
    const declared = ['assets:bank:checking', 'expenses:food:groceries']
    expect(configWarnings(config, declared)).toEqual(['app.config.json: "expenses:nope" is not a declared account'])
  })

  it('default label: last segment, capitalized, dashes as spaces', () => {
    expect(defaultLabel('expenses:transport:long-distance')).toBe('Long distance')
  })

  it('lighten mixes a color with white', () => {
    expect(lighten('#2a78d6', 0)).toBe('#2a78d6')
    expect(lighten('#000000', 0.5)).toBe('#808080')
    expect(lighten('#2a78d6', 1)).toBe('#ffffff')
  })
})
