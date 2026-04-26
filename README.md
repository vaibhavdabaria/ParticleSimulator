# Particle Simulator

A command-line-driven 2D particle simulator written in C++20. Users launch the program with a JSON scenario file, and the application opens a window to visualize the simulation.

## Features

- `raylib` windowed rendering with a command-line entrypoint
- Shared C++ session layer used by both the desktop app and the web server
- C++ web server with HTTP endpoints plus WebSocket snapshot streaming
- React + TypeScript scenario builder for full-schema authoring in the browser
- JSON scenarios describing particles, bounds, obstacles, and forces
- Optional gravity plus built-in drag, wind, and radial attractor/repulsor forces
- Elastic particle-particle collisions
- Static rectangle and circle obstacles
- Pause, reset, and single-step controls
- Example scenarios for quick testing

## Prerequisites

This workspace does not currently have a visible toolchain on `PATH`. Install one of the following before building:

- CMake 3.14+
- A C++20 compiler
  - Windows: Visual Studio 2022 Build Tools or MSVC from Visual Studio
  - Or MinGW-w64 with a recent `g++`

## Build

```powershell
cmake -S . -B build
cmake --build build --config Release
```

The build now produces:

- `particle_simulator.exe` - the original desktop renderer
- `particle_simulator_tests.exe` - native test suite
- `particle_simulator_web_server.exe` - HTTP + WebSocket backend for the browser app

## Run

```powershell
.\build\Release\particle_simulator.exe .\scenarios\minimal_zero_gravity.json
```

Example overrides:

```powershell
.\build\Release\particle_simulator.exe .\scenarios\force_showcase.json --width 1440 --height 900 --speed 1.25
```

## Controls

- `Space`: pause or resume
- `R`: reset to the initial state
- `N`: single simulation step while paused
- `Esc`: close the window

## Web App

The web app keeps the simulation core in native C++ and streams simulation state to the browser over WebSocket.

### Frontend Setup

```powershell
cd .\web
npm install
npm run build
```

### Start The Web Server

```powershell
cd ..
.\build\Release\particle_simulator_web_server.exe --web-root web/dist --scenario-dir scenarios
```

