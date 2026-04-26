#include <cstdint>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>

#include <doctest/doctest.h>

#include "particle_simulator/config.hpp"

namespace {

std::filesystem::path WriteTempScenario(const std::string& fileName, const std::string& content) {
  const std::filesystem::path path = std::filesystem::temp_directory_path() / fileName;
  std::ofstream output(path);
  output << content;
  output.close();
  return path;
}

}  // namespace

TEST_CASE("minimal scenario loads without gravity") {
  const std::filesystem::path path = WriteTempScenario(
      "particle_simulator_config_minimal.json",
      R"json({
        "window": { "width": 800, "height": 600, "title": "Test" },
        "particleTypes": {
          "dust": {
            "radius": 4.0,
            "mass": 1.0,
            "restitution": 0.8,
            "color": [255, 200, 120, 255],
            "initialVelocity": [0.0, 0.0]
          }
        },
        "spawnGroups": [
          {
            "particleType": "dust",
            "count": 1,
            "minPosition": [10.0, 20.0],
            "maxPosition": [10.0, 20.0],
            "streakEnabled": true
          }
        ],
        "geometry": {
          "bounds": {
            "min": [0.0, 0.0],
            "max": [100.0, 100.0]
          }
        }
      })json");

  const particle_simulator::Scenario scenario = particle_simulator::LoadScenarioFromFile(path);
  std::filesystem::remove(path);
  CHECK(scenario.forces.empty());
  CHECK(scenario.window.width == 800);
  CHECK(scenario.spawnGroups.size() == 1);
  CHECK(scenario.particleTypes.contains("dust"));
  CHECK(scenario.spawnGroups.front().streakEnabled);
  CHECK(scenario.simulation.timestep == doctest::Approx(1.0 / 120.0));
  CHECK(scenario.simulation.seed == 5549U);
  CHECK(scenario.simulation.collisionIterations == 2);
}

TEST_CASE("missing required sections produces a clear error") {
  const std::filesystem::path path = WriteTempScenario(
      "particle_simulator_config_invalid.json",
      R"json({
        "particleTypes": {
          "dust": {
            "radius": 4.0,
            "mass": 1.0,
            "restitution": 0.8,
            "color": [255, 255, 255]
          }
        },
        "spawnGroups": []
      })json");

  CHECK_THROWS_WITH_AS(
      particle_simulator::LoadScenarioFromFile(path),
      doctest::Contains("spawnGroups"),
      std::runtime_error);
  std::filesystem::remove(path);
}

TEST_CASE("cli overrides replace window size") {
  particle_simulator::Scenario scenario;
  scenario.window.width = 640;
  scenario.window.height = 480;

  particle_simulator::ScenarioOverrides overrides;
  overrides.width = 1920;
  overrides.height = 1080;

  particle_simulator::ApplyOverrides(scenario, overrides);

  CHECK(scenario.window.width == 1920);
  CHECK(scenario.window.height == 1080);
}
