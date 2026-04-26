#include "particle_simulator/rendering.hpp"

#include <algorithm>
#include <iomanip>
#include <sstream>
#include <string>
#include <type_traits>
#include <utility>

#include <raylib.h>

#include "particle_simulator/app.hpp"
#include "particle_simulator/cli.hpp"
#include "particle_simulator/config.hpp"

namespace particle_simulator {

namespace {

Color ToRaylibColor(const ColorRgba& color) {
  return Color{color.r, color.g, color.b, color.a};
}

// Describes how world-space coordinates map into screen-space coordinates.
struct ViewportTransform {
  float scale = 1.0F;
  float offsetX = 0.0F;
  float offsetY = 0.0F;
};

ViewportTransform BuildTransform(const Scenario& scenario) {
  // Reserve a fixed HUD band at the top so the overlay never overlaps the
  // simulation bounds or particles.
  const float horizontalPadding = 24.0F;
  const float bottomPadding = 24.0F;
  const float topHudReserve = 84.0F;
  const float boundsWidth =
      static_cast<float>(scenario.geometry.bounds.max.x - scenario.geometry.bounds.min.x);
  const float boundsHeight =
      static_cast<float>(scenario.geometry.bounds.max.y - scenario.geometry.bounds.min.y);
  const float windowWidth = static_cast<float>(scenario.window.width);
  const float windowHeight = static_cast<float>(scenario.window.height);
  const float availableWidth = std::max(1.0F, windowWidth - 2.0F * horizontalPadding);
  const float availableHeight = std::max(1.0F, windowHeight - topHudReserve - bottomPadding);

  // Uniform scaling keeps circles circular and preserves the scenario aspect ratio.
  const float scaleX = availableWidth / boundsWidth;
  const float scaleY = availableHeight / boundsHeight;
  const float scale = std::max(0.1F, std::min(scaleX, scaleY));

  const float contentWidth = boundsWidth * scale;
  const float contentHeight = boundsHeight * scale;
  const float offsetX = horizontalPadding + (availableWidth - contentWidth) * 0.5F;
  const float offsetY = topHudReserve + (availableHeight - contentHeight) * 0.5F;

  return {scale, offsetX, offsetY};
}

// Convert a point from world space into screen coordinates.
Vector2 WorldToScreen(const ViewportTransform& transform, const Vec2& point, const Scenario& scenario) {
  return Vector2{
      transform.offsetX + static_cast<float>((point.x - scenario.geometry.bounds.min.x) * transform.scale),
      transform.offsetY + static_cast<float>((point.y - scenario.geometry.bounds.min.y) * transform.scale),
  };
}

// Convert a world-space distance such as radius or width into pixels.
float WorldToScreenLength(const ViewportTransform& transform, double value) {
  return static_cast<float>(value * transform.scale);
}

// Draw the outer simulation container.
void DrawBounds(const Scenario& scenario, const ViewportTransform& transform) {
  const auto topLeft = WorldToScreen(transform, scenario.geometry.bounds.min, scenario);
  const float width = WorldToScreenLength(transform, scenario.geometry.bounds.max.x - scenario.geometry.bounds.min.x);
  const float height = WorldToScreenLength(transform, scenario.geometry.bounds.max.y - scenario.geometry.bounds.min.y);
  DrawRectangleLinesEx(Rectangle{topLeft.x, topLeft.y, width, height}, 2.0F, Fade(RAYWHITE, 0.65F));
}

// Draw the static obstacle geometry described by the scenario.
void DrawObstacles(const Scenario& scenario, const ViewportTransform& transform) {
  for (const auto& obstacle : scenario.geometry.obstacles) {
    std::visit(
        [&](const auto& typedObstacle) {
          using ObstacleType = std::decay_t<decltype(typedObstacle)>;
          if constexpr (std::is_same_v<ObstacleType, RectangleObstacle>) {
            const Vector2 topLeft = WorldToScreen(transform, typedObstacle.position, scenario);
            const float width = WorldToScreenLength(transform, typedObstacle.size.x);
            const float height = WorldToScreenLength(transform, typedObstacle.size.y);
            DrawRectangleRounded(
                Rectangle{topLeft.x, topLeft.y, width, height},
                0.08F,
                8,
                Color{53, 89, 126, 255});
          } else if constexpr (std::is_same_v<ObstacleType, CircleObstacle>) {
            const Vector2 center = WorldToScreen(transform, typedObstacle.center, scenario);
            DrawCircleV(center, WorldToScreenLength(transform, typedObstacle.radius), Color{171, 126, 76, 255});
          }
        },
        obstacle);
  }
}

// Draw the permanent trail segments accumulated by streak-enabled particles.
void DrawTrails(const SimulationSceneSnapshot& scene, const SimulationSnapshot& snapshot, const ViewportTransform& transform) {
  const Scenario& scenario = scene.scenario;
  for (const auto& segment : snapshot.trailSegments) {
    const Vector2 start = WorldToScreen(transform, segment.start, scenario);
    const Vector2 end = WorldToScreen(transform, segment.end, scenario);
    DrawLineEx(start, end, 1.5F, ToRaylibColor(segment.color));
  }
}

// Draw the live particle array from the simulation engine.
void DrawParticles(const SimulationSceneSnapshot& scene, const SimulationSnapshot& snapshot, const ViewportTransform& transform) {
  const Scenario& scenario = scene.scenario;
  for (const auto& particle : snapshot.particles) {
    const Vector2 center = WorldToScreen(transform, particle.position, scenario);
    DrawCircleV(center, WorldToScreenLength(transform, particle.radius), ToRaylibColor(particle.color));
  }
}

// Draw the textual heads-up display above the simulation view.
void DrawOverlay(const SimulationSceneSnapshot& scene, const SimulationSnapshot& snapshot) {
  std::ostringstream stream;
  stream << "Particles: " << snapshot.particleCount
         << " | Seed: " << scene.resolvedSeed
         << " | Grid: " << std::fixed << std::setprecision(1) << scene.gridCellSize
         << " | Speed: " << std::setprecision(2) << snapshot.speedMultiplier
         << "x | " << (snapshot.paused ? "Paused" : "Running");
  DrawText(stream.str().c_str(), 18, 16, 20, RAYWHITE);
  DrawText("Space: pause  R: reset  N: step  Esc: quit", 18, 42, 18, Fade(RAYWHITE, 0.7F));
}

}  // namespace

int RunApplication(const CommandLineOptions& options) {
  // Load and fully validate the scenario before opening the window.
  SimulationLaunchOptions launchOptions;
  launchOptions.scenario = LoadScenarioFromFile(options.scenarioPath);
  launchOptions.overrides.width = options.width;
  launchOptions.overrides.height = options.height;
  launchOptions.overrides.seed = options.seed;
  launchOptions.speedMultiplier = options.speed.value_or(1.0);
  launchOptions.paused = options.paused;
  SimulationSession session(std::move(launchOptions));
  const SimulationSceneSnapshot scene = session.GetSceneSnapshot();
  SimulationSnapshot snapshot = session.CaptureSnapshot();
  const Scenario& liveScenario = scene.scenario;

  // Window creation happens after config loading so any parser error is still
  // reported cleanly in the console instead of as a half-open app window.
  InitWindow(liveScenario.window.width, liveScenario.window.height, liveScenario.window.title.c_str());
  SetTargetFPS(liveScenario.window.targetFps);

  while (!WindowShouldClose()) {
    // Input handling is intentionally small and direct because this app only
    // exposes a few simulation-control shortcuts.
    if (IsKeyPressed(KEY_SPACE)) {
      if (session.IsPaused()) {
        session.Play();
      } else {
        session.Pause();
      }
      snapshot = session.CaptureSnapshot();
    }
    if (IsKeyPressed(KEY_R)) {
      session.Reset();
      snapshot = session.CaptureSnapshot();
    }
    if (session.IsPaused() && IsKeyPressed(KEY_N)) {
      session.StepOnce();
      snapshot = session.CaptureSnapshot();
    }

    if (session.Update(static_cast<double>(GetFrameTime()))) {
      snapshot = session.CaptureSnapshot();
    }

    // The viewport is recomputed every frame so it always matches the current
    // window size and reserved HUD area.
    const ViewportTransform transform = BuildTransform(liveScenario);

    BeginDrawing();
    ClearBackground(ToRaylibColor(liveScenario.window.backgroundColor));
    DrawBounds(liveScenario, transform);
    DrawObstacles(liveScenario, transform);
    DrawTrails(scene, snapshot, transform);
    DrawParticles(scene, snapshot, transform);
    DrawOverlay(scene, snapshot);
    EndDrawing();
  }

  CloseWindow();
  return 0;
}

}  // namespace particle_simulator
