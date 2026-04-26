#include "particle_simulator/simulation.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <random>
#include <stdexcept>
#include <type_traits>
#include <unordered_map>
#include <utility>
#include <vector>

namespace particle_simulator {

namespace {

// Grid cell coordinate used by the broad-phase collision structure.
struct CellCoord {
  int x = 0;
  int y = 0;

  bool operator==(const CellCoord& other) const {
    return x == other.x && y == other.y;
  }
};

// Hash support so CellCoord can be used as a key in unordered_map.
struct CellCoordHash {
  std::size_t operator()(const CellCoord& cell) const {
    const std::uint64_t ux = static_cast<std::uint64_t>(static_cast<std::uint32_t>(cell.x));
    const std::uint64_t uy = static_cast<std::uint64_t>(static_cast<std::uint32_t>(cell.y));
    return static_cast<std::size_t>((ux << 32U) ^ uy);
  }
};

// Random helpers are used only during initial particle generation.
double RandomBetween(std::mt19937& generator, double min, double max) {
  if (max < min) {
    std::swap(min, max);
  }
  std::uniform_real_distribution<double> distribution(min, max);
  return distribution(generator);
}

Vec2 RandomVec2(std::mt19937& generator, const Vec2& min, const Vec2& max) {
  return {
      RandomBetween(generator, min.x, max.x),
      RandomBetween(generator, min.y, max.y),
  };
}

// If the user does not specify a grid size, derive one from the largest
// particle radius so the broad-phase stays reasonably efficient by default.
double ComputeDefaultGridCellSize(const Scenario& scenario) {
  double maxRadius = 4.0;
  for (const auto& [name, particleType] : scenario.particleTypes) {
    (void)name;
    maxRadius = std::max(maxRadius, particleType.radius);
  }
  for (const auto& group : scenario.spawnGroups) {
    if (group.radius) {
      maxRadius = std::max(maxRadius, *group.radius);
    }
  }
  return std::max(12.0, maxRadius * 2.5);
}

// Convert world position into a broad-phase collision cell.
CellCoord ComputeCell(const Vec2& position, double cellSize) {
  return {
      static_cast<int>(std::floor(position.x / cellSize)),
      static_cast<int>(std::floor(position.y / cellSize)),
  };
}

// Combine all active forces into one acceleration vector for a particle.
Vec2 ComputeAcceleration(const Particle& particle, const std::vector<ForceDefinition>& forces) {
  Vec2 acceleration{};
  for (const auto& force : forces) {
    std::visit(
        [&](const auto& typedForce) {
          using ForceType = std::decay_t<decltype(typedForce)>;
          if constexpr (std::is_same_v<ForceType, GravityForce>) {
            acceleration += typedForce.acceleration;
          } else if constexpr (std::is_same_v<ForceType, DragForce>) {
            // Drag always opposes current velocity.
            acceleration -= particle.velocity * typedForce.coefficient;
          } else if constexpr (std::is_same_v<ForceType, WindForce>) {
            acceleration += typedForce.acceleration;
          } else if constexpr (std::is_same_v<ForceType, RadialForce>) {
            // Radial force uses an inverse-square falloff, with radius acting as
            // a hard cutoff so the field affects only a bounded region.
            const Vec2 offset = typedForce.origin - particle.position;
            const double distanceSquared = LengthSquared(offset);
            const double radiusSquared = typedForce.radius * typedForce.radius;
            if (distanceSquared > 1e-12 && distanceSquared <= radiusSquared) {
              const double distance = std::sqrt(distanceSquared);
              const Vec2 direction = offset / distance;
              acceleration += direction * (typedForce.strength / distanceSquared);
            }
          }
        },
        force);
  }
  return acceleration;
}

// Resolve an elastic collision between two circular particles.
void ResolveParticlePair(Particle& first, Particle& second) {
  const Vec2 delta = second.position - first.position;
  const double combinedRadius = first.radius + second.radius;
  const double distanceSquared = LengthSquared(delta);
  if (distanceSquared >= combinedRadius * combinedRadius) {
    return;
  }

  const double distance = std::sqrt(std::max(distanceSquared, 0.0));
  const Vec2 normal = distance > 1e-6 ? delta / distance : Vec2{1.0, 0.0};
  const double inverseMassFirst = first.mass > 0.0 ? 1.0 / first.mass : 0.0;
  const double inverseMassSecond = second.mass > 0.0 ? 1.0 / second.mass : 0.0;
  const double inverseMassSum = inverseMassFirst + inverseMassSecond;
  if (inverseMassSum <= 0.0) {
    return;
  }

  // First separate the particles so they are no longer overlapping.
  const double penetration = combinedRadius - distance;
  const Vec2 correction = normal * (penetration / inverseMassSum);
  first.position -= correction * inverseMassFirst;
  second.position += correction * inverseMassSecond;

  // Then apply an impulse that flips the relative velocity along the collision
  // normal using the lower restitution of the two particles.
  const Vec2 relativeVelocity = second.velocity - first.velocity;
  const double velocityAlongNormal = Dot(relativeVelocity, normal);
  if (velocityAlongNormal > 0.0) {
    return;
  }

  const double restitution = std::min(first.restitution, second.restitution);
  const double impulseMagnitude = -(1.0 + restitution) * velocityAlongNormal / inverseMassSum;
  const Vec2 impulse = normal * impulseMagnitude;

  first.velocity -= impulse * inverseMassFirst;
  second.velocity += impulse * inverseMassSecond;
}

}  // namespace

SimulationEngine::SimulationEngine(Scenario scenario) : scenario_(std::move(scenario)) {
  // Resolve all scenario-driven startup settings once so runtime stepping can
  // stay focused purely on simulation work.
  gridCellSize_ = scenario_.simulation.gridCellSize.value_or(ComputeDefaultGridCellSize(scenario_));
  BuildInitialParticles();
  Reset();
}

void SimulationEngine::Reset() {
  particles_ = initialParticles_;
  trailSegments_.clear();
}

void SimulationEngine::Step(double dt) {
  // The caller is expected to drive the engine with a fixed timestep, but we
  // still guard against accidental zero or negative steps.
  if (dt <= 0.0) {
    return;
  }

  // Streaks are defined by the particle's full movement over this simulation
  // step, including any position correction caused by collisions.
  std::vector<Vec2> previousPositions;
  previousPositions.reserve(particles_.size());
  for (const auto& particle : particles_) {
    previousPositions.push_back(particle.position);
  }

  Integrate(dt);
  ResolveCollisions();

  for (std::size_t index = 0; index < particles_.size(); ++index) {
    const Particle& particle = particles_[index];
    if (!particle.streakEnabled) {
      continue;
    }

    const Vec2& start = previousPositions[index];
    const Vec2& end = particle.position;
    if (LengthSquared(end - start) <= 1e-10) {
      continue;
    }

    trailSegments_.push_back({start, end, particle.color});
  }
}

const Scenario& SimulationEngine::GetScenario() const {
  return scenario_;
}

const std::vector<Particle>& SimulationEngine::GetParticles() const {
  return particles_;
}

const std::vector<TrailSegment>& SimulationEngine::GetTrailSegments() const {
  return trailSegments_;
}

std::size_t SimulationEngine::GetParticleCount() const {
  return particles_.size();
}

std::uint32_t SimulationEngine::GetResolvedSeed() const {
  return resolvedSeed_;
}

double SimulationEngine::GetGridCellSize() const {
  return gridCellSize_;
}

void SimulationEngine::BuildInitialParticles() {
  // Use either the scenario-provided seed or a fixed fallback so the same
  // scenario file remains reproducible.
  resolvedSeed_ = scenario_.simulation.seed.value_or(5489U);
  std::mt19937 generator(resolvedSeed_);

  initialParticles_.clear();

  for (const auto& group : scenario_.spawnGroups) {
    const auto iterator = scenario_.particleTypes.find(group.particleType);
    if (iterator == scenario_.particleTypes.end()) {
      throw std::runtime_error("Spawn group references unknown particle type '" + group.particleType + "'.");
    }

    const ParticleTypeDefinition& definition = iterator->second;
    for (int count = 0; count < group.count; ++count) {
      Particle particle;

      // Positions and velocities are generated from the configured ranges.
      particle.position = RandomVec2(generator, group.minPosition, group.maxPosition);
      particle.velocity = definition.initialVelocity + RandomVec2(generator, group.minVelocity, group.maxVelocity);

      // Spawn-group values override particle-type defaults when present.
      particle.radius = group.radius.value_or(definition.radius);
      particle.mass = group.mass.value_or(definition.mass);
      particle.restitution = group.restitution.value_or(definition.restitution);
      particle.color = group.color.value_or(definition.color);
      particle.streakEnabled = group.streakEnabled;

      if (particle.radius <= 0.0 || particle.mass <= 0.0) {
        throw std::runtime_error("Generated particle has non-positive radius or mass.");
      }

      initialParticles_.push_back(particle);
    }
  }

  if (initialParticles_.empty()) {
    throw std::runtime_error("Scenario did not produce any particles.");
  }
}

void SimulationEngine::Integrate(double dt) {
  // Semi-implicit Euler integration is simple, fast, and good enough for this
  // style of real-time particle sandbox.
  for (auto& particle : particles_) {
    const Vec2 acceleration = ComputeAcceleration(particle, scenario_.forces);
    particle.velocity += acceleration * dt;
    particle.position += particle.velocity * dt;
  }
}

void SimulationEngine::ResolveCollisions() {
  const int iterations = std::max(1, scenario_.simulation.collisionIterations);
  const std::array<int, 3> offsets{-1, 0, 1};

  for (int iteration = 0; iteration < iterations; ++iteration) {
    // First resolve interactions against the static world.
    for (auto& particle : particles_) {
      ResolveBoundaryCollision(particle);
      for (const auto& obstacle : scenario_.geometry.obstacles) {
        std::visit(
            [&](const auto& typedObstacle) {
              ResolveObstacleCollision(particle, typedObstacle);
            },
            obstacle);
      }
    }

    // Then rebuild the broad-phase grid from the updated particle positions.
    std::unordered_map<CellCoord, std::vector<std::size_t>, CellCoordHash> grid;
    grid.reserve(particles_.size());
    for (std::size_t index = 0; index < particles_.size(); ++index) {
      grid[ComputeCell(particles_[index].position, gridCellSize_)].push_back(index);
    }

    // Each particle checks only its own cell and the immediate neighbors.
    // That dramatically reduces the number of pair checks compared to
    // a naive all-pairs O(n^2) scan.
    for (std::size_t index = 0; index < particles_.size(); ++index) {
      const CellCoord cell = ComputeCell(particles_[index].position, gridCellSize_);
      for (int offsetX : offsets) {
        for (int offsetY : offsets) {
          const CellCoord neighbor{cell.x + offsetX, cell.y + offsetY};
          const auto iterator = grid.find(neighbor);
          if (iterator == grid.end()) {
            continue;
          }

          for (const std::size_t otherIndex : iterator->second) {
            if (otherIndex <= index) {
              continue;
            }
            ResolveParticlePair(particles_[index], particles_[otherIndex]);
          }
        }
      }
    }
  }
}

void SimulationEngine::ResolveBoundaryCollision(Particle& particle) const {
  const auto& bounds = scenario_.geometry.bounds;

  // Bounds are expanded inward by particle radius so particles stay visually
  // inside the box rather than letting their centers touch the border.
  const double minX = bounds.min.x + particle.radius;
  const double maxX = bounds.max.x - particle.radius;
  const double minY = bounds.min.y + particle.radius;
  const double maxY = bounds.max.y - particle.radius;

  if (particle.position.x < minX) {
    particle.position.x = minX;
    if (particle.velocity.x < 0.0) {
      particle.velocity.x = -particle.velocity.x * particle.restitution;
    }
  } else if (particle.position.x > maxX) {
    particle.position.x = maxX;
    if (particle.velocity.x > 0.0) {
      particle.velocity.x = -particle.velocity.x * particle.restitution;
    }
  }

  if (particle.position.y < minY) {
    particle.position.y = minY;
    if (particle.velocity.y < 0.0) {
      particle.velocity.y = -particle.velocity.y * particle.restitution;
    }
  } else if (particle.position.y > maxY) {
    particle.position.y = maxY;
    if (particle.velocity.y > 0.0) {
      particle.velocity.y = -particle.velocity.y * particle.restitution;
    }
  }
}

void SimulationEngine::ResolveObstacleCollision(Particle& particle, const RectangleObstacle& obstacle) const {
  const Vec2 min = obstacle.position;
  const Vec2 max = obstacle.position + obstacle.size;

  // Find the closest point on the rectangle to the particle center.
  const Vec2 closest = Clamp(particle.position, min, max);
  const Vec2 delta = particle.position - closest;
  const double distanceSquared = LengthSquared(delta);

  // If the circle is outside and not intersecting the rectangle, we can stop.
  if (distanceSquared > particle.radius * particle.radius) {
    const bool insideX = particle.position.x >= min.x && particle.position.x <= max.x;
    const bool insideY = particle.position.y >= min.y && particle.position.y <= max.y;
    if (!(insideX && insideY)) {
      return;
    }
  }

  Vec2 normal{};
  if (distanceSquared > 1e-8) {
    // Standard case: push the particle outward along the nearest direction.
    const double distance = std::sqrt(distanceSquared);
    normal = delta / distance;
    particle.position += normal * (particle.radius - distance);
  } else {
    // Special case: the center is inside the rectangle, so choose the nearest
    // face manually and push the particle out through that side.
    const double distanceToLeft = std::abs(particle.position.x - min.x);
    const double distanceToRight = std::abs(max.x - particle.position.x);
    const double distanceToTop = std::abs(particle.position.y - min.y);
    const double distanceToBottom = std::abs(max.y - particle.position.y);

    double smallest = distanceToLeft;
    normal = {-1.0, 0.0};
    particle.position.x = min.x - particle.radius;

    if (distanceToRight < smallest) {
      smallest = distanceToRight;
      normal = {1.0, 0.0};
      particle.position.x = max.x + particle.radius;
    }
    if (distanceToTop < smallest) {
      smallest = distanceToTop;
      normal = {0.0, -1.0};
      particle.position = {particle.position.x, min.y - particle.radius};
    }
    if (distanceToBottom < smallest) {
      normal = {0.0, 1.0};
      particle.position = {particle.position.x, max.y + particle.radius};
    }
  }

  const double restitution = std::min(particle.restitution, obstacle.restitution);
  const double velocityAlongNormal = Dot(particle.velocity, normal);
  if (velocityAlongNormal < 0.0) {
    particle.velocity -= normal * ((1.0 + restitution) * velocityAlongNormal);
  }
}

void SimulationEngine::ResolveObstacleCollision(Particle& particle, const CircleObstacle& obstacle) const {
  Vec2 delta = particle.position - obstacle.center;
  double distance = Length(delta);
  const double targetDistance = particle.radius + obstacle.radius;
  if (distance >= targetDistance) {
    return;
  }

  // Push the particle onto the circle surface, then reflect its velocity.
  Vec2 normal = distance > 1e-8 ? delta / distance : Vec2{1.0, 0.0};
  particle.position = obstacle.center + normal * targetDistance;

  const double restitution = std::min(particle.restitution, obstacle.restitution);
  const double velocityAlongNormal = Dot(particle.velocity, normal);
  if (velocityAlongNormal < 0.0) {
    particle.velocity -= normal * ((1.0 + restitution) * velocityAlongNormal);
  }
}

}  // namespace particle_simulator
