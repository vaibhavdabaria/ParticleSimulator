import { describe, expect, it } from 'vitest'

import { createDefaultScenario, normalizeScenario, serializeScenario, validateScenario } from './scenario'

describe('scenario builder utilities', () => {
  it('creates a valid default scenario', () => {
    const scenario = createDefaultScenario()
    expect(validateScenario(scenario)).toEqual([])
  })

  it('round-trips a scenario through json serialization and normalization', () => {
    const original = createDefaultScenario()
    const text = serializeScenario(original)
    const normalized = normalizeScenario(JSON.parse(text))

    expect(normalized.window.title).toBe(original.window.title)
    expect(Object.keys(normalized.particleTypes)).toEqual(Object.keys(original.particleTypes))
    expect(normalized.spawnGroups[0].particleType).toBe(original.spawnGroups[0].particleType)
  })

  it('flags invalid bounds and particle references', () => {
    const invalid = createDefaultScenario()
    invalid.geometry.bounds.max = [0, 0]
    invalid.spawnGroups[0].particleType = 'missing'

    const errors = validateScenario(invalid)
    expect(errors.some((error) => error.includes('unknown particle type'))).toBe(true)
    expect(errors.some((error) => error.includes('max.x'))).toBe(true)
  })
})
