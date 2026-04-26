import type {
  CircleObstacle,
  ColorRgba,
  ForceDefinition,
  ObstacleDefinition,
  ParticleTypeDefinition,
  RectangleObstacle,
  Scenario,
  SpawnGroupDefinition,
  Vec2,
} from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function coerceNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function coerceString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function coerceVec2(value: unknown, fallback: Vec2): Vec2 {
  if (Array.isArray(value) && value.length >= 2) {
    return [coerceNumber(value[0], fallback[0]), coerceNumber(value[1], fallback[1])]
  }
  return [...fallback] as Vec2
}

function coerceColor(value: unknown, fallback: ColorRgba): ColorRgba {
  if (Array.isArray(value) && value.length >= 3) {
    return [
      Math.round(coerceNumber(value[0], fallback[0])),
      Math.round(coerceNumber(value[1], fallback[1])),
      Math.round(coerceNumber(value[2], fallback[2])),
      Math.round(coerceNumber(value[3], fallback[3])),
    ]
  }
  return [...fallback] as ColorRgba
}

export function createDefaultParticleType(): ParticleTypeDefinition {
  return {
    radius: 4,
    mass: 1,
    restitution: 0.85,
    color: [255, 210, 120, 255],
    initialVelocity: [0, 0],
  }
}

export function createDefaultSpawnGroup(particleType = 'dust'): SpawnGroupDefinition {
  return {
    particleType,
    count: 160,
    minPosition: [80, 80],
    maxPosition: [420, 200],
    minVelocity: [-6, -2],
    maxVelocity: [6, 2],
    streakEnabled: false,
  }
}

export function createDefaultForce(type: ForceDefinition['type']): ForceDefinition {
  switch (type) {
    case 'gravity':
      return { type, acceleration: [0, 12] }
    case 'drag':
      return { type, coefficient: 0.15 }
    case 'wind':
      return { type, acceleration: [2, 0] }
    case 'radial':
      return { type, origin: [640, 360], strength: -18, radius: 220 }
  }
}

export function createDefaultObstacle(type: ObstacleDefinition['type']): ObstacleDefinition {
  switch (type) {
    case 'rectangle':
      return { type, position: [420, 500], size: [260, 24], restitution: 0.95 }
    case 'circle':
      return { type, center: [760, 320], radius: 60, restitution: 0.9 }
  }
}

export function createDefaultScenario(): Scenario {
  return {
    window: {
      width: 1280,
      height: 720,
      title: 'Web Particle Studio',
      backgroundColor: [12, 18, 28, 255],
      targetFps: 60,
    },
    forces: [createDefaultForce('gravity'), createDefaultForce('drag')],
    particleTypes: {
      dust: createDefaultParticleType(),
    },
    spawnGroups: [createDefaultSpawnGroup()],
    geometry: {
      bounds: {
        min: [0, 0],
        max: [1280, 720],
      },
      obstacles: [createDefaultObstacle('rectangle')],
    },
  }
}

function normalizeForce(value: unknown): ForceDefinition | null {
  if (!isRecord(value)) {
    return null
  }

  const type = coerceString(value.type, 'gravity') as ForceDefinition['type']
  if (type === 'gravity' || type === 'wind') {
    return {
      type,
      acceleration: coerceVec2(value.acceleration, [0, 0]),
    }
  }
  if (type === 'drag') {
    return {
      type,
      coefficient: coerceNumber(value.coefficient, 0.15),
    }
  }
  if (type === 'radial') {
    return {
      type,
      origin: coerceVec2(value.origin, [640, 360]),
      strength: coerceNumber(value.strength, -18),
      radius: coerceNumber(value.radius, 220),
    }
  }
  return null
}

function normalizeParticleType(value: unknown): ParticleTypeDefinition {
  const fallback = createDefaultParticleType()
  if (!isRecord(value)) {
    return fallback
  }

  return {
    radius: coerceNumber(value.radius, fallback.radius),
    mass: coerceNumber(value.mass, fallback.mass),
    restitution: coerceNumber(value.restitution, fallback.restitution),
    color: coerceColor(value.color, fallback.color),
    initialVelocity: coerceVec2(value.initialVelocity, fallback.initialVelocity),
  }
}

function normalizeSpawnGroup(value: unknown, particleType: string): SpawnGroupDefinition {
  const fallback = createDefaultSpawnGroup(particleType)
  if (!isRecord(value)) {
    return fallback
  }

  return {
    particleType: coerceString(value.particleType, particleType),
    count: Math.round(coerceNumber(value.count, fallback.count)),
    minPosition: coerceVec2(value.minPosition, fallback.minPosition),
    maxPosition: coerceVec2(value.maxPosition, fallback.maxPosition),
    minVelocity: coerceVec2(value.minVelocity, fallback.minVelocity),
    maxVelocity: coerceVec2(value.maxVelocity, fallback.maxVelocity),
    streakEnabled: coerceBoolean(value.streakEnabled, false),
  }
}

function normalizeObstacle(value: unknown): ObstacleDefinition | null {
  if (!isRecord(value)) {
    return null
  }

  const type = coerceString(value.type, 'rectangle') as ObstacleDefinition['type']
  if (type === 'rectangle') {
    const obstacle: RectangleObstacle = {
      type,
      position: coerceVec2(value.position, [420, 500]),
      size: coerceVec2(value.size, [220, 24]),
      restitution: value.restitution === undefined ? undefined : coerceNumber(value.restitution, 0.95),
    }
    return obstacle
  }

  if (type === 'circle') {
    const obstacle: CircleObstacle = {
      type,
      center: coerceVec2(value.center, [640, 320]),
      radius: coerceNumber(value.radius, 70),
      restitution: value.restitution === undefined ? undefined : coerceNumber(value.restitution, 0.9),
    }
    return obstacle
  }

  return null
}

