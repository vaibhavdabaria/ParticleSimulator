#pragma once

#include <filesystem>
#include <optional>
#include <string>

#include "particle_simulator/scenario.hpp"

namespace particle_simulator {

// Transport-neutral scenario overrides shared by CLI and web entrypoints.
struct ScenarioOverrides {
  std::optional<int> width;
  std::optional<int> height;
  std::optional<std::uint32_t> seed;
};

// Load and validate a scenario JSON file from disk.
Scenario LoadScenarioFromFile(const std::filesystem::path& filePath);
Scenario LoadScenarioFromJsonString(const std::string& jsonText);

// Apply runtime overrides on top of the scenario file values.
void ApplyOverrides(Scenario& scenario, const ScenarioOverrides& overrides);

}  // namespace particle_simulator