Then open [http://localhost:18080](http://localhost:18080).

### Development Workflow

Use the C++ server for the backend and Vite for the frontend during UI work:

```powershell
.\build\Release\particle_simulator_web_server.exe --scenario-dir scenarios
cd .\web
npm run dev
```

The Vite config proxies `/api` and `/ws` to `http://localhost:18080`.

### Web API

- `GET /api/scenarios` - list bundled example scenarios
- `POST /api/session` - create a simulation session from browser-authored JSON
- `GET /ws?sessionId=...` - stream snapshots and send playback commands

Supported WebSocket commands:

- `play`
- `pause`
- `reset`
- `step`
- `setSpeed`

## Scenario Schema

Scenario files are standard JSON files. A scenario describes:

- how the window should look
- how the window target FPS should drive runtime settings
- which forces should be active
- which particle types exist
- how particles should be spawned
- which geometry contains the simulation

The simulator is launched like this:

```powershell
.\build\Release\particle_simulator.exe .\scenarios\my_scene.json
```

### Top-Level Structure

The parser accepts these top-level sections:

- `window` - optional
- `forces` - optional
- `particleTypes` - required
- `spawnGroups` - required
- `geometry` - required

A minimal valid file can omit `window` and `forces`, but it must still define at least one particle type, at least one spawn group, and the simulation bounds.

### Complete Example

```json
{
  "window": {
    "width": 1280,
    "height": 720,
    "title": "My Particle Scene",
    "backgroundColor": [12, 18, 28, 255],
    "targetFps": 60
  },
  "forces": [
    {
      "type": "gravity",
      "acceleration": [0.0, 12.0]
    },
    {
      "type": "drag",
      "coefficient": 0.15
    },
    {
      "type": "wind",
      "acceleration": [2.0, 0.0]
    },
    {
      "type": "radial",
      "origin": [640.0, 360.0],
      "strength": -18.0,
      "radius": 220.0
    }
  ],
  "particleTypes": {
    "dust": {
      "radius": 4.0,
      "mass": 1.0,
      "restitution": 0.85,
      "color": [255, 210, 120, 255],
      "initialVelocity": [0.0, 0.0]
    },
    "heavy": {
      "radius": 6.0,
      "mass": 2.5,
      "restitution": 0.7,
      "color": [110, 190, 255, 255],
      "initialVelocity": [0.0, 0.0]
    }
  },
  "spawnGroups": [
    {
      "particleType": "dust",
      "count": 300,
      "minPosition": [100.0, 80.0],
      "maxPosition": [1180.0, 260.0],
      "minVelocity": [-10.0, -5.0],
      "maxVelocity": [10.0, 5.0]
    },
    {
      "particleType": "heavy",
      "count": 60,
      "minPosition": [300.0, 60.0],
      "maxPosition": [980.0, 120.0],
      "minVelocity": [-4.0, 0.0],
      "maxVelocity": [4.0, 6.0]
    }
  ],
  "geometry": {
    "bounds": {
      "min": [0.0, 0.0],
      "max": [1280.0, 720.0]
    },
    "obstacles": [
      {
        "type": "rectangle",
        "position": [420.0, 500.0],
        "size": [440.0, 24.0],
        "restitution": 0.95
      },
      {
        "type": "circle",
        "center": [640.0, 320.0],
        "radius": 70.0,
        "restitution": 0.9
      }
    ]
  }
}
```

### `window`

This section controls the render window. If omitted, defaults are used.

Fields:

- `width` - positive integer, default `1280`
- `height` - positive integer, default `720`
- `title` - string, default `"Particle Simulator"`
- `backgroundColor` - array of 3 or 4 integers from `0` to `255`
- `targetFps` - positive integer, default `60`

Notes:

- Colors are `[r, g, b]` or `[r, g, b, a]`.
- If alpha is omitted, it defaults to `255`.
- CLI flags `--width` and `--height` override this section at runtime.

Example:

```json
"window": {
  "width": 1400,
  "height": 900,
  "title": "Dense Particle Test",
  "backgroundColor": [8, 10, 16, 255],
  "targetFps": 60
}
```

### Runtime Settings

Physics runtime settings are derived automatically from `window.targetFps`.
The simulator uses `1 / (targetFps * 2)` as the fixed timestep, derives collision
iterations from the target frame rate, derives a deterministic seed from the
target frame rate, and derives the broad-phase collision grid from particle size.

### `forces`

This is an optional array. If you leave it out, no external forces are applied.

Supported force types:

- `gravity`
- `drag`
- `wind`
- `radial`

#### Gravity

Applies constant acceleration to every particle. Gravity is optional; if you do not include this force, there is no gravity.

Fields:

- `type`: `"gravity"`
- `acceleration`: `[x, y]`

Example:

```json
{
  "type": "gravity",
  "acceleration": [0.0, 9.8]
}
```

#### Drag

Reduces velocity over time.

Fields:

- `type`: `"drag"`
- `coefficient`: non-negative number

Example:

```json
{
  "type": "drag",
  "coefficient": 0.2
}
```

#### Wind

Applies constant directional acceleration.

Fields:

- `type`: `"wind"`
- `acceleration`: `[x, y]`

Example:

```json
{
  "type": "wind",
  "acceleration": [3.0, 0.0]
}
```

#### Radial

Applies attraction or repulsion relative to a point.

Fields:

- `type`: `"radial"`
- `origin`: `[x, y]`
- `strength`: number
- `radius`: positive number

Notes:

- Positive `strength` pulls particles toward `origin`.
- Negative `strength` pushes particles away.
- Force strength follows an inverse-square falloff based on distance from
  `origin`.
- `radius` still acts as a hard cutoff, so particles outside it are unaffected.
- Because the simulator uses pixel-like world units, inverse-square strengths
  usually need to be much larger than the old linear-falloff values. In larger
  scenes, values in the thousands or even millions are normal.

Example:

```json
{
  "type": "radial",
  "origin": [640.0, 360.0],
  "strength": -25.0,
  "radius": 180.0
}
```

### `particleTypes`

This required object defines reusable particle templates by name.

Each entry must include:

- `radius` - positive number
- `mass` - positive number
- `restitution` - number from `0.0` to `1.0`
- `color` - `[r, g, b]` or `[r, g, b, a]`

Optional field:

- `initialVelocity` - `[x, y]`, default `[0.0, 0.0]`

Notes:

- `restitution` controls bounce. `1.0` is very bouncy, `0.0` is no bounce.
- Spawn groups do not override these particle properties. Define another particle type when a group needs a different radius, mass, restitution, color, or initial velocity.

Example:

```json
"particleTypes": {
  "spark": {
    "radius": 3.0,
    "mass": 0.5,
    "restitution": 0.9,
    "color": [255, 180, 80, 255],
    "initialVelocity": [0.0, 0.0]
  }
}
```

### `spawnGroups`

This required array creates actual particles at startup. Each group references one particle type and generates `count` particles using randomized ranges.

Required fields:

- `particleType` - string name from `particleTypes`
- `count` - positive integer
- `minPosition` - `[x, y]`
- `maxPosition` - `[x, y]`

Optional fields:

- `minVelocity` - `[x, y]`, default `[0.0, 0.0]`
- `maxVelocity` - `[x, y]`, default `[0.0, 0.0]`
- `streakEnabled` - boolean, default `false`

Notes:

- Radius, mass, restitution, color, and initial velocity always come from the referenced `particleTypes` entry.
- Positions are randomized independently between `minPosition` and `maxPosition`.
- Velocity is randomized between `minVelocity` and `maxVelocity`, then added to the particle type's `initialVelocity`.
- Use identical min and max values when you want an exact position or velocity instead of a range.
- When `streakEnabled` is `true`, particles from that spawn group leave permanent trail segments until the simulation is reset.

Example:

```json
"spawnGroups": [
  {
    "particleType": "spark",
    "count": 200,
    "minPosition": [100.0, 100.0],
    "maxPosition": [500.0, 150.0],
    "minVelocity": [-8.0, -2.0],
    "maxVelocity": [8.0, 2.0],
    "streakEnabled": true
  }
]
```

### `geometry`

This required section defines the simulation container and static obstacles.

Required field:

- `bounds`

Optional field:

- `obstacles`

#### Bounds

`bounds` must be a rectangle with:

- `min` - `[x, y]`
- `max` - `[x, y]`

Rules:

- `max.x` must be greater than `min.x`
- `max.y` must be greater than `min.y`

Example:

```json
"bounds": {
  "min": [0.0, 0.0],
  "max": [1280.0, 720.0]
}
```

#### Obstacles

`obstacles` is an array of static shapes. Supported shape types are:

- `rectangle`
- `circle`

Rectangle fields:

- `type`: `"rectangle"`
- `position`: `[x, y]`
- `size`: `[width, height]`
- `restitution`: optional, `0.0` to `1.0`

Circle fields:

- `type`: `"circle"`
- `center`: `[x, y]`
- `radius`: positive number
- `restitution`: optional, `0.0` to `1.0`

Example:

```json
"geometry": {
  "bounds": {
    "min": [0.0, 0.0],
    "max": [1280.0, 720.0]
  },
  "obstacles": [
    {
      "type": "rectangle",
      "position": [300.0, 450.0],
      "size": [500.0, 20.0],
      "restitution": 0.9
    },
    {
      "type": "circle",
      "center": [900.0, 300.0],
      "radius": 60.0,
      "restitution": 0.85
    }
  ]
}
```

### Data Types and Validation Rules

The parser currently expects:

- vectors as arrays with exactly 2 numbers
- colors as arrays with exactly 3 or 4 integers
- positive values for `width`, `height`, `targetFps`, `count`, `radius`, `mass`, and obstacle sizes
- `restitution` values between `0.0` and `1.0`
- a valid `particleType` name in every spawn group

Common mistakes that will fail parsing:

- using strings instead of numeric arrays for vectors
- misspelling force `type` or obstacle `type`
- forgetting `particleTypes`, `spawnGroups`, or `geometry`
- setting `count` to `0`
- giving rectangle obstacles a non-positive `size`

### Practical Tips

- Start with a small scene first, then increase `count`.
- Keep `bounds` the same aspect ratio as the window for a cleaner view.
- Omit `forces` entirely if you want a zero-gravity sandbox.
- Use the sample files in [`scenarios`](./scenarios) as templates:
  - `minimal_zero_gravity.json`
  - `force_showcase.json`
  - `obstacle_course.json`
  - `stress_test.json`