export function normalizeScenario(value: unknown): Scenario {
  const fallback = createDefaultScenario()
  if (!isRecord(value)) {
    return fallback
  }

  const particleTypesSource = isRecord(value.particleTypes) ? value.particleTypes : {}
  const particleTypes = Object.entries(particleTypesSource).reduce<Record<string, ParticleTypeDefinition>>(
    (accumulator, [name, definition]) => {
      accumulator[name] = normalizeParticleType(definition)
      return accumulator
    },
    {},
  )

  if (Object.keys(particleTypes).length === 0) {
    particleTypes.dust = createDefaultParticleType()
  }

  const firstParticleType = Object.keys(particleTypes)[0]
  const spawnGroups = Array.isArray(value.spawnGroups)
    ? value.spawnGroups.map((group) => normalizeSpawnGroup(group, firstParticleType))
    : [createDefaultSpawnGroup(firstParticleType)]

  const forces = Array.isArray(value.forces)
    ? value.forces.map(normalizeForce).filter((force): force is ForceDefinition => force !== null)
    : []

  const obstacles = isRecord(value.geometry) && Array.isArray(value.geometry.obstacles)
    ? value.geometry.obstacles
        .map(normalizeObstacle)
        .filter((obstacle): obstacle is ObstacleDefinition => obstacle !== null)
    : []

  return {
    window: isRecord(value.window)
      ? {
          width: Math.round(coerceNumber(value.window.width, fallback.window.width)),
          height: Math.round(coerceNumber(value.window.height, fallback.window.height)),
          title: coerceString(value.window.title, fallback.window.title),
          backgroundColor: coerceColor(value.window.backgroundColor, fallback.window.backgroundColor),
          targetFps: Math.round(coerceNumber(value.window.targetFps, fallback.window.targetFps)),
        }
      : fallback.window,
    forces,
    particleTypes,
    spawnGroups,
    geometry: {
      bounds:
        isRecord(value.geometry) && isRecord(value.geometry.bounds)
          ? {
              min: coerceVec2(value.geometry.bounds.min, fallback.geometry.bounds.min),
              max: coerceVec2(value.geometry.bounds.max, fallback.geometry.bounds.max),
            }
          : fallback.geometry.bounds,
      obstacles,
    },
  }
}

function validateColor(name: string, color: ColorRgba, errors: string[]): void {
  color.forEach((channel, index) => {
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
      errors.push(`${name} channel ${index + 1} must be an integer between 0 and 255.`)
    }
  })
}

export function validateScenario(scenario: Scenario): string[] {
  const errors: string[] = []

  if (scenario.window.width <= 0) {
    errors.push('Window width must be positive.')
  }
  if (scenario.window.height <= 0) {
    errors.push('Window height must be positive.')
  }
  if (scenario.window.targetFps <= 0) {
    errors.push('Window target FPS must be positive.')
  }
  if (!scenario.window.title.trim()) {
    errors.push('Window title is required.')
  }
  validateColor('Window background color', scenario.window.backgroundColor, errors)

  if (Object.keys(scenario.particleTypes).length === 0) {
    errors.push('At least one particle type is required.')
  }

  Object.entries(scenario.particleTypes).forEach(([name, particleType]) => {
    if (!name.trim()) {
      errors.push('Particle type names cannot be empty.')
    }
    if (particleType.radius <= 0) {
      errors.push(`Particle type "${name}" radius must be positive.`)
    }
    if (particleType.mass <= 0) {
      errors.push(`Particle type "${name}" mass must be positive.`)
    }
    if (particleType.restitution < 0 || particleType.restitution > 1) {
      errors.push(`Particle type "${name}" restitution must be between 0 and 1.`)
    }
    validateColor(`Particle type "${name}" color`, particleType.color, errors)
  })

  if (scenario.spawnGroups.length === 0) {
    errors.push('At least one spawn group is required.')
  }

  scenario.spawnGroups.forEach((group, index) => {
    if (!scenario.particleTypes[group.particleType]) {
      errors.push(`Spawn group ${index + 1} references unknown particle type "${group.particleType}".`)
    }
    if (group.count <= 0) {
      errors.push(`Spawn group ${index + 1} count must be positive.`)
    }
  })

  scenario.forces.forEach((force, index) => {
    if (force.type === 'drag' && force.coefficient < 0) {
      errors.push(`Force ${index + 1} drag coefficient must be non-negative.`)
    }
    if (force.type === 'radial' && force.radius <= 0) {
      errors.push(`Force ${index + 1} radial radius must be positive.`)
    }
  })

  if (scenario.geometry.bounds.max[0] <= scenario.geometry.bounds.min[0]) {
    errors.push('Geometry bounds max.x must be greater than min.x.')
  }
  if (scenario.geometry.bounds.max[1] <= scenario.geometry.bounds.min[1]) {
    errors.push('Geometry bounds max.y must be greater than min.y.')
  }

  scenario.geometry.obstacles.forEach((obstacle, index) => {
    if (
      obstacle.restitution !== undefined &&
      (obstacle.restitution < 0 || obstacle.restitution > 1)
    ) {
      errors.push(`Obstacle ${index + 1} restitution must be between 0 and 1.`)
    }

    if (obstacle.type === 'rectangle' && (obstacle.size[0] <= 0 || obstacle.size[1] <= 0)) {
      errors.push(`Rectangle obstacle ${index + 1} size must be positive.`)
    }

    if (obstacle.type === 'circle' && obstacle.radius <= 0) {
      errors.push(`Circle obstacle ${index + 1} radius must be positive.`)
    }
  })

  return errors
}

export function serializeScenario(scenario: Scenario): string {
  return JSON.stringify(scenario, null, 2)
}
