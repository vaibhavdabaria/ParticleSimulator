#include <iostream>
#include <stdexcept>
#include <string>

#include "particle_simulator/cli.hpp"
#include "particle_simulator/rendering.hpp"

int main(int argc, char** argv) {
  try {
    // Parse the command line first so --help and argument errors are handled
    // before any heavy initialization work happens.
    const particle_simulator::CommandLineOptions options = particle_simulator::ParseCommandLine(argc, argv);
    if (options.showHelp) {
      const std::string programName = argc > 0 ? argv[0] : "particle_simulator";
      std::cout << particle_simulator::BuildUsage(programName) << '\n';
      return 0;
    }

    return particle_simulator::RunApplication(options);
  } catch (const std::exception& error) {
    // All top-level failures are funneled through one place so the user gets a
    // consistent message and the CLI usage reminder.
    const std::string programName = argc > 0 ? argv[0] : "particle_simulator";
    std::cerr << "Error: " << error.what() << '\n';
    std::cerr << particle_simulator::BuildUsage(programName) << '\n';
    return 1;
  }
}
