#pragma once

#include "particle_simulator/cli.hpp"

namespace particle_simulator {

// Launch the full interactive application: load config, open the window,
// process input, advance simulation time, and draw each frame.
int RunApplication(const CommandLineOptions& options);

}  // namespace particle_simulator
