export type Vec2 = [number, number]
export type ColorRgba = [number, number, number, number]

export interface WindowConfig {
  width: number
  height: number
  title: string
  backgroundColor: ColorRgba
  targetFps: number
}

export interface GravityForce {
  type: 'gravity'
  acceleration: Vec2
}

export interface DragForce {
  type: 'drag'
  coefficient: number
}

export interface WindForce {
  type: 'wind'
  acceleration: Vec2
}

export interface RadialForce {
  type: 'radial'
  origin: Vec2
  strength: number
  radius: number
}

export type ForceDefinition = GravityForce | DragForce | WindForce | RadialForce

export interface ParticleTypeDefinition {
  radius: number
  mass: number
  restitution: number
  color: ColorRgba
  initialVelocity: Vec2
}

export interface SpawnGroupDefinition {
  particleType: string
  count: number
  minPosition: Vec2
  maxPosition: Vec2
  minVelocity: Vec2
  maxVelocity: Vec2
  radius?: number
  mass?: number
  restitution?: number
  color?: ColorRgba
  streakEnabled: boolean
}

export interface BoundsDefinition {
  min: Vec2
  max: Vec2
}

export interface RectangleObstacle {
  type: 'rectangle'
  position: Vec2
  size: Vec2
  restitution?: number
}

export interface CircleObstacle {
  type: 'circle'
  center: Vec2
  radius: number
  restitution?: number
}

export type ObstacleDefinition = RectangleObstacle | CircleObstacle

export interface GeometryDefinition {
  bounds: BoundsDefinition
  obstacles: ObstacleDefinition[]
}

export interface Scenario {
  window: WindowConfig
  forces: ForceDefinition[]
  particleTypes: Record<string, ParticleTypeDefinition>
  spawnGroups: SpawnGroupDefinition[]
  geometry: GeometryDefinition
}

export interface BundledScenario {
  id: string
  name: string
  scenario: Scenario
}

export interface SessionCreateRequest {
  scenario: Scenario
  overrides?: {
    width?: number
    height?: number
  }
  speedMultiplier?: number
  paused?: boolean
}

export interface SimulationSceneSnapshot {
  scenario: Scenario
  resolvedSeed: number
  gridCellSize: number
}

export interface ParticleSnapshot {
  position: Vec2
  velocity: Vec2
  radius: number
  mass: number
  restitution: number
  color: ColorRgba
  streakEnabled: boolean
}

export interface TrailSegmentSnapshot {
  start: Vec2
  end: Vec2
  color: ColorRgba
}

export interface SimulationSnapshot {
  sequence: number
  simulationTime: number
  paused: boolean
  speedMultiplier: number
  particleCount: number
  resolvedSeed: number
  gridCellSize: number
  particles: ParticleSnapshot[]
  trailSegments: TrailSegmentSnapshot[]
}

export type ServerEvent =
  | { type: 'sessionReady'; scene: SimulationSceneSnapshot }
  | { type: 'snapshot'; snapshot: SimulationSnapshot }
  | { type: 'status'; action: string; paused: boolean; speedMultiplier: number }
  | { type: 'error'; message: string }
