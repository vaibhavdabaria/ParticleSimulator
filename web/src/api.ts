import type { BundledScenario, ServerEvent, SessionCreateRequest } from './types'

const apiBase = import.meta.env.VITE_API_BASE ?? ''

export async function fetchBundledScenarios(): Promise<BundledScenario[]> {
  const response = await fetch(`${apiBase}/api/scenarios`)
  if (!response.ok) {
    throw new Error('Failed to load bundled scenarios.')
  }

  const body = (await response.json()) as { scenarios: BundledScenario[] }
  return body.scenarios
}

export async function createSession(request: SessionCreateRequest): Promise<string> {
  const response = await fetch(`${apiBase}/api/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  const body = (await response.json()) as { sessionId?: string; error?: string }
  if (!response.ok || !body.sessionId) {
    throw new Error(body.error ?? 'Failed to create a simulation session.')
  }

  return body.sessionId
}

export function buildWebSocketUrl(sessionId: string): string {
  if (apiBase) {
    const url = new URL(apiBase, window.location.origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = '/ws'
    url.searchParams.set('sessionId', sessionId)
    return url.toString()
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws?sessionId=${encodeURIComponent(sessionId)}`
}

const snapshotMagic = 0x33535350
const snapshotHeaderBytes = 56

export function parseServerEvent(rawMessage: string | ArrayBuffer): ServerEvent {
  if (typeof rawMessage === 'string') {
    return JSON.parse(rawMessage) as ServerEvent
  }

  return parseBinarySnapshot(rawMessage)
}

function parseBinarySnapshot(rawMessage: ArrayBuffer): ServerEvent {
  const view = new DataView(rawMessage)
  if (view.byteLength < snapshotHeaderBytes || view.getUint32(0, true) !== snapshotMagic) {
    throw new Error('Received an unknown binary simulation message.')
  }

  const particleCount = view.getUint32(4, true)
  const trailCount = view.getUint32(8, true)
  const positionBytes = particleCount * 2 * Uint16Array.BYTES_PER_ELEMENT
  const trailGeometryBytes = trailCount * 4 * Float32Array.BYTES_PER_ELEMENT
  const trailColorBytes = trailCount * 4
  const expectedBytes = snapshotHeaderBytes + positionBytes + trailGeometryBytes + trailColorBytes
  if (view.byteLength < expectedBytes) {
    throw new Error('Received a truncated binary simulation snapshot.')
  }

  const positions = new Uint16Array(rawMessage, snapshotHeaderBytes, particleCount * 2)
  const trailGeometryOffset = snapshotHeaderBytes + positionBytes
  const trailColorOffset = trailGeometryOffset + trailGeometryBytes
  const trailGeometry = new Float32Array(rawMessage, trailGeometryOffset, trailCount * 4)
  const trailColors = new Uint8Array(rawMessage, trailColorOffset, trailCount * 4)
  const trailSegments = Array.from({ length: trailCount }, (_, index) => {
    const geometryIndex = index * 4
    const colorIndex = index * 4
    return {
      start: [trailGeometry[geometryIndex], trailGeometry[geometryIndex + 1]] as [number, number],
      end: [trailGeometry[geometryIndex + 2], trailGeometry[geometryIndex + 3]] as [number, number],
      color: [
        trailColors[colorIndex],
        trailColors[colorIndex + 1],
        trailColors[colorIndex + 2],
        trailColors[colorIndex + 3],
      ] as [number, number, number, number],
    }
  })

  return {
    type: 'snapshot',
    snapshot: {
      particleCount,
      resolvedSeed: view.getUint32(48, true),
      paused: (view.getUint32(12, true) & 1) === 1,
      sequence: view.getFloat64(16, true),
      simulationTime: view.getFloat64(24, true),
      speedMultiplier: view.getFloat64(32, true),
      gridCellSize: view.getFloat64(40, true),
      particles: {
        positions,
        positionsAreNormalized: true,
      },
      trailSegments,
    },
  }
}
