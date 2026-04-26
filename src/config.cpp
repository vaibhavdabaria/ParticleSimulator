#include "particle_simulator/config.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>

#include <nlohmann/json.hpp>

namespace particle_simulator {

namespace {

using json = nlohmann::json;

// Small validation helpers keep the section readers below focused on intent
// rather than repeating the same "is this object/array/number?" checks.
const json& RequireMember(const json& node, const char* key, const std::string& path) {
  if (!node.contains(key)) {
    throw std::runtime_error("Missing required field '" + path + "." + key + "'.");
  }
  return node.at(key);
}

const json& RequireObject(const json& node, const std::string& path) {
  if (!node.is_object()) {
    throw std::runtime_error("Expected object at '" + path + "'.");
  }
  return node;
}

const json& RequireArray(const json& node, const std::string& path) {
  if (!node.is_array()) {
    throw std::runtime_error("Expected array at '" + path + "'.");
  }
  return node;
}

double ReadPositiveDouble(const json& node, const std::string& path) {
  if (!node.is_number()) {
    throw std::runtime_error("Expected number at '" + path + "'.");
  }
  const double value = node.get<double>();
  if (value <= 0.0) {
    throw std::runtime_error("Expected positive number at '" + path + "'.");
  }
  return value;
}

double ReadNonNegativeDouble(const json& node, const std::string& path) {
  if (!node.is_number()) {
    throw std::runtime_error("Expected number at '" + path + "'.");
  }
  const double value = node.get<double>();
  if (value < 0.0) {
    throw std::runtime_error("Expected non-negative number at '" + path + "'.");
  }
  return value;
}

double ReadDouble(const json& node, const std::string& path) {
  if (!node.is_number()) {
    throw std::runtime_error("Expected number at '" + path + "'.");
  }
  return node.get<double>();
}

int ReadPositiveInt(const json& node, const std::string& path) {
  if (!node.is_number_integer()) {
    throw std::runtime_error("Expected integer at '" + path + "'.");
  }
  const int value = node.get<int>();
  if (value <= 0) {
    throw std::runtime_error("Expected positive integer at '" + path + "'.");
  }
  return value;
}

bool ReadBool(const json& node, const std::string& path) {
  if (!node.is_boolean()) {
    throw std::runtime_error("Expected boolean at '" + path + "'.");
  }
  return node.get<bool>();
}

// Colors are stored as integer channel arrays in the scenario file.
ColorRgba ReadColor(const json& node, const std::string& path) {
  const auto& array = RequireArray(node, path);
  if (array.size() != 3 && array.size() != 4) {
    throw std::runtime_error("Expected color array with 3 or 4 channels at '" + path + "'.");
  }

  auto readChannel = [&](std::size_t index) -> std::uint8_t {
    const std::string channelPath = path + "[" + std::to_string(index) + "]";
    if (!array.at(index).is_number_integer()) {
      throw std::runtime_error("Expected integer color channel at '" + channelPath + "'.");
    }
    const int value = array.at(index).get<int>();
    if (value < 0 || value > 255) {
      throw std::runtime_error("Color channel out of range at '" + channelPath + "'.");
    }
    return static_cast<std::uint8_t>(value);
  };

  return {
      readChannel(0),
      readChannel(1),
      readChannel(2),
      array.size() == 4 ? readChannel(3) : static_cast<std::uint8_t>(255),
  };
}

// All 2D coordinates and vectors in the schema are represented as
// two-element arrays: [x, y].
Vec2 ReadVec2(const json& node, const std::string& path) {
  const auto& array = RequireArray(node, path);
  if (array.size() != 2) {
    throw std::runtime_error("Expected 2D vector at '" + path + "'.");
  }
  return {
      ReadDouble(array.at(0), path + "[0]"),
      ReadDouble(array.at(1), path + "[1]"),
  };
}

// Read the optional presentation section. Missing fields simply keep defaults.
WindowConfig ReadWindowConfig(const json& root) {
  WindowConfig window;
  if (!root.contains("window")) {
    return window;
  }

  const auto& node = RequireObject(root.at("window"), "window");
  if (node.contains("width")) {
    window.width = ReadPositiveInt(node.at("width"), "window.width");
  }
  if (node.contains("height")) {
    window.height = ReadPositiveInt(node.at("height"), "window.height");
  }
  if (node.contains("title")) {
    if (!node.at("title").is_string()) {
      throw std::runtime_error("Expected string at 'window.title'.");
    }
    window.title = node.at("title").get<std::string>();
  }
  if (node.contains("backgroundColor")) {
    window.backgroundColor = ReadColor(node.at("backgroundColor"), "window.backgroundColor");
  }
  if (node.contains("targetFps")) {
    window.targetFps = ReadPositiveInt(node.at("targetFps"), "window.targetFps");
  }
  return window;
}

SimulationConfig BuildSimulationConfig(const WindowConfig& window) {
  SimulationConfig config;
  config.timestep = 1.0 / (static_cast<double>(window.targetFps) * 2.0);
  config.seed = static_cast<std::uint32_t>(5489 + window.targetFps);
  config.collisionIterations = std::max(1, static_cast<int>(std::lround(120.0 / window.targetFps)));
  return config;
}

// Forces are stored in-order because combining multiple forces is order
// independent today, but preserving author order makes the config easier to
// inspect and leaves room for future force types that may care about ordering.
std::vector<ForceDefinition> ReadForces(const json& root) {
  std::vector<ForceDefinition> forces;
  if (!root.contains("forces")) {
    return forces;
  }

  const auto& array = RequireArray(root.at("forces"), "forces");
  forces.reserve(array.size());
  for (std::size_t index = 0; index < array.size(); ++index) {
    const std::string path = "forces[" + std::to_string(index) + "]";
    const auto& entry = RequireObject(array.at(index), path);
    const auto& typeNode = RequireMember(entry, "type", path);
    if (!typeNode.is_string()) {
      throw std::runtime_error("Expected string at '" + path + ".type'.");
    }

    const std::string type = typeNode.get<std::string>();
    if (type == "gravity") {
      // Constant acceleration applied to every particle.
      forces.emplace_back(GravityForce{ReadVec2(RequireMember(entry, "acceleration", path), path + ".acceleration")});
    } else if (type == "drag") {
      // Velocity-proportional damping.
      forces.emplace_back(DragForce{ReadNonNegativeDouble(RequireMember(entry, "coefficient", path), path + ".coefficient")});
    } else if (type == "wind") {
      // Same data shape as gravity, but semantically a different named force.
      forces.emplace_back(WindForce{ReadVec2(RequireMember(entry, "acceleration", path), path + ".acceleration")});
    } else if (type == "radial") {
      // Point-based attraction or repulsion.
      forces.emplace_back(RadialForce{
          ReadVec2(RequireMember(entry, "origin", path), path + ".origin"),
          ReadDouble(RequireMember(entry, "strength", path), path + ".strength"),
          ReadPositiveDouble(RequireMember(entry, "radius", path), path + ".radius"),
      });
    } else {
      throw std::runtime_error("Unknown force type '" + type + "' at '" + path + ".type'.");
    }
  }

  return forces;
}

// Parse a reusable particle template.
ParticleTypeDefinition ReadParticleType(const json& node, const std::string& path) {
  const auto& object = RequireObject(node, path);

  ParticleTypeDefinition particleType;
  particleType.radius = ReadPositiveDouble(RequireMember(object, "radius", path), path + ".radius");
  particleType.mass = ReadPositiveDouble(RequireMember(object, "mass", path), path + ".mass");
  particleType.restitution = ReadNonNegativeDouble(RequireMember(object, "restitution", path), path + ".restitution");
  particleType.color = ReadColor(RequireMember(object, "color", path), path + ".color");
  if (particleType.restitution > 1.0) {
    throw std::runtime_error("Expected '" + path + ".restitution' to be between 0 and 1.");
  }
  if (object.contains("initialVelocity")) {
    particleType.initialVelocity = ReadVec2(object.at("initialVelocity"), path + ".initialVelocity");
  }

  return particleType;
}

// particleTypes is a required object keyed by developer-chosen names.
std::unordered_map<std::string, ParticleTypeDefinition> ReadParticleTypes(const json& root) {
  if (!root.contains("particleTypes")) {
    throw std::runtime_error("Missing required field 'particleTypes'.");
  }

  const auto& object = RequireObject(root.at("particleTypes"), "particleTypes");
  if (object.empty()) {
    throw std::runtime_error("Expected at least one particle type in 'particleTypes'.");
  }

  std::unordered_map<std::string, ParticleTypeDefinition> particleTypes;
  for (auto iterator = object.begin(); iterator != object.end(); ++iterator) {
    particleTypes.emplace(iterator.key(), ReadParticleType(iterator.value(), "particleTypes." + iterator.key()));
  }
  return particleTypes;
}

// Spawn groups describe how concrete particles are generated at startup.
SpawnGroupDefinition ReadSpawnGroup(const json& node, const std::string& path) {
  const auto& object = RequireObject(node, path);

  SpawnGroupDefinition group;
  const auto& typeNode = RequireMember(object, "particleType", path);
  if (!typeNode.is_string()) {
    throw std::runtime_error("Expected string at '" + path + ".particleType'.");
  }
  group.particleType = typeNode.get<std::string>();
  group.count = ReadPositiveInt(RequireMember(object, "count", path), path + ".count");
  group.minPosition = ReadVec2(RequireMember(object, "minPosition", path), path + ".minPosition");
  group.maxPosition = ReadVec2(RequireMember(object, "maxPosition", path), path + ".maxPosition");
  group.minVelocity = object.contains("minVelocity") ? ReadVec2(object.at("minVelocity"), path + ".minVelocity") : Vec2{};
  group.maxVelocity = object.contains("maxVelocity") ? ReadVec2(object.at("maxVelocity"), path + ".maxVelocity") : Vec2{};

  if (object.contains("streakEnabled")) {
    group.streakEnabled = ReadBool(object.at("streakEnabled"), path + ".streakEnabled");
  }

  return group;
}

// At least one spawn group is required so the scenario produces visible output.
std::vector<SpawnGroupDefinition> ReadSpawnGroups(const json& root) {
  if (!root.contains("spawnGroups")) {
    throw std::runtime_error("Missing required field 'spawnGroups'.");
  }

  const auto& array = RequireArray(root.at("spawnGroups"), "spawnGroups");
  if (array.empty()) {
    throw std::runtime_error("Expected at least one spawn group in 'spawnGroups'.");
  }

  std::vector<SpawnGroupDefinition> spawnGroups;
  spawnGroups.reserve(array.size());
  for (std::size_t index = 0; index < array.size(); ++index) {
    spawnGroups.push_back(ReadSpawnGroup(array.at(index), "spawnGroups[" + std::to_string(index) + "]"));
  }
  return spawnGroups;
}

// Static obstacle parser. Each obstacle entry declares its type and then the
// geometry required for that type.
ObstacleDefinition ReadObstacle(const json& node, const std::string& path) {
  const auto& object = RequireObject(node, path);
  const auto& typeNode = RequireMember(object, "type", path);
  if (!typeNode.is_string()) {
    throw std::runtime_error("Expected string at '" + path + ".type'.");
  }
  const std::string type = typeNode.get<std::string>();

  if (type == "rectangle") {
    RectangleObstacle obstacle;
    obstacle.position = ReadVec2(RequireMember(object, "position", path), path + ".position");
    obstacle.size = ReadVec2(RequireMember(object, "size", path), path + ".size");
    if (obstacle.size.x <= 0.0 || obstacle.size.y <= 0.0) {
      throw std::runtime_error("Rectangle obstacle size must be positive at '" + path + ".size'.");
    }
    if (object.contains("restitution")) {
      obstacle.restitution = ReadNonNegativeDouble(object.at("restitution"), path + ".restitution");
      if (obstacle.restitution > 1.0) {
        throw std::runtime_error("Expected '" + path + ".restitution' to be between 0 and 1.");
      }
    }
    return obstacle;
  }

  if (type == "circle") {
    CircleObstacle obstacle;
    obstacle.center = ReadVec2(RequireMember(object, "center", path), path + ".center");
    obstacle.radius = ReadPositiveDouble(RequireMember(object, "radius", path), path + ".radius");
    if (object.contains("restitution")) {
      obstacle.restitution = ReadNonNegativeDouble(object.at("restitution"), path + ".restitution");
      if (obstacle.restitution > 1.0) {
        throw std::runtime_error("Expected '" + path + ".restitution' to be between 0 and 1.");
      }
    }
    return obstacle;
  }

  throw std::runtime_error("Unknown obstacle type '" + type + "' at '" + path + ".type'.");
}

// Geometry is required because the simulator always needs an outer container.
GeometryDefinition ReadGeometry(const json& root) {
  if (!root.contains("geometry")) {
    throw std::runtime_error("Missing required field 'geometry'.");
  }

  GeometryDefinition geometry;
  const auto& object = RequireObject(root.at("geometry"), "geometry");
  const auto& bounds = RequireObject(RequireMember(object, "bounds", "geometry"), "geometry.bounds");
  geometry.bounds.min = ReadVec2(RequireMember(bounds, "min", "geometry.bounds"), "geometry.bounds.min");
  geometry.bounds.max = ReadVec2(RequireMember(bounds, "max", "geometry.bounds"), "geometry.bounds.max");

  if (geometry.bounds.max.x <= geometry.bounds.min.x || geometry.bounds.max.y <= geometry.bounds.min.y) {
    throw std::runtime_error("Geometry bounds must define a positive-size rectangle.");
  }

  if (object.contains("obstacles")) {
    const auto& array = RequireArray(object.at("obstacles"), "geometry.obstacles");
    geometry.obstacles.reserve(array.size());
    for (std::size_t index = 0; index < array.size(); ++index) {
      geometry.obstacles.push_back(ReadObstacle(array.at(index), "geometry.obstacles[" + std::to_string(index) + "]"));
    }
  }

  return geometry;
}

}  // namespace

Scenario LoadScenarioFromJsonString(const std::string& jsonText) {
  json root;
  try {
    root = json::parse(jsonText);
  } catch (const json::parse_error& error) {
    throw std::runtime_error("Failed to parse JSON: " + std::string(error.what()));
  }

  RequireObject(root, "root");

  // Then map each top-level section into strongly typed C++ structures.
  Scenario scenario;
  scenario.window = ReadWindowConfig(root);
  scenario.simulation = BuildSimulationConfig(scenario.window);
  scenario.forces = ReadForces(root);
  scenario.particleTypes = ReadParticleTypes(root);
  scenario.spawnGroups = ReadSpawnGroups(root);
  scenario.geometry = ReadGeometry(root);

  return scenario;
}

Scenario LoadScenarioFromFile(const std::filesystem::path& filePath) {
  // Read and parse the raw JSON document first.
  std::ifstream input(filePath);
  if (!input) {
    throw std::runtime_error("Unable to open scenario file '" + filePath.string() + "'.");
  }

  std::ostringstream buffer;
  buffer << input.rdbuf();
  return LoadScenarioFromJsonString(buffer.str());
}

void ApplyOverrides(Scenario& scenario, const ScenarioOverrides& overrides) {
  // Runtime values intentionally take precedence over the scenario file.
  if (overrides.width) {
    scenario.window.width = *overrides.width;
  }

  if (overrides.height) {
    scenario.window.height = *overrides.height;
  }
}

}  // namespace particle_simulator
