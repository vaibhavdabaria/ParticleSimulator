#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "particle_simulator/scenario.hpp"

namespace particle_simulator {

// Runtime particle state after the JSON config has been expanded into concrete
// instances. This is the state mutated every simulation step.
struct Particle {
  Vec2 position{};
  Vec2 velocity{};
  double radius = 4.0;
  double mass = 1.0;
  double restitution = 0.85;
  ColorRgba color{255, 255, 255, 255};
  bool streakEnabled = false;
};

// Permanent trail segment recorded for particles that have streaks enabled.
struct TrailSegment {
  Vec2 start{};
  Vec2 end{};
  ColorRgba color{255, 255, 255, 255};
};

// Grid cell coordinate used by the broad-phase collision structure.
struct CellCoord {
  int x = 0;
  int y = 0;

  bool operator==(const CellCoord& other) const {
    return x == other.x && y == other.y;
  }
};

// Owns the simulation state, including the original scenario, the generated
// initial particle set, and the current live particle array.
class SimulationEngine {
 public:
  explicit SimulationEngine(Scenario scenario);

  // Restore the simulation to the original generated particle state.
  void Reset();

  // Advance the simulation by one fixed step.
  void Step(double dt);

  [[nodiscard]] const Scenario& GetScenario() const;
  [[nodiscard]] const std::vector<Particle>& GetParticles() const;
  [[nodiscard]] const std::vector<TrailSegment>& GetTrailSegments() const;
  [[nodiscard]] std::size_t GetParticleCount() const;
  [[nodiscard]] std::uint32_t GetResolvedSeed() const;
  [[nodiscard]] double GetGridCellSize() const;

 private:
  Scenario scenario_;
  std::uint32_t resolvedSeed_ = 0;
  double gridCellSize_ = 16.0;
  std::vector<Particle> initialParticles_;
  std::vector<Particle> particles_;
  std::vector<TrailSegment> trailSegments_;
  std::vector<Vec2> previousPositions_;
  std::size_t gridColumns_ = 1;
  std::size_t gridRows_ = 1;
  std::vector<std::size_t> gridHeads_;
  std::vector<std::size_t> gridNext_;

  // Expand spawn groups into concrete particles using the resolved random seed.
  void BuildInitialParticles();

  // Prepare dense broad-phase storage from the scenario bounds and particle count.
  void BuildCollisionGridStorage();

  // Apply external forces and integrate velocity/position.
  void Integrate(double dt);

  // Resolve bounds, obstacle, and particle-particle collisions.
  void ResolveCollisions();
  void ResolveBoundaryCollision(Particle& particle) const;
  void ResolveObstacleCollision(Particle& particle, const RectangleObstacle& obstacle) const;
  void ResolveObstacleCollision(Particle& particle, const CircleObstacle& obstacle) const;
};

}  // namespace particle_simulator
