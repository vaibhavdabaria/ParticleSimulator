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

export function parseServerEvent(rawMessage: string): ServerEvent {
  return JSON.parse(rawMessage) as ServerEvent
}
