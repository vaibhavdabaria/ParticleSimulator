#pragma once

#include <cstddef>
#include <cstdint>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json_fwd.hpp>

#include "particle_simulator/config.hpp"
#include "particle_simulator/simulation.hpp"

namespace particle_simulator {

struct SimulationLaunchOptions {
  Scenario scenario;
  ScenarioOverrides overrides;
  double speedMultiplier = 1.0;
  bool paused = false;
};

struct SimulationSceneSnapshot {
  Scenario scenario;
  std::uint32_t resolvedSeed = 0;
  double gridCellSize = 16.0;
};

struct SimulationSnapshot {
  std::uint64_t sequence = 0;
  double simulationTime = 0.0;
  bool paused = false;
  double speedMultiplier = 1.0;
  std::size_t particleCount = 0;
  std::uint32_t resolvedSeed = 0;
  double gridCellSize = 16.0;
  std::vector<Particle> particles;
  std::vector<TrailSegment> trailSegments;
};

class SimulationSession {
 public:
  explicit SimulationSession(SimulationLaunchOptions options);

  void Play();
  void Pause();
  void Reset();
  void StepOnce();
  void SetSpeedMultiplier(double speedMultiplier);

  [[nodiscard]] bool Update(double frameTimeSeconds);
  [[nodiscard]] SimulationSceneSnapshot GetSceneSnapshot() const;
  [[nodiscard]] SimulationSnapshot CaptureSnapshot();
  [[nodiscard]] bool IsPaused() const;
  [[nodiscard]] double GetSpeedMultiplier() const;

 private:
  mutable std::mutex mutex_;
  SimulationEngine engine_;
  double speedMultiplier_ = 1.0;
  bool paused_ = false;
  double accumulator_ = 0.0;
  double simulationTime_ = 0.0;
  std::uint64_t nextSequence_ = 1;
};

nlohmann::json SerializeScenarioToJson(const Scenario& scenario);
nlohmann::json SerializeSceneSnapshotToJson(const SimulationSceneSnapshot& snapshot);
nlohmann::json SerializeSimulationSnapshotToJson(const SimulationSnapshot& snapshot);

}  // namespace particle_simulator
