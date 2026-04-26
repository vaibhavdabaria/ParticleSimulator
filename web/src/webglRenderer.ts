import type {
  CircleObstacle,
  ColorRgba,
  RectangleObstacle,
  SimulationSceneSnapshot,
  SimulationSnapshot,
  Vec2,
} from './types'

interface ViewportTransform {
  canvasWidth: number
  canvasHeight: number
  scale: number
  offsetX: number
  offsetY: number
  minX: number
  minY: number
  boundsWidth: number
  boundsHeight: number
}

type DrawMode = 'lines' | 'triangles'

const horizontalPadding = 24
const topPadding = 24
const bottomPadding = 24

const solidVertexShader = `#version 300 es
in vec2 a_world;
uniform vec2 u_boundsMin;
uniform vec2 u_offset;
uniform vec2 u_canvasSize;
uniform float u_scale;

void main() {
  vec2 screen = u_offset + (a_world - u_boundsMin) * u_scale;
  vec2 clip = vec2(screen.x / u_canvasSize.x * 2.0 - 1.0, 1.0 - screen.y / u_canvasSize.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
}
`

const solidFragmentShader = `#version 300 es
precision mediump float;

uniform vec4 u_color;
out vec4 outColor;

void main() {
  outColor = u_color;
}
`

const colorVertexShader = `#version 300 es
in vec2 a_world;
in vec4 a_color;
uniform vec2 u_boundsMin;
uniform vec2 u_offset;
uniform vec2 u_canvasSize;
uniform float u_scale;
out vec4 v_color;

void main() {
  vec2 screen = u_offset + (a_world - u_boundsMin) * u_scale;
  vec2 clip = vec2(screen.x / u_canvasSize.x * 2.0 - 1.0, 1.0 - screen.y / u_canvasSize.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  v_color = a_color;
}
`

const colorFragmentShader = `#version 300 es
precision mediump float;

in vec4 v_color;
out vec4 outColor;

void main() {
  outColor = v_color;
}
`

const circleVertexShader = `#version 300 es
in vec2 a_quad;
in vec2 a_position;
in float a_radius;
in vec4 a_color;
uniform vec2 u_boundsMin;
uniform vec2 u_boundsSize;
uniform vec2 u_offset;
uniform vec2 u_canvasSize;
uniform float u_scale;
uniform bool u_positionsAreNormalized;
out vec2 v_quad;
out vec4 v_color;

void main() {
  vec2 worldPosition = u_positionsAreNormalized ? u_boundsMin + a_position * u_boundsSize : a_position;
  vec2 center = u_offset + (worldPosition - u_boundsMin) * u_scale;
  vec2 screen = center + a_quad * a_radius * u_scale;
  vec2 clip = vec2(screen.x / u_canvasSize.x * 2.0 - 1.0, 1.0 - screen.y / u_canvasSize.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  v_quad = a_quad;
  v_color = a_color;
}
`

const circleFragmentShader = `#version 300 es
precision mediump float;

in vec2 v_quad;
in vec4 v_color;
out vec4 outColor;

void main() {
  float distanceFromCenter = dot(v_quad, v_quad);
  if (distanceFromCenter > 1.0) {
    discard;
  }
  outColor = v_color;
}
`

export function computeViewportTransform(
  canvasWidth: number,
  canvasHeight: number,
  boundsMin: Vec2,
  boundsMax: Vec2,
): ViewportTransform {
  const boundsWidth = boundsMax[0] - boundsMin[0]
  const boundsHeight = boundsMax[1] - boundsMin[1]
  const availableWidth = Math.max(1, canvasWidth - horizontalPadding * 2)
  const availableHeight = Math.max(1, canvasHeight - topPadding - bottomPadding)
  const scale = Math.max(0.1, Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight))
  return {
    canvasWidth,
    canvasHeight,
    scale,
    offsetX: horizontalPadding + (availableWidth - boundsWidth * scale) * 0.5,
    offsetY: topPadding + (availableHeight - boundsHeight * scale) * 0.5,
    minX: boundsMin[0],
    minY: boundsMin[1],
    boundsWidth,
    boundsHeight,
  }
}

function colorToFloats(color: ColorRgba): [number, number, number, number] {
  return [color[0] / 255, color[1] / 255, color[2] / 255, color[3] / 255]
}

function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) {
    throw new Error('Unable to create WebGL shader.')
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'Unknown shader compile error.'
    gl.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const program = gl.createProgram()
  if (!program) {
    throw new Error('Unable to create WebGL program.')
  }
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'Unknown WebGL program link error.'
    gl.deleteProgram(program)
    throw new Error(message)
  }
  return program
}

