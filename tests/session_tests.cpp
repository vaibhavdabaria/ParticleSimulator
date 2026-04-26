#include <cstdint>

#include <doctest/doctest.h>
#include <nlohmann/json.hpp>

#include "particle_simulator/app.hpp"

namespace {

particle_simulator::Scenario MakeScenario() {
  using namespace particle_simulator;

  Scenario scenario;
  scenario.window.width = 800;
  scenario.window.height = 600;
  scenario.window.title = "Session Test";
  scenario.window.backgroundColor = {12, 18, 28, 255};
  scenario.window.targetFps = 60;

  scenario.simulation.timestep = 0.1;
  scenario.simulation.seed = static_cast<std::uint32_t>(42);
  scenario.simulation.collisionIterations = 2;
  scenario.geometry.bounds.min = {0.0, 0.0};
  scenario.geometry.bounds.max = {200.0, 200.0};

  ParticleTypeDefinition type;
  type.radius = 5.0;
  type.mass = 1.0;
  type.restitution = 0.8;
  type.color = {255, 180, 80, 255};
  type.initialVelocity = {4.0, 0.0};
  scenario.particleTypes["spark"] = type;

  SpawnGroupDefinition group;
  group.particleType = "spark";
  group.count = 1;
  group.minPosition = {50.0, 50.0};
  group.maxPosition = {50.0, 50.0};
  group.streakEnabled = true;
  scenario.spawnGroups = {group};

  scenario.forces.push_back(GravityForce{{0.0, 9.8}});

  RectangleObstacle obstacle;
  obstacle.position = {80.0, 120.0};
  obstacle.size = {40.0, 10.0};
  obstacle.restitution = 0.9;
  scenario.geometry.obstacles.push_back(obstacle);

  return scenario;
}

}  // namespace

TEST_CASE("session responds to play pause reset and stepping") {
  particle_simulator::SimulationLaunchOptions options;
  options.scenario = MakeScenario();
  options.paused = true;
  options.speedMultiplier = 1.0;

  particle_simulator::SimulationSession session(options);
  CHECK(session.IsPaused());

  const auto initial = session.CaptureSnapshot();
  CHECK(initial.particleCount == 1);
  CHECK(initial.simulationTime == doctest::Approx(0.0));

  session.StepOnce();
  const auto stepped = session.CaptureSnapshot();
  CHECK(stepped.simulationTime == doctest::Approx(0.1));
  CHECK(stepped.particles.front().position.x > initial.particles.front().position.x);

  session.Reset();
  const auto reset = session.CaptureSnapshot();
  CHECK(reset.simulationTime == doctest::Approx(0.0));
  CHECK(reset.particles.front().position.x == doctest::Approx(initial.particles.front().position.x));
  CHECK(reset.trailSegments.empty());

  session.Play();
  CHECK_FALSE(session.IsPaused());
  CHECK(session.Update(0.2));
  CHECK(session.CaptureSnapshot().simulationTime == doctest::Approx(0.2));

  session.Pause();
  CHECK(session.IsPaused());
  CHECK_FALSE(session.Update(0.2));
}

TEST_CASE("session serializes scene metadata and live snapshots") {
  particle_simulator::SimulationLaunchOptions options;
  options.scenario = MakeScenario();
  options.speedMultiplier = 1.5;

  particle_simulator::SimulationSession session(options);
  const auto scene = session.GetSceneSnapshot();
  const nlohmann::json sceneJson = particle_simulator::SerializeSceneSnapshotToJson(scene);

  CHECK(sceneJson.at("resolvedSeed").get<std::uint32_t>() == 42U);
  CHECK(sceneJson.at("scenario").at("window").at("title").get<std::string>() == "Session Test");
  CHECK(sceneJson.at("scenario").at("geometry").at("obstacles").size() == 1);
  CHECK(sceneJson.at("particleStyles").at("radii").size() == 1);
  CHECK(sceneJson.at("particleStyles").at("colors").size() == 4);

  CHECK(session.Update(0.1));
  const auto snapshot = session.CaptureSnapshot();
  const nlohmann::json snapshotJson = particle_simulator::SerializeSimulationSnapshotToJson(snapshot);

  CHECK(snapshotJson.at("particleCount").get<std::size_t>() == 1U);
  CHECK(snapshotJson.at("speedMultiplier").get<double>() == doctest::Approx(1.5));
  CHECK(snapshotJson.at("particles").at("positions").size() == 2);
  CHECK_FALSE(snapshotJson.at("particles").contains("radii"));
  CHECK_FALSE(snapshotJson.at("particles").contains("colors"));
  CHECK(snapshotJson.at("trailSegments").size() == 1);
}

TEST_CASE("raw json scenarios can be loaded directly for web sessions") {
  const std::string rawScenario = R"json({
    "window": { "width": 800, "height": 600, "title": "Web Raw", "backgroundColor": [14, 18, 28, 255], "targetFps": 60 },
    "forces": [{ "type": "wind", "acceleration": [1.0, 0.0] }],
    "particleTypes": {
      "dust": {
        "radius": 4.0,
        "mass": 1.0,
        "restitution": 0.7,
        "color": [255, 255, 255, 255],
        "initialVelocity": [0.0, 0.0]
      }
    },
    "spawnGroups": [{
      "particleType": "dust",
      "count": 1,
      "minPosition": [10.0, 20.0],
      "maxPosition": [10.0, 20.0]
    }],
    "geometry": {
      "bounds": { "min": [0.0, 0.0], "max": [100.0, 100.0] },
      "obstacles": []
    }
  })json";

  const particle_simulator::Scenario scenario = particle_simulator::LoadScenarioFromJsonString(rawScenario);
  CHECK(scenario.window.title == "Web Raw");
  CHECK(scenario.forces.size() == 1);

  particle_simulator::SimulationLaunchOptions options;
  options.scenario = scenario;
  particle_simulator::SimulationSession session(options);

  CHECK(session.Update(0.02));
  CHECK(session.CaptureSnapshot().particleCount == 1);
}
