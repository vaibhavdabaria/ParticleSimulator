#include <cstddef>
#include <cstdint>
#include <string>

#include <doctest/doctest.h>

#include "particle_simulator/simulation.hpp"

namespace {

particle_simulator::Scenario MakeBaseScenario() {
  using namespace particle_simulator;

  Scenario scenario;
  scenario.window.width = 800;
  scenario.window.height = 600;
  scenario.simulation.timestep = 0.1;
  scenario.simulation.seed = static_cast<std::uint32_t>(123);
  scenario.simulation.collisionIterations = 2;
  scenario.geometry.bounds.min = {0.0, 0.0};
  scenario.geometry.bounds.max = {200.0, 200.0};

  ParticleTypeDefinition slow;
  slow.radius = 5.0;
  slow.mass = 1.0;
  slow.restitution = 1.0;
  slow.color = {255, 255, 255, 255};
  slow.initialVelocity = {0.0, 0.0};

  ParticleTypeDefinition fast = slow;
  fast.initialVelocity = {10.0, 0.0};

  ParticleTypeDefinition opposite = slow;
  opposite.initialVelocity = {-10.0, 0.0};

  scenario.particleTypes["slow"] = slow;
  scenario.particleTypes["fast"] = fast;
  scenario.particleTypes["opposite"] = opposite;
  return scenario;
}

particle_simulator::SpawnGroupDefinition SingleSpawn(
    const std::string& type,
    particle_simulator::Vec2 position) {
  particle_simulator::SpawnGroupDefinition group;
  group.particleType = type;
  group.count = 1;
  group.minPosition = position;
  group.maxPosition = position;
  return group;
}

}  // namespace

TEST_CASE("particles stay still when gravity is omitted") {
  auto scenario = MakeBaseScenario();
  scenario.spawnGroups = {SingleSpawn("slow", {50.0, 50.0})};

  particle_simulator::SimulationEngine engine(scenario);
  const auto before = engine.GetParticles().front();
  engine.Step(0.1);
  const auto after = engine.GetParticles().front();

  CHECK(after.velocity.x == doctest::Approx(before.velocity.x));
  CHECK(after.velocity.y == doctest::Approx(before.velocity.y));
  CHECK(after.position.x == doctest::Approx(before.position.x));
  CHECK(after.position.y == doctest::Approx(before.position.y));
}

TEST_CASE("grid cell size is derived from configured particle radii") {
  auto scenario = MakeBaseScenario();
  scenario.particleTypes["slow"].radius = 8.0;
  scenario.spawnGroups = {SingleSpawn("slow", {50.0, 50.0})};

  particle_simulator::SimulationEngine engine(scenario);

  CHECK(engine.GetGridCellSize() == doctest::Approx(20.0));
}

TEST_CASE("gravity changes velocity only when configured") {
  auto scenario = MakeBaseScenario();
  scenario.spawnGroups = {SingleSpawn("slow", {50.0, 50.0})};
  scenario.forces.push_back(particle_simulator::GravityForce{{0.0, 9.8}});

  particle_simulator::SimulationEngine engine(scenario);
  engine.Step(0.1);
  const auto& particle = engine.GetParticles().front();

  CHECK(particle.velocity.y > 0.0);
  CHECK(particle.position.y > 50.0);
}

TEST_CASE("drag wind and radial forces affect motion") {
  auto scenario = MakeBaseScenario();
  scenario.spawnGroups = {SingleSpawn("fast", {100.0, 100.0})};
  scenario.forces.push_back(particle_simulator::DragForce{1.0});
  scenario.forces.push_back(particle_simulator::WindForce{{5.0, 0.0}});
  scenario.forces.push_back(particle_simulator::RadialForce{{120.0, 100.0}, 4.0, 40.0});

  particle_simulator::SimulationEngine engine(scenario);
  engine.Step(0.1);
  const auto& particle = engine.GetParticles().front();

  CHECK(particle.position.x > 100.0);
  CHECK(particle.velocity.x < 10.0);
}

