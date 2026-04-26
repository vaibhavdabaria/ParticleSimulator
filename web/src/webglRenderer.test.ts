import { describe, expect, it } from 'vitest'

import { computeViewportTransform } from './webglRenderer'

describe('webgl renderer helpers', () => {
  it('matches the simulation viewport padding and scale calculation', () => {
    const transform = computeViewportTransform(1000, 700, [0, 0], [100, 50])

    expect(transform.canvasWidth).toBe(1000)
    expect(transform.canvasHeight).toBe(700)
    expect(transform.scale).toBeCloseTo(9.52)
    expect(transform.offsetX).toBeCloseTo(24)
    expect(transform.offsetY).toBeCloseTo(112)
    expect(transform.minX).toBe(0)
    expect(transform.minY).toBe(0)
  })
})
