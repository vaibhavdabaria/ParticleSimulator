#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <unordered_map>
#include <variant>
#include <vector>

#include "particle_simulator/math.hpp"

namespace particle_simulator {

// Simple RGBA color used both in config data and runtime particles.
struct ColorRgba {
  std::uint8_t r = 255;
  std::uint8_t g = 255;
  std::uint8_t b = 255;
  std::uint8_t a = 255;
};

// Window-level presentation settings. These map directly to how the raylib
// window is created and how the background is cleared each frame.
struct WindowConfig {
  int width = 1280;
  int height = 720;
  std::string title = "Particle Simulator";
  ColorRgba backgroundColor{14, 18, 28, 255};
  int targetFps = 60;
};

// Global simulation settings that affect determinism and update behavior.
struct SimulationConfig {
  double timestep = 1.0 / 120.0;
  std::optional<std::uint32_t> seed;
  int collisionIterations = 1;
  std::optional<double> gridCellSize;
};

// Force definitions are stored as a tagged union (std::variant). That lets the
// config parser preserve force-specific parameters while still keeping all
// active forces in one ordered list.
struct GravityForce {
  Vec2 acceleration{};
};

struct DragForce {
  double coefficient = 0.0;
};

struct WindForce {
  Vec2 acceleration{};
};

struct RadialForce {
  Vec2 origin{};
  double strength = 0.0;
  double radius = 100.0;
};

using ForceDefinition = std::variant<GravityForce, DragForce, WindForce, RadialForce>;

// Reusable particle template referenced by spawn groups.
struct ParticleTypeDefinition {
  double radius = 4.0;
  double mass = 1.0;
  double restitution = 0.85;
  ColorRgba color{255, 255, 255, 255};
  Vec2 initialVelocity{};
};

// Spawn groups are the user-facing way to create many particles without
// listing every particle manually. Most fields are ranges used during
// deterministic random generation.
struct SpawnGroupDefinition {
  std::string particleType;
  int count = 0;
  Vec2 minPosition{};
  Vec2 maxPosition{};
  Vec2 minVelocity{};
  Vec2 maxVelocity{};
  std::optional<double> radius;
  std::optional<double> mass;
  std::optional<double> restitution;
  std::optional<ColorRgba> color;
  bool streakEnabled = false;
};

// The outer simulation container. Particles are kept inside these bounds.
struct BoundsDefinition {
  Vec2 min{};
  Vec2 max{};
};

// Static obstacles supported by the first version of the simulator.
struct RectangleObstacle {
  Vec2 position{};
  Vec2 size{};
  double restitution = 0.85;
};

struct CircleObstacle {
  Vec2 center{};
  double radius = 1.0;
  double restitution = 0.85;
};

using ObstacleDefinition = std::variant<RectangleObstacle, CircleObstacle>;

// All world geometry is static in v1: one outer bounds rectangle plus zero or
// more non-moving obstacles.
struct GeometryDefinition {
  BoundsDefinition bounds{};
  std::vector<ObstacleDefinition> obstacles;
};

// In-memory representation of the entire JSON scenario file.
struct Scenario {
  WindowConfig window{};
  SimulationConfig simulation{};
  std::vector<ForceDefinition> forces;
  std::unordered_map<std::string, ParticleTypeDefinition> particleTypes;
  std::vector<SpawnGroupDefinition> spawnGroups;
  GeometryDefinition geometry{};
};

}  // namespace particle_simulator
