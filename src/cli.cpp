#include "particle_simulator/cli.hpp"

#include <stdexcept>
#include <string>

namespace particle_simulator {

namespace {

// Options like --width and --seed require a following value. This helper keeps
// the main parser loop readable and centralizes the error message.
std::string RequireValue(int argc, char** argv, int& index, const std::string& optionName) {
  if (index + 1 >= argc) {
    throw std::runtime_error("Missing value for option '" + optionName + "'.");
  }

  ++index;
  return argv[index];
}

}  // namespace

CommandLineOptions ParseCommandLine(int argc, char** argv) {
  CommandLineOptions options;

  // With no arguments we show the usage text instead of trying to run.
  if (argc <= 1) {
    options.showHelp = true;
    return options;
  }

  // The parser is intentionally simple: one positional scenario path plus a
  // small fixed set of optional overrides.
  for (int index = 1; index < argc; ++index) {
    const std::string argument = argv[index];

    if (argument == "--help" || argument == "-h") {
      options.showHelp = true;
      return options;
    }

    if (argument == "--width") {
      options.width = std::stoi(RequireValue(argc, argv, index, argument));
      continue;
    }

    if (argument == "--height") {
      options.height = std::stoi(RequireValue(argc, argv, index, argument));
      continue;
    }

    if (argument == "--speed") {
      options.speed = std::stod(RequireValue(argc, argv, index, argument));
      continue;
    }

    if (argument == "--seed") {
      options.seed = static_cast<std::uint32_t>(std::stoul(RequireValue(argc, argv, index, argument)));
      continue;
    }

    if (argument == "--paused") {
      options.paused = true;
      continue;
    }

    if (argument.starts_with("--")) {
      throw std::runtime_error("Unknown option '" + argument + "'.");
    }

    if (!options.scenarioPath.empty()) {
      throw std::runtime_error("Only one scenario file may be provided.");
    }

    options.scenarioPath = argument;
  }

  // Validate any user-supplied overrides before the application starts.
  if (options.scenarioPath.empty()) {
    throw std::runtime_error("A scenario file path is required.");
  }

  if (options.width && *options.width <= 0) {
    throw std::runtime_error("Window width must be positive.");
  }

  if (options.height && *options.height <= 0) {
    throw std::runtime_error("Window height must be positive.");
  }

  if (options.speed && *options.speed <= 0.0) {
    throw std::runtime_error("Simulation speed must be positive.");
  }

  return options;
}

std::string BuildUsage(const std::string& programName) {
  // Keep the usage output short enough to fit comfortably on one console line.
  return "Usage: " + programName + " <scenario.json> [--width <px>] [--height <px>] [--speed <multiplier>] "
         "[--seed <value>] [--paused]";
}

}  // namespace particle_simulator
