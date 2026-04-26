#include "particle_simulator/app.hpp"

#include <algorithm>
#include <stdexcept>
#include <type_traits>
#include <utility>

#include <nlohmann/json.hpp>

namespace particle_simulator {

namespace {

nlohmann::json SerializeVec2(const Vec2& value) {
  return nlohmann::json::array({value.x, value.y});
}

nlohmann::json SerializeColor(const ColorRgba& color) {
  return nlohmann::json::array({color.r, color.g, color.b, color.a});
}

nlohmann::json SerializeForce(const ForceDefinition& force) {
  return std::visit(
      [](const auto& typedForce) -> nlohmann::json {
        using ForceType = std::decay_t<decltype(typedForce)>;
        if constexpr (std::is_same_v<ForceType, GravityForce>) {
          return {
              {"type", "gravity"},
              {"acceleration", SerializeVec2(typedForce.acceleration)},
          };
        } else if constexpr (std::is_same_v<ForceType, DragForce>) {
          return {
              {"type", "drag"},
              {"coefficient", typedForce.coefficient},
          };
        } else if constexpr (std::is_same_v<ForceType, WindForce>) {
          return {
              {"type", "wind"},
              {"acceleration", SerializeVec2(typedForce.acceleration)},
          };
        } else {
          return {
              {"type", "radial"},
              {"origin", SerializeVec2(typedForce.origin)},
              {"strength", typedForce.strength},
              {"radius", typedForce.radius},
          };
        }
      },
      force);
}

nlohmann::json SerializeObstacle(const ObstacleDefinition& obstacle) {
  return std::visit(
      [](const auto& typedObstacle) -> nlohmann::json {
        using ObstacleType = std::decay_t<decltype(typedObstacle)>;
        if constexpr (std::is_same_v<ObstacleType, RectangleObstacle>) {
          return {
              {"type", "rectangle"},
              {"position", SerializeVec2(typedObstacle.position)},
              {"size", SerializeVec2(typedObstacle.size)},
              {"restitution", typedObstacle.restitution},
          };
        } else {
          return {
              {"type", "circle"},
              {"center", SerializeVec2(typedObstacle.center)},
              {"radius", typedObstacle.radius},
              {"restitution", typedObstacle.restitution},
          };
        }
      },
      obstacle);
}

nlohmann::json SerializeParticle(const Particle& particle) {
  return {
      {"position", SerializeVec2(particle.position)},
      {"velocity", SerializeVec2(particle.velocity)},
      {"radius", particle.radius},
      {"mass", particle.mass},
      {"restitution", particle.restitution},
      {"color", SerializeColor(particle.color)},
      {"streakEnabled", particle.streakEnabled},
  };
}

nlohmann::json SerializeTrailSegment(const TrailSegment& trailSegment) {
  return {
      {"start", SerializeVec2(trailSegment.start)},
      {"end", SerializeVec2(trailSegment.end)},
      {"color", SerializeColor(trailSegment.color)},
  };
}

Scenario ApplyLaunchOptions(SimulationLaunchOptions options) {
  if (options.speedMultiplier <= 0.0) {
    throw std::runtime_error("Simulation speed must be positive.");
  }

  ApplyOverrides(options.scenario, options.overrides);
  return options.scenario;
}

}  // namespace

SimulationSession::SimulationSession(SimulationLaunchOptions options)
    : engine_(ApplyLaunchOptions(std::move(options))) {
  speedMultiplier_ = options.speedMultiplier;
  paused_ = options.paused;
}

void SimulationSession::Play() {
  std::scoped_lock lock(mutex_);
  paused_ = false;
}

void SimulationSession::Pause() {
  std::scoped_lock lock(mutex_);
  paused_ = true;
}

void SimulationSession::Reset() {
  std::scoped_lock lock(mutex_);
  engine_.Reset();
  accumulator_ = 0.0;
  simulationTime_ = 0.0;
}

void SimulationSession::StepOnce() {
  std::scoped_lock lock(mutex_);
  const double timestep = engine_.GetScenario().simulation.timestep;
  engine_.Step(timestep);
  accumulator_ = 0.0;
  simulationTime_ += timestep;
}

void SimulationSession::SetSpeedMultiplier(double speedMultiplier) {
  if (speedMultiplier <= 0.0) {
    throw std::runtime_error("Simulation speed must be positive.");
  }

  std::scoped_lock lock(mutex_);
  speedMultiplier_ = speedMultiplier;
}

bool SimulationSession::Update(double frameTimeSeconds) {
  if (frameTimeSeconds <= 0.0) {
    return false;
  }

  std::scoped_lock lock(mutex_);
  if (paused_) {
    return false;
  }

  const double timestep = engine_.GetScenario().simulation.timestep;
  accumulator_ += frameTimeSeconds * speedMultiplier_;

  int steps = 0;
  while (accumulator_ >= timestep && steps < 8) {
    engine_.Step(timestep);
    accumulator_ -= timestep;
    simulationTime_ += timestep;
    ++steps;
  }

  if (steps == 8) {
    accumulator_ = 0.0;
  }

  return steps > 0;
}

SimulationSceneSnapshot SimulationSession::GetSceneSnapshot() const {
  std::scoped_lock lock(mutex_);
  return {
      engine_.GetScenario(),
      engine_.GetResolvedSeed(),
      engine_.GetGridCellSize(),
  };
}

SimulationSnapshot SimulationSession::CaptureSnapshot() {
  std::scoped_lock lock(mutex_);
  SimulationSnapshot snapshot;
  snapshot.sequence = nextSequence_++;
  snapshot.simulationTime = simulationTime_;
  snapshot.paused = paused_;
  snapshot.speedMultiplier = speedMultiplier_;
  snapshot.particleCount = engine_.GetParticleCount();
  snapshot.resolvedSeed = engine_.GetResolvedSeed();
  snapshot.gridCellSize = engine_.GetGridCellSize();
  snapshot.particles = engine_.GetParticles();
  snapshot.trailSegments = engine_.GetTrailSegments();
  return snapshot;
}

bool SimulationSession::IsPaused() const {
  std::scoped_lock lock(mutex_);
  return paused_;
}

double SimulationSession::GetSpeedMultiplier() const {
  std::scoped_lock lock(mutex_);
  return speedMultiplier_;
}

nlohmann::json SerializeScenarioToJson(const Scenario& scenario) {
  nlohmann::json particleTypes = nlohmann::json::object();
  for (const auto& [name, definition] : scenario.particleTypes) {
    particleTypes[name] = {
        {"radius", definition.radius},
        {"mass", definition.mass},
        {"restitution", definition.restitution},
        {"color", SerializeColor(definition.color)},
        {"initialVelocity", SerializeVec2(definition.initialVelocity)},
    };
  }

  nlohmann::json spawnGroups = nlohmann::json::array();
  for (const auto& group : scenario.spawnGroups) {
    nlohmann::json entry = {
        {"particleType", group.particleType},
        {"count", group.count},
        {"minPosition", SerializeVec2(group.minPosition)},
        {"maxPosition", SerializeVec2(group.maxPosition)},
        {"minVelocity", SerializeVec2(group.minVelocity)},
        {"maxVelocity", SerializeVec2(group.maxVelocity)},
        {"streakEnabled", group.streakEnabled},
    };
    if (group.radius) {
      entry["radius"] = *group.radius;
    }
    if (group.mass) {
      entry["mass"] = *group.mass;
    }
    if (group.restitution) {
      entry["restitution"] = *group.restitution;
    }
    if (group.color) {
      entry["color"] = SerializeColor(*group.color);
    }
    spawnGroups.push_back(std::move(entry));
  }

  nlohmann::json forces = nlohmann::json::array();
  for (const auto& force : scenario.forces) {
    forces.push_back(SerializeForce(force));
  }

  nlohmann::json obstacles = nlohmann::json::array();
  for (const auto& obstacle : scenario.geometry.obstacles) {
    obstacles.push_back(SerializeObstacle(obstacle));
  }

  nlohmann::json simulation = {
      {"timestep", scenario.simulation.timestep},
      {"collisionIterations", scenario.simulation.collisionIterations},
  };
  if (scenario.simulation.seed) {
    simulation["seed"] = *scenario.simulation.seed;
  }
  if (scenario.simulation.gridCellSize) {
    simulation["gridCellSize"] = *scenario.simulation.gridCellSize;
  }

  return {
      {"window",
       {
           {"width", scenario.window.width},
           {"height", scenario.window.height},
           {"title", scenario.window.title},
           {"backgroundColor", SerializeColor(scenario.window.backgroundColor)},
           {"targetFps", scenario.window.targetFps},
       }},
      {"simulation", std::move(simulation)},
      {"forces", std::move(forces)},
      {"particleTypes", std::move(particleTypes)},
      {"spawnGroups", std::move(spawnGroups)},
      {"geometry",
       {
           {"bounds",
            {
                {"min", SerializeVec2(scenario.geometry.bounds.min)},
                {"max", SerializeVec2(scenario.geometry.bounds.max)},
            }},
           {"obstacles", std::move(obstacles)},
       }},
  };
}

nlohmann::json SerializeSceneSnapshotToJson(const SimulationSceneSnapshot& snapshot) {
  return {
      {"scenario", SerializeScenarioToJson(snapshot.scenario)},
      {"resolvedSeed", snapshot.resolvedSeed},
      {"gridCellSize", snapshot.gridCellSize},
  };
}

nlohmann::json SerializeSimulationSnapshotToJson(const SimulationSnapshot& snapshot) {
  nlohmann::json particles = nlohmann::json::array();
  for (const auto& particle : snapshot.particles) {
    particles.push_back(SerializeParticle(particle));
  }

  nlohmann::json trailSegments = nlohmann::json::array();
  for (const auto& trailSegment : snapshot.trailSegments) {
    trailSegments.push_back(SerializeTrailSegment(trailSegment));
  }

  return {
      {"sequence", snapshot.sequence},
      {"simulationTime", snapshot.simulationTime},
      {"paused", snapshot.paused},
      {"speedMultiplier", snapshot.speedMultiplier},
      {"particleCount", snapshot.particleCount},
      {"resolvedSeed", snapshot.resolvedSeed},
      {"gridCellSize", snapshot.gridCellSize},
      {"particles", std::move(particles)},
      {"trailSegments", std::move(trailSegments)},
  };
}

}  // namespace particle_simulator