TEST_CASE("radial force follows inverse square falloff") {
  auto scenario = MakeBaseScenario();
  scenario.spawnGroups = {
      SingleSpawn("slow", {100.0, 100.0}),
      SingleSpawn("slow", {130.0, 100.0}),
  };
  scenario.forces.push_back(particle_simulator::RadialForce{{160.0, 100.0}, 3600.0, 100.0});

  particle_simulator::SimulationEngine engine(scenario);
  engine.Step(0.1);

  const auto& fartherParticle = engine.GetParticles().at(0);
  const auto& nearerParticle = engine.GetParticles().at(1);

  CHECK(fartherParticle.velocity.x == doctest::Approx(0.1));
  CHECK(nearerParticle.velocity.x == doctest::Approx(0.4));
  CHECK(nearerParticle.velocity.x == doctest::Approx(fartherParticle.velocity.x * 4.0));
}

TEST_CASE("particle collisions reverse the two-body motion") {
  auto scenario = MakeBaseScenario();
  scenario.spawnGroups = {
      SingleSpawn("fast", {95.0, 100.0}),
      SingleSpawn("opposite", {105.0, 100.0}),
  };

  particle_simulator::SimulationEngine engine(scenario);
  engine.Step(0.05);
  const auto& first = engine.GetParticles().at(0);
  const auto& second = engine.GetParticles().at(1);

  CHECK(first.velocity.x < 0.0);
  CHECK(second.velocity.x > 0.0);
}

TEST_CASE("particles bounce from obstacles and bounds") {
  auto scenario = MakeBaseScenario();
  scenario.spawnGroups = {SingleSpawn("fast", {40.0, 100.0})};
  particle_simulator::RectangleObstacle obstacle;
  obstacle.position = {50.0, 80.0};
  obstacle.size = {20.0, 40.0};
  obstacle.restitution = 1.0;
  scenario.geometry.obstacles.push_back(obstacle);

  particle_simulator::SimulationEngine engine(scenario);
  engine.Step(1.0);
  const auto& particle = engine.GetParticles().front();

  CHECK(particle.velocity.x < 0.0);
  CHECK(particle.position.x <= 45.0);
}

TEST_CASE("reset restores the initial seeded state") {
  auto scenario = MakeBaseScenario();
  particle_simulator::SpawnGroupDefinition group;
  group.particleType = "slow";
  group.count = 10;
  group.minPosition = {20.0, 20.0};
  group.maxPosition = {180.0, 180.0};
  group.minVelocity = {-5.0, -5.0};
  group.maxVelocity = {5.0, 5.0};
  scenario.spawnGroups = {group};

  particle_simulator::SimulationEngine engine(scenario);
  const auto original = engine.GetParticles();
  engine.Step(0.1);
  engine.Reset();
  const auto reset = engine.GetParticles();

  REQUIRE(reset.size() == original.size());
  for (std::size_t index = 0; index < original.size(); ++index) {
    CHECK(reset[index].position.x == doctest::Approx(original[index].position.x));
    CHECK(reset[index].position.y == doctest::Approx(original[index].position.y));
    CHECK(reset[index].velocity.x == doctest::Approx(original[index].velocity.x));
    CHECK(reset[index].velocity.y == doctest::Approx(original[index].velocity.y));
  }
}

TEST_CASE("streak-enabled particles accumulate permanent trail segments") {
  auto scenario = MakeBaseScenario();
  auto trailGroup = SingleSpawn("fast", {40.0, 100.0});
  trailGroup.streakEnabled = true;
  scenario.spawnGroups = {trailGroup};

  particle_simulator::SimulationEngine engine(scenario);
  CHECK(engine.GetTrailSegments().empty());

  engine.Step(0.1);
  REQUIRE(engine.GetTrailSegments().size() == 1);
  CHECK(engine.GetTrailSegments().front().start.x == doctest::Approx(40.0));
  CHECK(engine.GetTrailSegments().front().end.x > 40.0);

  engine.Step(0.1);
  CHECK(engine.GetTrailSegments().size() == 2);

  engine.Reset();
  CHECK(engine.GetTrailSegments().empty());
}

TEST_CASE("particles without streaks do not record trail segments") {
  auto scenario = MakeBaseScenario();
  scenario.spawnGroups = {SingleSpawn("fast", {40.0, 100.0})};

  particle_simulator::SimulationEngine engine(scenario);
  engine.Step(0.1);

  CHECK(engine.GetTrailSegments().empty());
}
