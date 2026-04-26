import { useEffect, useRef, useState, type ReactNode } from 'react'

import { buildWebSocketUrl, createSession, fetchBundledScenarios, parseServerEvent } from './api'
import {
  createDefaultForce,
  createDefaultObstacle,
  createDefaultParticleType,
  createDefaultScenario,
  createDefaultSpawnGroup,
  normalizeScenario,
  serializeScenario,
  validateScenario,
} from './scenario'
import type {
  BundledScenario,
  ColorRgba,
  ForceDefinition,
  ObstacleDefinition,
  ParticleTypeDefinition,
  Scenario,
  ServerEvent,
  SimulationSceneSnapshot,
  SimulationSnapshot,
  Vec2,
} from './types'
import { WebGLSceneRenderer } from './webglRenderer'
import './App.css'

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
type AppRoute = 'home' | 'settings'

interface SnapshotMetrics {
  sequence: number
  simulationTime: number
  paused: boolean
  speedMultiplier: number
  particleCount: number
}

interface StreamInstrumentation {
  snapshotCount: number
  totalBytes: number
  totalParseMs: number
  lastDrawMs: number
}

interface SnapshotFrame {
  snapshot: SimulationSnapshot
  receivedAt: number
}

function getRouteFromPathname(pathname: string): AppRoute {
  return pathname === '/settings' ? 'settings' : 'home'
}

function navigateTo(route: AppRoute) {
  const nextPath = route === 'settings' ? '/settings' : '/'
  window.history.pushState({}, '', nextPath)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function makeUniqueParticleTypeName(
  particleTypes: Record<string, ParticleTypeDefinition>,
  preferredName: string,
  currentName?: string,
): string {
  const normalized = preferredName.trim() || 'particle'
  if (normalized === currentName) {
    return normalized
  }
  if (!particleTypes[normalized]) {
    return normalized
  }

  let suffix = 2
  while (particleTypes[`${normalized}-${suffix}`]) {
    suffix += 1
  }
  return `${normalized}-${suffix}`
}

function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="field">
      <span className="fieldLabel">{label}</span>
      {children}
      {hint ? <span className="fieldHint">{hint}</span> : null}
    </label>
  )
}

function RoundIconButton({
  label,
  children,
  onClick,
  asLabel = false,
}: {
  label: string
  children: ReactNode
  onClick?: () => void
  asLabel?: boolean
}) {
  if (asLabel) {
    return (
      <label className="roundIconButton" title={label} aria-label={label} data-label={label}>
        {children}
      </label>
    )
  }

  return (
    <button
      type="button"
      className="roundIconButton"
      title={label}
      aria-label={label}
      data-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function PlusIcon() {
  return <span className="iconGlyph">+</span>
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="iconSvg" aria-hidden="true">
      <path
        d="M12 18V7M12 7l-4 4M12 7l4 4M6 19h12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="iconSvg" aria-hidden="true">
      <path
        d="M12 6v11M12 17l-4-4M12 17l4-4M6 19h12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function LoadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="iconSvg" aria-hidden="true">
      <path
        d="M5.5 9.5V18h13V9.5M8 9.5h8M9 9.5V7h6v2.5M12 14V9.5M12 14l-3-3M12 14l3-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="iconSvg" aria-hidden="true">
      <path
        d="M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Zm8 3.2-1.7-.6a6.9 6.9 0 0 0-.5-1.3l.8-1.6-1.8-1.8-1.6.8c-.4-.2-.8-.4-1.3-.5L12 4l-1.1 1.9c-.4.1-.9.3-1.3.5L8 5.6 6.2 7.4 7 9c-.2.4-.4.8-.5 1.3L4.6 12l1.9 1.1c.1.4.3.9.5 1.3l-.8 1.6 1.8 1.8 1.6-.8c.4.2.8.4 1.3.5L12 20l1.1-1.9c.4-.1.9-.3 1.3-.5l1.6.8 1.8-1.8-.8-1.6c.2-.4.4-.8.5-1.3L20 12Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="iconSvg" aria-hidden="true">
      <path d="M8 6.5v11l9-5.5-9-5.5Z" fill="currentColor" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="iconSvg" aria-hidden="true">
      <path
        d="M8.5 6.5v11M15.5 6.5v11"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" className="iconSvg" aria-hidden="true">
      <rect x="7.5" y="7.5" width="9" height="9" rx="1.6" fill="currentColor" />
    </svg>
  )
}

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" className="iconSvg" aria-hidden="true">
      <path
        d="M9.4 9.1a2.8 2.8 0 1 1 4.8 1.9c-.8.8-1.7 1.2-1.7 2.3M12 17.2h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function NumberField({
  label,
  value,
  onChange,
  min,
  step = 'any',
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  step?: number | 'any'
}) {
  return (
    <Field label={label}>
      <input
        className="textInput"
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  )
}

