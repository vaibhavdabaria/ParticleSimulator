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
          particles: [],
          trailSegments: [],
        },
      }),
    )

    expect(event.type).toBe('snapshot')
    if (event.type === 'snapshot') {
      expect(event.snapshot.sequence).toBe(1)
    }
  })
})
