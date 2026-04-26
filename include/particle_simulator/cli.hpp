#pragma once

#include <cstdint>
#include <optional>
#include <string>

namespace particle_simulator {

// Result of parsing the command line. Optional fields only override values that
// are otherwise read from the scenario file.
struct CommandLineOptions {
  std::string scenarioPath;
  std::optional<int> width;
  std::optional<int> height;
  std::optional<double> speed;
  std::optional<std::uint32_t> seed;
  bool paused = false;
  bool showHelp = false;
};

// Parse argv into a validated options struct.
CommandLineOptions ParseCommandLine(int argc, char** argv);

// Build the short usage string shown on --help and on fatal CLI errors.
std::string BuildUsage(const std::string& programName);

}  // namespace particle_simulator