function OptionalNumberField({
  label,
  value,
  onChange,
  min,
  step = 'any',
}: {
  label: string
  value?: number
  onChange: (value: number | undefined) => void
  min?: number
  step?: number | 'any'
}) {
  return (
    <Field label={label}>
      <input
        className="textInput"
        type="number"
        value={value ?? ''}
        min={min}
        step={step}
        onChange={(event) => {
          onChange(event.target.value === '' ? undefined : Number(event.target.value))
        }}
      />
    </Field>
  )
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Field label={label}>
      <input className="textInput" type="text" value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  )
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="checkboxField">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function Vec2Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: Vec2
  onChange: (value: Vec2) => void
}) {
  return (
    <div className="vectorField">
      <span className="fieldLabel">{label}</span>
      <div className="vectorInputs">
        <input
          className="textInput"
          type="number"
          value={value[0]}
          step="any"
          onChange={(event) => onChange([Number(event.target.value), value[1]])}
        />
        <input
          className="textInput"
          type="number"
          value={value[1]}
          step="any"
          onChange={(event) => onChange([value[0], Number(event.target.value)])}
        />
      </div>
    </div>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: ColorRgba
  onChange: (value: ColorRgba) => void
}) {
  const hex = `#${value
    .slice(0, 3)
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`

  return (
    <div className="colorField">
      <span className="fieldLabel">{label}</span>
      <div className="colorRow">
        <input
          className="colorPicker"
          type="color"
          value={hex}
          onChange={(event) => {
            const color = event.target.value
            const next: ColorRgba = [
              Number.parseInt(color.slice(1, 3), 16),
              Number.parseInt(color.slice(3, 5), 16),
              Number.parseInt(color.slice(5, 7), 16),
              value[3],
            ]
            onChange(next)
          }}
        />
        <div className="colorInputs">
          {value.map((channel, index) => (
            <input
              key={`${label}-${index}`}
              className="textInput"
              type="number"
              min={0}
              max={255}
              step={1}
              value={channel}
              onChange={(event) => {
                const next = [...value] as ColorRgba
                next[index] = Number(event.target.value)
                onChange(next)
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function findClosestSpeedIndex(speedOptions: number[], currentSpeed: number): number {
  let closestIndex = 0
  let closestDelta = Number.POSITIVE_INFINITY

  speedOptions.forEach((speed, index) => {
    const delta = Math.abs(speed - currentSpeed)
    if (delta < closestDelta) {
      closestDelta = delta
      closestIndex = index
    }
  })

  return closestIndex
}

function HomePage({
  bundledScenarios,
  selectedScenarioId,
  setSelectedScenarioId,
  showScenarioPicker,
  setShowScenarioPicker,
  scenarioDisplayName,
  builderMessage,
  loadSelectedBundledScenario,
  uploadScenarioFile,
  downloadScenario,
  runScenario,
  snapshot,
  achievedFrameRate,
  canvasRef,
  sendCommand,
  stopSession,
}: {
  bundledScenarios: BundledScenario[]
  selectedScenarioId: string
  setSelectedScenarioId: (value: string) => void
  showScenarioPicker: boolean
  setShowScenarioPicker: (value: boolean | ((previous: boolean) => boolean)) => void
  scenarioDisplayName: string
  builderMessage: string
  loadSelectedBundledScenario: () => void
  uploadScenarioFile: (file: File) => Promise<void>
  downloadScenario: () => void
  runScenario: () => Promise<void>
  snapshot: SnapshotMetrics | null
  achievedFrameRate: number | null
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  sendCommand: (payload: object) => void
  stopSession: () => void
}) {
  const speedOptions = [0.25, 0.5, 1, 1.5, 2, 3, 4]
  const currentSpeed = snapshot?.speedMultiplier ?? 1
  const currentSpeedIndex = findClosestSpeedIndex(speedOptions, currentSpeed)
  const particleCount = snapshot?.particleCount ?? 0
  const simulationTime = snapshot ? `${snapshot.simulationTime.toFixed(2)}s` : '0.00s'
  const frameRateLabel =
    snapshot?.paused ? '0 fps' : achievedFrameRate === null ? '-- fps' : `${Math.round(achievedFrameRate)} fps`
  const [scenarioSearch, setScenarioSearch] = useState('')
  const [scenarioFlash, setScenarioFlash] = useState(false)
  const filteredScenarios = bundledScenarios.filter((scenario) =>
    scenario.name.toLowerCase().includes(scenarioSearch.trim().toLowerCase()),
  )

  useEffect(() => {
    setScenarioFlash(true)
    const timeout = window.setTimeout(() => setScenarioFlash(false), 850)
    return () => window.clearTimeout(timeout)
  }, [scenarioDisplayName])

  useEffect(() => {
    if (!showScenarioPicker) {
      setScenarioSearch('')
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowScenarioPicker(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [showScenarioPicker, setShowScenarioPicker])

  return (
    <div className="appShell simplifiedShell">
      <header className="hero simplifiedHero">
        <div>
          <h1>Particle Simulator</h1>
        </div>
        <button
          type="button"
          className="helpButton"
          title="Help"
          aria-label="Open Help"
          onClick={() => window.open('/help.html', 'particle-simulator-help', 'popup=yes,width=1080,height=820,resizable=yes,scrollbars=yes')}
        >
          <HelpIcon />
          <span>Help</span>
        </button>
      </header>

      <main className="homeWorkspace">
        <div className="simulationControlsPanel">
          <div className="controlStrip">
            <div className="transportCluster">
              <button
                type="button"
                className="transportButton transportButtonPrimary"
                title={snapshot?.paused ? 'Play' : 'Pause'}
                aria-label={snapshot?.paused ? 'Play' : 'Pause'}
                onClick={() => sendCommand({ type: snapshot?.paused ? 'play' : 'pause' })}
              >
                {snapshot?.paused ? <PlayIcon /> : <PauseIcon />}
              </button>
              <button
                type="button"
                className="transportButton"
                title="Stop"
                aria-label="Stop"
                onClick={stopSession}
              >
                <StopIcon />
              </button>
            </div>
            <div className="playbackMetrics" aria-label="Simulation summary">
              <div className="playbackMetric">
                <span>Particles</span>
                <strong>{particleCount}</strong>
              </div>
              <div className="playbackMetric">
                <span>Sim Time</span>
                <strong>{simulationTime}</strong>
              </div>
              <div className="playbackMetric">
                <span>Frame Rate</span>
                <strong>{frameRateLabel}</strong>
              </div>
            </div>
            <div
              className={`playbackScenarioInfo${scenarioFlash ? ' playbackScenarioInfoFlash' : ''}`}
              title={scenarioDisplayName}
            >
              <span className="playbackScenarioLabel">Scenario</span>
              <strong className="playbackScenarioValue">{scenarioDisplayName}</strong>
            </div>
            <div className="speedRail">
              <span className="speedLabel">Speed</span>
              <div className="speedCluster">
                <input
                  className="speedSlider"
                  type="range"
                  min={0}
                  max={speedOptions.length - 1}
                  step={1}
                  value={currentSpeedIndex}
                  onChange={(event) =>
                    sendCommand({
                      type: 'setSpeed',
                      speedMultiplier: speedOptions[Number(event.target.value)],
                    })
                  }
                />
                <span className="speedValue">{currentSpeed}x</span>
              </div>
            </div>
          </div>
          {builderMessage ? <p className="statusMessage playbackStatusMessage">{builderMessage}</p> : null}
        </div>

        <section className="simulationColumn">
          <div className="viewerCanvasPanel viewerCanvasPanelLarge">
            <canvas ref={canvasRef} className="viewerCanvas viewerCanvasLarge" />
          </div>
        </section>

        <aside className="builderSidebar">
          <div className="panel builderPane">
            <div className="builderToolbar">
              <RoundIconButton
                label={showScenarioPicker ? 'Hide Scenarios' : 'Choose Scenario'}
                onClick={() => setShowScenarioPicker((previous) => !previous)}
              >
                <PlusIcon />
              </RoundIconButton>
              <RoundIconButton
                label="Load Scenario"
                onClick={() => {
                  loadSelectedBundledScenario()
                  setShowScenarioPicker(false)
                }}
              >
                <LoadIcon />
              </RoundIconButton>
              <RoundIconButton label="Upload Scenario" asLabel>
                <UploadIcon />
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) {
                      void uploadScenarioFile(file)
                    }
                    event.target.value = ''
                  }}
                />
              </RoundIconButton>
              <RoundIconButton label="Download Scenario" onClick={downloadScenario}>
                <DownloadIcon />
              </RoundIconButton>
              <button
                className="primaryButton builderActionButton builderRoundAction"
                title="Run Scenario"
                onClick={() => void runScenario()}
              >
                Run
              </button>
              <button
                className="linkButton builderActionButton builderRoundAction"
                title="Additional Settings"
                data-label="Additional Settings"
                onClick={() => navigateTo('settings')}
              >
                <GearIcon />
              </button>
            </div>
          </div>
        </aside>
      </main>

      {showScenarioPicker ? (
        <div
          className="commandPaletteBackdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowScenarioPicker(false)
            }
          }}
        >
          <section className="commandPalette" role="dialog" aria-modal="true" aria-labelledby="scenario-palette-title">
            <div className="commandPaletteHeader">
              <div>
                <p className="commandPaletteKicker">Scenario</p>
                <h2 id="scenario-palette-title">Choose Scenario</h2>
              </div>
              <button
                type="button"
                className="commandPaletteClose"
                aria-label="Close scenario chooser"
                onClick={() => setShowScenarioPicker(false)}
              >
                x
              </button>
            </div>
            <input
              className="commandPaletteSearch"
              type="search"
              autoFocus
              placeholder="Search scenarios..."
              value={scenarioSearch}
              onChange={(event) => setScenarioSearch(event.target.value)}
            />
            <div className="commandPaletteList" role="listbox" aria-label="Bundled scenarios">
              {filteredScenarios.length > 0 ? (
                filteredScenarios.map((scenario) => (
                  <button
                    key={scenario.id}
                    type="button"
                    className={`commandPaletteItem${scenario.id === selectedScenarioId ? ' commandPaletteItemActive' : ''}`}
                    role="option"
                    aria-selected={scenario.id === selectedScenarioId}
                    onClick={() => {
                      setSelectedScenarioId(scenario.id)
                      setShowScenarioPicker(false)
                    }}
                  >
                    <span>{scenario.name}</span>
                    {scenario.id === selectedScenarioId ? <strong>Selected</strong> : null}
                  </button>
                ))
              ) : (
                <p className="commandPaletteEmpty">No matching scenarios.</p>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

function AdditionalSettingsPage({
  draft,
  updateDraft,
  validationErrors,
  showJsonPreview,
  setShowJsonPreview,
}: {
  draft: Scenario
  updateDraft: (nextDraft: Scenario) => void
  validationErrors: string[]
  showJsonPreview: boolean
  setShowJsonPreview: (value: boolean | ((previous: boolean) => boolean)) => void
}) {
  const particleTypeNames = Object.keys(draft.particleTypes)

  return (
    <div className="appShell settingsShell">
      <header className="hero settingsHero">
        <div>
          <p className="eyebrow">Additional Settings</p>
          <h1>Advanced Scenario Builder</h1>
          <p className="heroText">
            Configure the full scenario here, then return to the home page to run and watch it.
          </p>
        </div>
        <div className="settingsHeroActions">
          <button className="secondaryButton" onClick={() => navigateTo('home')}>
            Back to Simulation
          </button>
        </div>
      </header>

      <main className="settingsWorkspace">
        <div className="panel validationPanel">
          <div className="validationHeader">
            <div>
              <p className="panelKicker">Validation</p>
              <h3>Scenario status</h3>
            </div>
            <strong className={validationErrors.length === 0 ? 'statusOk' : 'statusWarn'}>
              {validationErrors.length === 0 ? 'Ready to run' : `${validationErrors.length} issue(s)`}
            </strong>
          </div>
          {validationErrors.length === 0 ? (
            <p className="validationEmpty">The scenario matches the parser’s expected schema.</p>
          ) : (
            <ul className="validationList">
              {validationErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel">
          <p className="panelKicker">Window</p>
          <h3>Presentation</h3>
          <div className="formGrid">
            <NumberField
              label="Width"
              value={draft.window.width}
              min={1}
              step={1}
              onChange={(value) => updateDraft({ ...draft, window: { ...draft.window, width: value } })}
            />
            <NumberField
              label="Height"
              value={draft.window.height}
              min={1}
              step={1}
              onChange={(value) => updateDraft({ ...draft, window: { ...draft.window, height: value } })}
            />
            <TextField
              label="Title"
              value={draft.window.title}
              onChange={(value) => updateDraft({ ...draft, window: { ...draft.window, title: value } })}
            />
            <NumberField
              label="Target FPS"
              value={draft.window.targetFps}
              min={1}
              step={1}
              onChange={(value) => updateDraft({ ...draft, window: { ...draft.window, targetFps: value } })}
            />
          </div>
          <ColorField
            label="Background Color"
            value={draft.window.backgroundColor}
            onChange={(value) => updateDraft({ ...draft, window: { ...draft.window, backgroundColor: value } })}
          />
        </div>

        <div className="panel">
          <div className="sectionHeader">
            <div>
              <p className="panelKicker">Forces</p>
              <h3>External fields</h3>
            </div>
            <div className="sectionActions">
              {(['gravity', 'drag', 'wind', 'radial'] as ForceDefinition['type'][]).map((type) => (
                <button
                  key={type}
                  className="chipButton"
                  onClick={() => updateDraft({ ...draft, forces: [...draft.forces, createDefaultForce(type)] })}
                >
                  + {type}
                </button>
              ))}
            </div>
          </div>

          <div className="cardStack">
            {draft.forces.length === 0 ? <p className="emptyState">No forces configured.</p> : null}
            {draft.forces.map((force, index) => (
              <article key={`force-${index}`} className="card">
                <div className="cardHeader">
                  <select
                    className="textInput compactInput"
                    value={force.type}
                    onChange={(event) => {
                      const nextForce = createDefaultForce(event.target.value as ForceDefinition['type'])
                      updateDraft({
                        ...draft,
                        forces: draft.forces.map((item, itemIndex) => (itemIndex === index ? nextForce : item)),
                      })
                    }}
                  >
                    <option value="gravity">gravity</option>
                    <option value="drag">drag</option>
                    <option value="wind">wind</option>
                    <option value="radial">radial</option>
                  </select>
                  <button
                    className="dangerButton"
                    onClick={() =>
                      updateDraft({
                        ...draft,
                        forces: draft.forces.filter((_, forceIndex) => forceIndex !== index),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
                {force.type === 'drag' ? (
                  <NumberField
                    label="Coefficient"
                    value={force.coefficient}
                    min={0}
                    onChange={(value) =>
                      updateDraft({
                        ...draft,
                        forces: draft.forces.map((item, itemIndex) =>
                          itemIndex === index ? { ...force, coefficient: value } : item,
                        ),
                      })
                    }
                  />
                ) : null}
                {force.type === 'gravity' || force.type === 'wind' ? (
                  <Vec2Field
                    label="Acceleration"
                    value={force.acceleration}
                    onChange={(value) =>
                      updateDraft({
                        ...draft,
                        forces: draft.forces.map((item, itemIndex) =>
                          itemIndex === index ? { ...force, acceleration: value } : item,
                        ),
                      })
                    }
                  />
                ) : null}
                {force.type === 'radial' ? (
                  <div className="formGrid">
                    <Vec2Field
                      label="Origin"
                      value={force.origin}
                      onChange={(value) =>
                        updateDraft({
                          ...draft,
                          forces: draft.forces.map((item, itemIndex) =>
                            itemIndex === index ? { ...force, origin: value } : item,
                          ),
                        })
                      }
                    />
                    <NumberField
                      label="Strength"
                      value={force.strength}
                      onChange={(value) =>
                        updateDraft({
                          ...draft,
                          forces: draft.forces.map((item, itemIndex) =>
                            itemIndex === index ? { ...force, strength: value } : item,
                          ),
                        })
                      }
                    />
                    <NumberField
                      label="Radius"
                      value={force.radius}
                      min={0.000001}
                      onChange={(value) =>
                        updateDraft({
                          ...draft,
                          forces: draft.forces.map((item, itemIndex) =>
                            itemIndex === index ? { ...force, radius: value } : item,
                          ),
                        })
                      }
                    />
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="sectionHeader">
            <div>
              <p className="panelKicker">Particle Types</p>
              <h3>Reusable templates</h3>
            </div>
            <button
              className="chipButton"
              onClick={() => {
                const name = makeUniqueParticleTypeName(draft.particleTypes, 'particle')
                updateDraft({
                  ...draft,
                  particleTypes: {
                    ...draft.particleTypes,
                    [name]: createDefaultParticleType(),
                  },
                })
              }}
            >
              + Add particle type
            </button>
          </div>

          <div className="cardStack">
            {Object.entries(draft.particleTypes).map(([name, particleType]) => (
              <article key={name} className="card">
                <div className="cardHeader">
                  <TextField
                    label="Name"
                    value={name}
                    onChange={(value) => {
                      const nextName = makeUniqueParticleTypeName(draft.particleTypes, value, name)
                      const nextParticleTypes: Record<string, ParticleTypeDefinition> = {}
                      Object.entries(draft.particleTypes).forEach(([entryName, entryType]) => {
                        nextParticleTypes[entryName === name ? nextName : entryName] = entryType
                      })

                      updateDraft({
                        ...draft,
                        particleTypes: nextParticleTypes,
                        spawnGroups: draft.spawnGroups.map((group) =>
                          group.particleType === name ? { ...group, particleType: nextName } : group,
                        ),
                      })
                    }}
                  />
                  {Object.keys(draft.particleTypes).length > 1 ? (
                    <button
                      className="dangerButton"
                      onClick={() => {
                        const remaining = Object.fromEntries(
                          Object.entries(draft.particleTypes).filter(([entryName]) => entryName !== name),
                        )
                        const fallbackType = Object.keys(remaining)[0]
                        updateDraft({
                          ...draft,
                          particleTypes: remaining,
                          spawnGroups: draft.spawnGroups.map((group) =>
                            group.particleType === name ? { ...group, particleType: fallbackType } : group,
                          ),
                        })
                      }}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <div className="formGrid">
                  <NumberField
                    label="Radius"
                    value={particleType.radius}
                    min={0.000001}
                    onChange={(value) =>
                      updateDraft({
                        ...draft,
                        particleTypes: { ...draft.particleTypes, [name]: { ...particleType, radius: value } },
                      })
                    }
                  />
                  <NumberField
                    label="Mass"
                    value={particleType.mass}
                    min={0.000001}
                    onChange={(value) =>
                      updateDraft({
                        ...draft,
                        particleTypes: { ...draft.particleTypes, [name]: { ...particleType, mass: value } },
                      })
                    }
                  />
                  <NumberField
                    label="Restitution"
                    value={particleType.restitution}
                    min={0}
                    step={0.01}
                    onChange={(value) =>
                      updateDraft({
                        ...draft,
                        particleTypes: {
                          ...draft.particleTypes,
                          [name]: { ...particleType, restitution: value },
                        },
                      })
                    }
                  />
                  <Vec2Field
                    label="Initial Velocity"
                    value={particleType.initialVelocity}
                    onChange={(value) =>
                      updateDraft({
                        ...draft,
                        particleTypes: {
                          ...draft.particleTypes,
                          [name]: { ...particleType, initialVelocity: value },
                        },
                      })
                    }
                  />
                </div>
                <ColorField
                  label="Color"
                  value={particleType.color}
                  onChange={(value) =>
                    updateDraft({
                      ...draft,
                      particleTypes: { ...draft.particleTypes, [name]: { ...particleType, color: value } },
                    })
                  }
                />
              </article>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="sectionHeader">
            <div>
              <p className="panelKicker">Spawn Groups</p>
              <h3>Initial particle generation</h3>
            </div>
            <button
              className="chipButton"
              onClick={() =>
                updateDraft({
                  ...draft,
                  spawnGroups: [...draft.spawnGroups, createDefaultSpawnGroup(particleTypeNames[0] ?? 'dust')],
                })
              }
            >
              + Add spawn group
            </button>
          </div>

          <div className="cardStack">
            {draft.spawnGroups.map((group, index) => (
              <article key={`spawn-${index}`} className="card">
                <div className="cardHeader">
                  <Field label="Particle Type">
                    <select
                      className="textInput compactInput"
                      value={group.particleType}
                      onChange={(event) =>
                        updateDraft({
                          ...draft,
                          spawnGroups: draft.spawnGroups.map((item, itemIndex) =>
                            itemIndex === index ? { ...group, particleType: event.target.value } : item,
                          ),
                        })
                      }
                    >
                      {particleTypeNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {draft.spawnGroups.length > 1 ? (
                    <button
                      className="dangerButton"
                      onClick={() =>
                        updateDraft({
                          ...draft,
                          spawnGroups: draft.spawnGroups.filter((_, spawnIndex) => spawnIndex !== index),
                        })
                      }
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <div className="formGrid">
                  <NumberField
                    label="Count"
                    value={group.count}
                    min={1}
                    step={1}
                    onChange={(value) =>
                      updateDraft({
                        ...draft,
                        spawnGroups: draft.spawnGroups.map((item, itemIndex) =>
                          itemIndex === index ? { ...group, count: value } : item,
                        ),
                      })
                    }
                  />
                  <OptionalNumberField
                    label="Radius Override"
                    value={group.radius}
                    min={0.000001}
                    onChange={(value) =>
                      updateDraft({
                        ...draft,
                        spawnGroups: draft.spawnGroups.map((item, itemIndex) =>
                          itemIndex === index ? { ...group, radius: value } : item,
                        ),
                      })
                    }
                  />
                  <OptionalNumberField
                    label="Mass Override"
                    value={group.mass}
                    min={0.000001}
                    onChange={(value) =>
                      updateDraft({
                        ...draft,
                        spawnGroups: draft.spawnGroups.map((item, itemIndex) =>
                          itemIndex === index ? { ...group, mass: value } : item,
                        ),
                      })
                    }
                  />
                  <OptionalNumberField
                    label="Restitution Override"
                    value={group.restitution}
                    min={0}
                    step={0.01}
                    onChange={(value) =>
                      updateDraft({
                        ...draft,
                        spawnGroups: draft.spawnGroups.map((item, itemIndex) =>
                          itemIndex === index ? { ...group, restitution: value } : item,
                        ),
                      })
                    }
                  />
                </div>
                <div className="formGrid">
                  <Vec2Field
                    label="Min Position"
                    value={group.minPosition}
                    onChange={(value) =>
                      updateDraft({
                        ...draft,
                        spawnGroups: draft.spawnGroups.map((item, itemIndex) =>
                          itemIndex === index ? { ...group, minPosition: value } : item,
                        ),
                      })
                    }
                  />
                  <Vec2Field
                    label="Max Position"
                    value={group.maxPosition}
                    onChange={(value) =>
                      updateDraft({
                        ...draft,
                        spawnGroups: draft.spawnGroups.map((item, itemIndex) =>
                          itemIndex === index ? { ...group, maxPosition: value } : item,
                        ),
                      })
                    }
                  />
                  <Vec2Field
                    label="Min Velocity"
                    value={group.minVelocity}
                    onChange={(value) =>
                      updateDraft({
                        ...draft,
                        spawnGroups: draft.spawnGroups.map((item, itemIndex) =>
                          itemIndex === index ? { ...group, minVelocity: value } : item,
                        ),
                      })
                    }
                  />
                  <Vec2Field
                    label="Max Velocity"
                    value={group.maxVelocity}
                    onChange={(value) =>
                      updateDraft({
                        ...draft,
                        spawnGroups: draft.spawnGroups.map((item, itemIndex) =>
                          itemIndex === index ? { ...group, maxVelocity: value } : item,
                        ),
                      })
                    }
                  />
                </div>
                <ColorField
                  label="Optional Color Override"
                  value={group.color ?? [255, 255, 255, 255]}
                  onChange={(value) =>
                    updateDraft({
                      ...draft,
                      spawnGroups: draft.spawnGroups.map((item, itemIndex) =>
                        itemIndex === index ? { ...group, color: value } : item,
                      ),
                    })
                  }
                />
                <CheckboxField
                  label="Leave permanent streaks"
                  checked={group.streakEnabled}
                  onChange={(value) =>
                    updateDraft({
                      ...draft,
                      spawnGroups: draft.spawnGroups.map((item, itemIndex) =>
                        itemIndex === index ? { ...group, streakEnabled: value } : item,
                      ),
                    })
                  }
                />
              </article>
            ))}
          </div>
        </div>

        <div className="panel">
          <p className="panelKicker">Geometry</p>
          <h3>Bounds + obstacles</h3>
          <div className="formGrid">
            <Vec2Field
              label="Bounds Min"
              value={draft.geometry.bounds.min}
              onChange={(value) =>
                updateDraft({
                  ...draft,
                  geometry: { ...draft.geometry, bounds: { ...draft.geometry.bounds, min: value } },
                })
              }
            />
            <Vec2Field
              label="Bounds Max"
              value={draft.geometry.bounds.max}
              onChange={(value) =>
                updateDraft({
                  ...draft,
                  geometry: { ...draft.geometry, bounds: { ...draft.geometry.bounds, max: value } },
                })
              }
            />
          </div>

          <div className="sectionHeader sectionHeaderTight">
            <h4>Obstacles</h4>
            <div className="sectionActions">
              {(['rectangle', 'circle'] as ObstacleDefinition['type'][]).map((type) => (
                <button
                  key={type}
                  className="chipButton"
                  onClick={() =>
                    updateDraft({
                      ...draft,
                      geometry: {
                        ...draft.geometry,
                        obstacles: [...draft.geometry.obstacles, createDefaultObstacle(type)],
                      },
                    })
                  }
                >
                  + {type}
                </button>
              ))}
            </div>
          </div>

          <div className="cardStack">
            {draft.geometry.obstacles.length === 0 ? <p className="emptyState">No obstacles configured.</p> : null}
            {draft.geometry.obstacles.map((obstacle, index) => (
              <article key={`obstacle-${index}`} className="card">
                <div className="cardHeader">
                  <select
                    className="textInput compactInput"
                    value={obstacle.type}
                    onChange={(event) => {
                      const nextObstacle = createDefaultObstacle(event.target.value as ObstacleDefinition['type'])
                      updateDraft({
                        ...draft,
                        geometry: {
                          ...draft.geometry,
                          obstacles: draft.geometry.obstacles.map((item, itemIndex) =>
                            itemIndex === index ? nextObstacle : item,
                          ),
                        },
                      })
                    }}
                  >
                    <option value="rectangle">rectangle</option>
                    <option value="circle">circle</option>
                  </select>
                  <button
                    className="dangerButton"
                    onClick={() =>
                      updateDraft({
                        ...draft,
                        geometry: {
                          ...draft.geometry,
                          obstacles: draft.geometry.obstacles.filter((_, obstacleIndex) => obstacleIndex !== index),
                        },
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
                {obstacle.type === 'rectangle' ? (
                  <div className="formGrid">
                    <Vec2Field
                      label="Position"
                      value={obstacle.position}
                      onChange={(value) =>
                        updateDraft({
                          ...draft,
                          geometry: {
                            ...draft.geometry,
                            obstacles: draft.geometry.obstacles.map((item, itemIndex) =>
                              itemIndex === index ? { ...obstacle, position: value } : item,
                            ),
                          },
                        })
                      }
                    />
                    <Vec2Field
                      label="Size"
                      value={obstacle.size}
                      onChange={(value) =>
                        updateDraft({
                          ...draft,
                          geometry: {
                            ...draft.geometry,
                            obstacles: draft.geometry.obstacles.map((item, itemIndex) =>
                              itemIndex === index ? { ...obstacle, size: value } : item,
                            ),
                          },
                        })
                      }
                    />
                    <OptionalNumberField
                      label="Restitution"
                      value={obstacle.restitution}
                      min={0}
                      step={0.01}
                      onChange={(value) =>
                        updateDraft({
                          ...draft,
                          geometry: {
                            ...draft.geometry,
                            obstacles: draft.geometry.obstacles.map((item, itemIndex) =>
                              itemIndex === index ? { ...obstacle, restitution: value } : item,
                            ),
                          },
                        })
                      }
                    />
                  </div>
                ) : (
                  <div className="formGrid">
                    <Vec2Field
                      label="Center"
                      value={obstacle.center}
                      onChange={(value) =>
                        updateDraft({
                          ...draft,
                          geometry: {
                            ...draft.geometry,
                            obstacles: draft.geometry.obstacles.map((item, itemIndex) =>
                              itemIndex === index ? { ...obstacle, center: value } : item,
                            ),
                          },
                        })
                      }
                    />
                    <NumberField
                      label="Radius"
                      value={obstacle.radius}
                      min={0.000001}
                      onChange={(value) =>
                        updateDraft({
                          ...draft,
                          geometry: {
                            ...draft.geometry,
                            obstacles: draft.geometry.obstacles.map((item, itemIndex) =>
                              itemIndex === index ? { ...obstacle, radius: value } : item,
                            ),
                          },
                        })
                      }
                    />
                    <OptionalNumberField
                      label="Restitution"
                      value={obstacle.restitution}
                      min={0}
                      step={0.01}
                      onChange={(value) =>
                        updateDraft({
                          ...draft,
                          geometry: {
                            ...draft.geometry,
                            obstacles: draft.geometry.obstacles.map((item, itemIndex) =>
                              itemIndex === index ? { ...obstacle, restitution: value } : item,
                            ),
                          },
                        })
                      }
                    />
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="sectionHeader">
            <div>
              <p className="panelKicker">JSON</p>
              <h3>Canonical payload</h3>
            </div>
            <button className="secondaryButton" onClick={() => setShowJsonPreview((value) => !value)}>
              {showJsonPreview ? 'Hide Preview' : 'Show Preview'}
            </button>
          </div>
          {showJsonPreview ? <pre className="jsonPreview">{serializeScenario(draft)}</pre> : null}
        </div>
      </main>
    </div>
  )
}

function App() {
  const [route, setRoute] = useState<AppRoute>(() => getRouteFromPathname(window.location.pathname))
  const [draft, setDraft] = useState<Scenario>(() => createDefaultScenario())
  const [bundledScenarios, setBundledScenarios] = useState<BundledScenario[]>([])
  const [selectedScenarioId, setSelectedScenarioId] = useState('')
  const [showScenarioPicker, setShowScenarioPicker] = useState(false)
  const [scenarioDisplayName, setScenarioDisplayName] = useState('Custom Scenario')
  const [builderMessage, setBuilderMessage] = useState('')
  const [showJsonPreview, setShowJsonPreview] = useState(false)
  const [, setConnectionState] = useState<ConnectionState>('idle')
  const [snapshotMetrics, setSnapshotMetrics] = useState<SnapshotMetrics | null>(null)
  const [achievedFrameRate, setAchievedFrameRate] = useState<number | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const sceneRef = useRef<SimulationSceneSnapshot | null>(null)
  const snapshotRef = useRef<SimulationSnapshot | null>(null)
  const previousSnapshotRef = useRef<SnapshotFrame | null>(null)
  const latestSnapshotRef = useRef<SnapshotFrame | null>(null)
  const interpolatedSnapshotRef = useRef<SimulationSnapshot | null>(null)
  const interpolationPositionsRef = useRef<Float32Array | null>(null)
  const rendererRef = useRef<WebGLSceneRenderer | null>(null)
  const webGlErrorShownRef = useRef(false)
  const renderRequestedRef = useRef(true)
  const instrumentationRef = useRef<StreamInstrumentation>({
    snapshotCount: 0,
    totalBytes: 0,
    totalParseMs: 0,
    lastDrawMs: 0,
  })
  const frameRateSampleRef = useRef<{ lastFrameTime: number | null; intervals: number[]; lastReportedTime: number }>({
    lastFrameTime: null,
    intervals: [],
    lastReportedTime: 0,
  })
  const validationErrors = validateScenario(draft)

  useEffect(() => {
    const handlePopState = () => {
      setRoute(getRouteFromPathname(window.location.pathname))
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const scenarios = await fetchBundledScenarios()
        setBundledScenarios(scenarios)
        setSelectedScenarioId(scenarios[0]?.id ?? '')
      } catch (error) {
        setBuilderMessage(error instanceof Error ? error.message : 'Failed to load bundled scenarios.')
      }
    })()

    return () => {
      socketRef.current?.close()
    }
  }, [])

  useEffect(() => {
    let animationFrame = 0

    const render = () => {
      const now = performance.now()
      if (canvasRef.current && route === 'home') {
        if (rendererRef.current && !rendererRef.current.isRenderingCanvas(canvasRef.current)) {
          rendererRef.current = null
          webGlErrorShownRef.current = false
        }
        if (!rendererRef.current && !webGlErrorShownRef.current) {
          try {
            rendererRef.current = new WebGLSceneRenderer(canvasRef.current)
          } catch (error) {
            webGlErrorShownRef.current = true
            setBuilderMessage(error instanceof Error ? error.message : 'WebGL2 is required to render the simulation.')
          }
        }
        const shouldInterpolate =
          latestSnapshotRef.current !== null &&
          previousSnapshotRef.current !== null &&
          !latestSnapshotRef.current.snapshot.paused
        if (
          rendererRef.current &&
          sceneRef.current &&
          (renderRequestedRef.current || shouldInterpolate || rendererRef.current.isDisplaySizeDirty())
        ) {
          try {
            const snapshotToRender = getSnapshotForRender(now)
            instrumentationRef.current.lastDrawMs = rendererRef.current.render(sceneRef.current, snapshotToRender)
            updateAchievedFrameRate(now, snapshotToRender)
            renderRequestedRef.current = false
          } catch (error) {
            rendererRef.current = null
            renderRequestedRef.current = true
            setBuilderMessage(error instanceof Error ? error.message : 'WebGL rendering failed.')
          }
        }
      }
      animationFrame = window.requestAnimationFrame(render)
    }

    animationFrame = window.requestAnimationFrame(render)
    return () => {
      window.cancelAnimationFrame(animationFrame)
    }
  }, [route])

  useEffect(() => {
    if (!selectedScenarioId) {
      return
    }

    const selectedScenario = bundledScenarios.find((scenario) => scenario.id === selectedScenarioId)
    if (!selectedScenario) {
      return
    }

    setScenarioDisplayName((currentLabel) => (currentLabel === 'Custom Scenario' ? currentLabel : selectedScenario.name))
  }, [bundledScenarios, selectedScenarioId])

  function updateDraft(nextDraft: Scenario) {
    setDraft(nextDraft)
    setScenarioDisplayName('Custom Scenario')
  }

  function loadSelectedBundledScenario() {
    const nextScenario = bundledScenarios.find((scenario) => scenario.id === selectedScenarioId)
    if (!nextScenario) {
      return
    }

    setDraft(normalizeScenario(nextScenario.scenario))
    setScenarioDisplayName(nextScenario.name)
    setBuilderMessage('')
  }

  async function uploadScenarioFile(file: File) {
    try {
      const text = await file.text()
      setDraft(normalizeScenario(JSON.parse(text)))
      setScenarioDisplayName('Custom Scenario')
      setBuilderMessage(`Loaded "${file.name}" into the builder.`)
    } catch (error) {
      setBuilderMessage(error instanceof Error ? error.message : 'Failed to parse the uploaded JSON file.')
    }
  }

  function downloadScenario() {
    const blob = new Blob([serializeScenario(draft)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'particle-scenario.json'
    anchor.click()
    URL.revokeObjectURL(url)
    setBuilderMessage('Downloaded the current scenario as JSON.')
  }

  async function runScenario() {
    if (validationErrors.length > 0) {
      setBuilderMessage(`Fix validation issues before running. First issue: ${validationErrors[0]}`)
      return
    }

    socketRef.current?.close()
    setConnectionState('connecting')
    frameRateSampleRef.current = { lastFrameTime: null, intervals: [], lastReportedTime: 0 }
    sceneRef.current = null
    snapshotRef.current = null
    previousSnapshotRef.current = null
    latestSnapshotRef.current = null
    interpolatedSnapshotRef.current = null
    interpolationPositionsRef.current = null
    renderRequestedRef.current = true
    instrumentationRef.current = {
      snapshotCount: 0,
      totalBytes: 0,
      totalParseMs: 0,
      lastDrawMs: 0,
    }
    setSnapshotMetrics(null)
    setAchievedFrameRate(null)

    try {
      const sessionId = await createSession({ scenario: draft })
      const socket = new WebSocket(buildWebSocketUrl(sessionId))
      socket.binaryType = 'arraybuffer'
      socketRef.current = socket

      socket.onopen = () => {
        if (socketRef.current !== socket) {
          return
        }
        setConnectionState('connecting')
      }

      socket.onmessage = (event) => {
        if (socketRef.current !== socket) {
          return
        }
        const rawMessage = event.data as string | ArrayBuffer
        const parseStart = performance.now()
        const serverEvent = parseServerEvent(rawMessage)
        const parseMs = performance.now() - parseStart
        if (serverEvent.type === 'snapshot') {
          recordSnapshotInstrumentation(typeof rawMessage === 'string' ? rawMessage.length : rawMessage.byteLength, parseMs)
        }
        handleServerEvent(serverEvent)
      }

      socket.onerror = () => {
        if (socketRef.current !== socket) {
          return
        }
        setConnectionState('error')
      }

      socket.onclose = () => {
        if (socketRef.current !== socket) {
          return
        }
        setConnectionState('disconnected')
      }
    } catch (error) {
      setConnectionState('error')
    }
  }

  function handleServerEvent(event: ServerEvent) {
    switch (event.type) {
      case 'sessionReady':
        sceneRef.current = event.scene
        snapshotRef.current = null
        previousSnapshotRef.current = null
        latestSnapshotRef.current = null
        interpolatedSnapshotRef.current = null
        interpolationPositionsRef.current = null
        renderRequestedRef.current = true
        setConnectionState('connected')
        return
      case 'snapshot':
        previousSnapshotRef.current = latestSnapshotRef.current
        latestSnapshotRef.current = {
          snapshot: event.snapshot,
          receivedAt: performance.now(),
        }
        snapshotRef.current = event.snapshot
        renderRequestedRef.current = true
        setSnapshotMetrics({
          sequence: event.snapshot.sequence,
          simulationTime: event.snapshot.simulationTime,
          paused: event.snapshot.paused,
          speedMultiplier: event.snapshot.speedMultiplier,
          particleCount: event.snapshot.particleCount,
        })
        setConnectionState('connected')
        return
      case 'status':
        return
      case 'error':
        setConnectionState('error')
    }
  }

  function recordSnapshotInstrumentation(byteCount: number, parseMs: number) {
    const stats = instrumentationRef.current
    stats.snapshotCount += 1
    stats.totalBytes += byteCount
    stats.totalParseMs += parseMs

    if (import.meta.env.DEV && stats.snapshotCount % 60 === 0) {
      console.debug('Particle stream metrics', {
        avgSnapshotKb: Number((stats.totalBytes / stats.snapshotCount / 1024).toFixed(1)),
        avgParseMs: Number((stats.totalParseMs / stats.snapshotCount).toFixed(2)),
        lastDrawMs: Number(stats.lastDrawMs.toFixed(2)),
      })
    }
  }

  function getSnapshotForRender(now: number): SimulationSnapshot | null {
    const latestFrame = latestSnapshotRef.current
    if (!latestFrame) {
      return snapshotRef.current
    }

    const previousFrame = previousSnapshotRef.current
    const latestSnapshot = latestFrame.snapshot
    if (
      !previousFrame ||
      latestSnapshot.paused ||
      previousFrame.snapshot.particleCount !== latestSnapshot.particleCount ||
      previousFrame.snapshot.particles.positions.length !== latestSnapshot.particles.positions.length ||
      previousFrame.snapshot.particles.positionsAreNormalized !== true ||
      latestSnapshot.particles.positionsAreNormalized !== true
    ) {
      return latestSnapshot
    }

    const previousPositions = previousFrame.snapshot.particles.positions
    const latestPositions = latestSnapshot.particles.positions
    const positionCount = latestPositions.length
    if (interpolationPositionsRef.current?.length !== positionCount) {
      interpolationPositionsRef.current = new Float32Array(positionCount)
    }

    const interval = Math.min(250, Math.max(16, latestFrame.receivedAt - previousFrame.receivedAt))
    const renderTime = now - interval
    const alpha = Math.min(1, Math.max(0, (renderTime - previousFrame.receivedAt) / interval))
    const interpolatedPositions = interpolationPositionsRef.current
    for (let index = 0; index < positionCount; index += 1) {
      const previous = previousPositions[index] / 65535
      const latest = latestPositions[index] / 65535
      interpolatedPositions[index] = previous + (latest - previous) * alpha
    }

    const interpolatedSnapshot = interpolatedSnapshotRef.current
    if (!interpolatedSnapshot) {
      interpolatedSnapshotRef.current = {
        ...latestSnapshot,
        particles: {
          positions: interpolatedPositions,
          positionsAreNormalized: true,
        },
      }
    } else {
      interpolatedSnapshot.sequence = latestSnapshot.sequence
      interpolatedSnapshot.simulationTime =
        previousFrame.snapshot.simulationTime +
        (latestSnapshot.simulationTime - previousFrame.snapshot.simulationTime) * alpha
      interpolatedSnapshot.paused = latestSnapshot.paused
      interpolatedSnapshot.speedMultiplier = latestSnapshot.speedMultiplier
      interpolatedSnapshot.particleCount = latestSnapshot.particleCount
      interpolatedSnapshot.resolvedSeed = latestSnapshot.resolvedSeed
      interpolatedSnapshot.gridCellSize = latestSnapshot.gridCellSize
      interpolatedSnapshot.particles.positions = interpolatedPositions
      interpolatedSnapshot.particles.positionsAreNormalized = true
      interpolatedSnapshot.trailSegments = latestSnapshot.trailSegments
    }
    return interpolatedSnapshotRef.current
  }

  function updateAchievedFrameRate(now: number, renderedSnapshot: SimulationSnapshot | null) {
    const sample = frameRateSampleRef.current
    if (!renderedSnapshot || renderedSnapshot.paused) {
      sample.lastFrameTime = null
      sample.intervals = []
      setAchievedFrameRate(null)
      return
    }

    if (sample.lastFrameTime !== null) {
      const interval = now - sample.lastFrameTime
      if (interval > 0 && interval < 1000) {
        sample.intervals = [...sample.intervals.slice(-29), interval]
        if (now - sample.lastReportedTime >= 250) {
          const averageInterval =
            sample.intervals.reduce((total, current) => total + current, 0) / sample.intervals.length
          setAchievedFrameRate(1000 / averageInterval)
          sample.lastReportedTime = now
        }
      }
    }
    sample.lastFrameTime = now
  }

  function sendCommand(payload: object) {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      return
    }
    socketRef.current.send(JSON.stringify(payload))
  }

  function stopSession() {
    sendCommand({ type: 'reset' })
    sendCommand({ type: 'pause' })
  }

  if (route === 'settings') {
    return (
      <AdditionalSettingsPage
        draft={draft}
        updateDraft={updateDraft}
        validationErrors={validationErrors}
        showJsonPreview={showJsonPreview}
        setShowJsonPreview={setShowJsonPreview}
      />
    )
  }

  return (
    <HomePage
      bundledScenarios={bundledScenarios}
      selectedScenarioId={selectedScenarioId}
      setSelectedScenarioId={(value) => {
        setSelectedScenarioId(value)
        const nextScenario = bundledScenarios.find((scenario) => scenario.id === value)
        setScenarioDisplayName(nextScenario?.name ?? 'Custom Scenario')
      }}
      showScenarioPicker={showScenarioPicker}
      setShowScenarioPicker={setShowScenarioPicker}
      scenarioDisplayName={scenarioDisplayName}
      builderMessage={builderMessage}
      loadSelectedBundledScenario={loadSelectedBundledScenario}
      uploadScenarioFile={uploadScenarioFile}
      downloadScenario={downloadScenario}
      runScenario={runScenario}
      snapshot={snapshotMetrics}
      achievedFrameRate={achievedFrameRate}
      canvasRef={canvasRef}
      sendCommand={sendCommand}
      stopSession={stopSession}
    />
  )
}

export default App