function createBuffer(gl: WebGL2RenderingContext): WebGLBuffer {
  const buffer = gl.createBuffer()
  if (!buffer) {
    throw new Error('Unable to create WebGL buffer.')
  }
  return buffer
}

function rectangleVertices(obstacle: RectangleObstacle): number[] {
  const x = obstacle.position[0]
  const y = obstacle.position[1]
  const width = obstacle.size[0]
  const height = obstacle.size[1]
  return [x, y, x + width, y, x + width, y + height, x, y, x + width, y + height, x, y + height]
}

function boundsLineVertices(min: Vec2, max: Vec2): Float32Array {
  return new Float32Array([min[0], min[1], max[0], min[1], max[0], min[1], max[0], max[1], max[0], max[1], min[0], max[1], min[0], max[1], min[0], min[1]])
}

export class WebGLSceneRenderer {
  private readonly gl: WebGL2RenderingContext
  private readonly solidProgram: WebGLProgram
  private readonly colorProgram: WebGLProgram
  private readonly circleProgram: WebGLProgram
  private readonly quadBuffer: WebGLBuffer
  private readonly solidBuffer: WebGLBuffer
  private readonly trailPositionBuffer: WebGLBuffer
  private readonly trailColorBuffer: WebGLBuffer
  private readonly particlePositionBuffer: WebGLBuffer
  private readonly particleRadiusBuffer: WebGLBuffer
  private readonly particleColorBuffer: WebGLBuffer
  private readonly circleObstaclePositionBuffer: WebGLBuffer
  private readonly circleObstacleRadiusBuffer: WebGLBuffer
  private readonly canvas: HTMLCanvasElement
  private currentScene: SimulationSceneSnapshot | null = null
  private particlePositionBufferBytes = 0
  private boundsVertices = new Float32Array() as Float32Array<ArrayBufferLike>
  private rectangleVertices = new Float32Array() as Float32Array<ArrayBufferLike>
  private circleObstaclePositions = new Float32Array() as Float32Array<ArrayBufferLike>
  private circleObstacleRadii = new Float32Array() as Float32Array<ArrayBufferLike>

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', { antialias: true })
    if (!gl) {
      throw new Error('WebGL2 is required to render the simulation.')
    }
    this.gl = gl
    this.solidProgram = createProgram(gl, solidVertexShader, solidFragmentShader)
    this.colorProgram = createProgram(gl, colorVertexShader, colorFragmentShader)
    this.circleProgram = createProgram(gl, circleVertexShader, circleFragmentShader)
    this.quadBuffer = createBuffer(gl)
    this.solidBuffer = createBuffer(gl)
    this.trailPositionBuffer = createBuffer(gl)
    this.trailColorBuffer = createBuffer(gl)
    this.particlePositionBuffer = createBuffer(gl)
    this.particleRadiusBuffer = createBuffer(gl)
    this.particleColorBuffer = createBuffer(gl)
    this.circleObstaclePositionBuffer = createBuffer(gl)
    this.circleObstacleRadiusBuffer = createBuffer(gl)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  }

  isRenderingCanvas(canvas: HTMLCanvasElement): boolean {
    return this.canvas === canvas
  }

  isDisplaySizeDirty(): boolean {
    const devicePixelRatio = window.devicePixelRatio || 1
    const canvasWidth = Math.max(1, Math.floor(this.canvas.clientWidth * devicePixelRatio))
    const canvasHeight = Math.max(1, Math.floor(this.canvas.clientHeight * devicePixelRatio))
    return this.canvas.width !== canvasWidth || this.canvas.height !== canvasHeight
  }

  render(scene: SimulationSceneSnapshot, snapshot: SimulationSnapshot | null): number {
    const start = performance.now()
    const gl = this.gl
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    const devicePixelRatio = window.devicePixelRatio || 1
    const canvasWidth = Math.max(1, Math.floor(width * devicePixelRatio))
    const canvasHeight = Math.max(1, Math.floor(height * devicePixelRatio))
    if (this.canvas.width !== canvasWidth) {
      this.canvas.width = canvasWidth
    }
    if (this.canvas.height !== canvasHeight) {
      this.canvas.height = canvasHeight
    }

    gl.viewport(0, 0, canvasWidth, canvasHeight)
    const background = colorToFloats(scene.scenario.window.backgroundColor)
    gl.clearColor(background[0], background[1], background[2], background[3])
    gl.clear(gl.COLOR_BUFFER_BIT)

    const transform = computeViewportTransform(
      width,
      height,
      scene.scenario.geometry.bounds.min,
      scene.scenario.geometry.bounds.max,
    )
    this.refreshSceneBuffers(scene)
    this.drawSolidVertices(transform, this.boundsVertices, [1, 1, 1, 0.65], 'lines')
    this.drawSolidVertices(transform, this.rectangleVertices, [53 / 255, 89 / 255, 126 / 255, 1], 'triangles')
    this.drawCircleObstacles(transform)

    if (snapshot) {
      this.drawTrails(transform, snapshot)
      this.drawParticles(transform, scene, snapshot)
    }

    return performance.now() - start
  }

  private refreshSceneBuffers(scene: SimulationSceneSnapshot) {
    if (scene === this.currentScene) {
      return
    }
    this.currentScene = scene

    this.boundsVertices = boundsLineVertices(scene.scenario.geometry.bounds.min, scene.scenario.geometry.bounds.max)

    const rectangleData: number[] = []
    const circlePositions: number[] = []
    const circleRadii: number[] = []
    scene.scenario.geometry.obstacles.forEach((obstacle) => {
      if (obstacle.type === 'rectangle') {
        rectangleData.push(...rectangleVertices(obstacle))
      } else {
        const circle = obstacle as CircleObstacle
        circlePositions.push(circle.center[0], circle.center[1])
        circleRadii.push(circle.radius)
      }
    })
    this.rectangleVertices = new Float32Array(rectangleData)
    this.circleObstaclePositions = new Float32Array(circlePositions)
    this.circleObstacleRadii = new Float32Array(circleRadii)

    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleRadiusBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(scene.particleStyles.radii), gl.STATIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleColorBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(scene.particleStyles.colors), gl.STATIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.circleObstaclePositionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, this.circleObstaclePositions, gl.STATIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.circleObstacleRadiusBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, this.circleObstacleRadii, gl.STATIC_DRAW)
  }

  private setTransformUniforms(program: WebGLProgram, transform: ViewportTransform) {
    const gl = this.gl
    gl.uniform2f(gl.getUniformLocation(program, 'u_boundsMin'), transform.minX, transform.minY)
    const boundsSizeLocation = gl.getUniformLocation(program, 'u_boundsSize')
    if (boundsSizeLocation) {
      gl.uniform2f(boundsSizeLocation, transform.boundsWidth, transform.boundsHeight)
    }
    gl.uniform2f(gl.getUniformLocation(program, 'u_offset'), transform.offsetX, transform.offsetY)
    gl.uniform2f(gl.getUniformLocation(program, 'u_canvasSize'), transform.canvasWidth, transform.canvasHeight)
    gl.uniform1f(gl.getUniformLocation(program, 'u_scale'), transform.scale)
  }

  private drawSolidVertices(
    transform: ViewportTransform,
    vertices: Float32Array,
    color: [number, number, number, number],
    mode: DrawMode,
  ) {
    if (vertices.length === 0) {
      return
    }
    const gl = this.gl
    gl.useProgram(this.solidProgram)
    this.setTransformUniforms(this.solidProgram, transform)
    gl.uniform4f(gl.getUniformLocation(this.solidProgram, 'u_color'), color[0], color[1], color[2], color[3])
    gl.bindBuffer(gl.ARRAY_BUFFER, this.solidBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW)
    const positionLocation = gl.getAttribLocation(this.solidProgram, 'a_world')
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(mode === 'lines' ? gl.LINES : gl.TRIANGLES, 0, vertices.length / 2)
  }

  private drawCircleObstacles(transform: ViewportTransform) {
    const count = this.circleObstacleRadii.length
    if (count === 0) {
      return
    }
    this.drawInstancedCircles(transform, this.circleObstaclePositionBuffer, this.circleObstacleRadiusBuffer, null, count, [
      171 / 255,
      126 / 255,
      76 / 255,
      1,
    ], false, false)
  }

  private drawTrails(transform: ViewportTransform, snapshot: SimulationSnapshot) {
    if (snapshot.trailSegments.length === 0) {
      return
    }
    const positions = new Float32Array(snapshot.trailSegments.length * 4)
    const colors = new Uint8Array(snapshot.trailSegments.length * 8)
    snapshot.trailSegments.forEach((segment, index) => {
      const positionIndex = index * 4
      positions.set([segment.start[0], segment.start[1], segment.end[0], segment.end[1]], positionIndex)
      const colorIndex = index * 8
      colors.set(segment.color, colorIndex)
      colors.set(segment.color, colorIndex + 4)
    })

    const gl = this.gl
    gl.useProgram(this.colorProgram)
    this.setTransformUniforms(this.colorProgram, transform)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.trailPositionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW)
    const positionLocation = gl.getAttribLocation(this.colorProgram, 'a_world')
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.trailColorBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW)
    const colorLocation = gl.getAttribLocation(this.colorProgram, 'a_color')
    gl.enableVertexAttribArray(colorLocation)
    gl.vertexAttribPointer(colorLocation, 4, gl.UNSIGNED_BYTE, true, 0, 0)
    gl.drawArrays(gl.LINES, 0, snapshot.trailSegments.length * 2)
  }

  private drawParticles(transform: ViewportTransform, scene: SimulationSceneSnapshot, snapshot: SimulationSnapshot) {
    const gl = this.gl
    const positions = snapshot.particles.positions
    const typedPositions =
      positions instanceof Float32Array || positions instanceof Uint16Array
        ? positions
        : new Float32Array(Array.from(positions))
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particlePositionBuffer)
    if (this.particlePositionBufferBytes !== typedPositions.byteLength) {
      gl.bufferData(gl.ARRAY_BUFFER, typedPositions.byteLength, gl.DYNAMIC_DRAW)
      this.particlePositionBufferBytes = typedPositions.byteLength
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, typedPositions)
    this.drawInstancedCircles(
      transform,
      this.particlePositionBuffer,
      this.particleRadiusBuffer,
      this.particleColorBuffer,
      snapshot.particleCount,
      scene.particleStyles.colors.length === 0 ? [1, 1, 1, 1] : null,
      snapshot.particles.positionsAreNormalized === true,
      typedPositions instanceof Uint16Array,
    )
  }

  private drawInstancedCircles(
    transform: ViewportTransform,
    positionBuffer: WebGLBuffer,
    radiusBuffer: WebGLBuffer,
    colorBuffer: WebGLBuffer | null,
    count: number,
    fallbackColor: [number, number, number, number] | null,
    positionsAreNormalized: boolean,
    positionsAreQuantized: boolean,
  ) {
    const gl = this.gl
    gl.useProgram(this.circleProgram)
    this.setTransformUniforms(this.circleProgram, transform)
    gl.uniform1i(gl.getUniformLocation(this.circleProgram, 'u_positionsAreNormalized'), positionsAreNormalized ? 1 : 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    const quadLocation = gl.getAttribLocation(this.circleProgram, 'a_quad')
    gl.enableVertexAttribArray(quadLocation)
    gl.vertexAttribPointer(quadLocation, 2, gl.FLOAT, false, 0, 0)
    gl.vertexAttribDivisor(quadLocation, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    const positionLocation = gl.getAttribLocation(this.circleProgram, 'a_position')
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(
      positionLocation,
      2,
      positionsAreQuantized ? gl.UNSIGNED_SHORT : gl.FLOAT,
      positionsAreQuantized,
      0,
      0,
    )
    gl.vertexAttribDivisor(positionLocation, 1)

    gl.bindBuffer(gl.ARRAY_BUFFER, radiusBuffer)
    const radiusLocation = gl.getAttribLocation(this.circleProgram, 'a_radius')
    gl.enableVertexAttribArray(radiusLocation)
    gl.vertexAttribPointer(radiusLocation, 1, gl.FLOAT, false, 0, 0)
    gl.vertexAttribDivisor(radiusLocation, 1)

    const colorLocation = gl.getAttribLocation(this.circleProgram, 'a_color')
    if (colorBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer)
      gl.enableVertexAttribArray(colorLocation)
      gl.vertexAttribPointer(colorLocation, 4, gl.UNSIGNED_BYTE, true, 0, 0)
      gl.vertexAttribDivisor(colorLocation, 1)
    } else {
      gl.disableVertexAttribArray(colorLocation)
      const color = fallbackColor ?? [1, 1, 1, 1]
      gl.vertexAttrib4f(colorLocation, color[0], color[1], color[2], color[3])
    }

    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count)

    gl.vertexAttribDivisor(positionLocation, 0)
    gl.vertexAttribDivisor(radiusLocation, 0)
    if (colorBuffer) {
      gl.vertexAttribDivisor(colorLocation, 0)
    }
  }
}
