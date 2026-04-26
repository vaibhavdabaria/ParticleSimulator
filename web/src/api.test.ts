import { afterEach, describe, expect, it } from 'vitest'

import { buildWebSocketUrl, parseServerEvent } from './api'

const originalWindow = globalThis.window

describe('api helpers', () => {
  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    })
  })

  it('builds websocket urls from the current browser location', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: {
          protocol: 'http:',
          host: 'localhost:5173',
          origin: 'http://localhost:5173',
        },
      },
    })

    expect(buildWebSocketUrl('session-123')).toBe('ws://localhost:5173/ws?sessionId=session-123')
  })

  it('parses streamed server events', () => {
    const event = parseServerEvent(
      JSON.stringify({
        type: 'snapshot',
        snapshot: {
          sequence: 1,
          simulationTime: 0.1,
          paused: false,
          speedMultiplier: 1,
          particleCount: 1,
          resolvedSeed: 42,
          gridCellSize: 12,
          particles: {
            positions: [10, 20],
          },
          trailSegments: [],
        },
      }),
    )

    expect(event.type).toBe('snapshot')
    if (event.type === 'snapshot') {
      expect(event.snapshot.sequence).toBe(1)
    }
  })

  it('parses binary snapshot events', () => {
    const particleCount = 2
    const trailCount = 1
    const headerBytes = 56
    const positionBytes = particleCount * 2 * Uint16Array.BYTES_PER_ELEMENT
    const trailGeometryBytes = trailCount * 4 * Float32Array.BYTES_PER_ELEMENT
    const trailColorBytes = trailCount * 4
    const buffer = new ArrayBuffer(headerBytes + positionBytes + trailGeometryBytes + trailColorBytes)
    const view = new DataView(buffer)
    view.setUint32(0, 0x33535350, true)
    view.setUint32(4, particleCount, true)
    view.setUint32(8, trailCount, true)
    view.setUint32(12, 0, true)
    view.setFloat64(16, 7, true)
    view.setFloat64(24, 0.125, true)
    view.setFloat64(32, 1.5, true)
    view.setFloat64(40, 12, true)
    view.setUint32(48, 42, true)
    view.setUint32(52, 0, true)
    new Uint16Array(buffer, headerBytes, particleCount * 2).set([10, 20, 30, 40])
    new Float32Array(buffer, headerBytes + positionBytes, trailCount * 4).set([1, 2, 3, 4])
    new Uint8Array(buffer, headerBytes + positionBytes + trailGeometryBytes, trailColorBytes).set([255, 128, 64, 255])

    const event = parseServerEvent(buffer)

    expect(event.type).toBe('snapshot')
    if (event.type === 'snapshot') {
      expect(event.snapshot.sequence).toBe(7)
      expect(event.snapshot.particleCount).toBe(2)
      expect(event.snapshot.particles.positionsAreNormalized).toBe(true)
      expect(Array.from(event.snapshot.particles.positions)).toEqual([10, 20, 30, 40])
      expect(event.snapshot.trailSegments).toEqual([{ start: [1, 2], end: [3, 4], color: [255, 128, 64, 255] }])
    }
  })
})
