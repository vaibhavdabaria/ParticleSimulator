#include <algorithm>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <memory>
#include <mutex>
#include <optional>
#include <random>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <iostream>
#include <unordered_map>
#include <utility>
#include <vector>

#include <crow.h>
#include <nlohmann/json.hpp>

#include "particle_simulator/app.hpp"
#include "particle_simulator/config.hpp"

namespace {

using json = nlohmann::json;
namespace fs = std::filesystem;
using Clock = std::chrono::steady_clock;

struct ServerOptions {
  std::string bindAddress = "0.0.0.0";
  std::uint16_t port = 18080;
  fs::path scenarioDirectory = "scenarios";
  fs::path webRoot = "web/dist";
};

struct SessionRecord {
  std::shared_ptr<particle_simulator::SimulationSession> session;
  std::mutex connectionMutex;
  crow::websocket::connection* connection = nullptr;
  Clock::time_point lastUpdate = Clock::now();
  Clock::time_point lastSnapshotSent = Clock::now();
  Clock::duration targetSnapshotInterval = std::chrono::milliseconds(16);
};

Clock::duration SnapshotIntervalForTargetFps(int targetFps) {
  if (targetFps <= 0) {
    return std::chrono::milliseconds(16);
  }

  const auto interval = std::chrono::duration_cast<Clock::duration>(
      std::chrono::duration<double>(1.0 / static_cast<double>(targetFps)));
  return interval > Clock::duration::zero() ? interval : std::chrono::milliseconds(16);
}

std::string ReadTextFile(const fs::path& path) {
  std::ifstream input(path, std::ios::binary);
  if (!input) {
    throw std::runtime_error("Unable to open file '" + path.string() + "'.");
  }

  std::ostringstream buffer;
  buffer << input.rdbuf();
  return buffer.str();
}

std::string GuessContentType(const fs::path& path) {
  const std::string extension = path.extension().string();
  if (extension == ".html") {
    return "text/html; charset=utf-8";
  }
  if (extension == ".js") {
    return "application/javascript; charset=utf-8";
  }
  if (extension == ".css") {
    return "text/css; charset=utf-8";
  }
  if (extension == ".json") {
    return "application/json; charset=utf-8";
  }
  if (extension == ".svg") {
    return "image/svg+xml";
  }
  if (extension == ".png") {
    return "image/png";
  }
  if (extension == ".ico") {
    return "image/x-icon";
  }
  return "text/plain; charset=utf-8";
}

crow::response JsonResponse(const json& body, int code = 200) {
  crow::response response;
  response.code = code;
  response.set_header("Content-Type", "application/json; charset=utf-8");
  response.write(body.dump());
  return response;
}

ServerOptions ParseServerOptions(int argc, char** argv) {
  ServerOptions options;
  for (int index = 1; index < argc; ++index) {
    const std::string argument = argv[index];
    auto requireValue = [&](const std::string& optionName) {
      if (index + 1 >= argc) {
        throw std::runtime_error("Missing value for option '" + optionName + "'.");
      }
      ++index;
      return std::string(argv[index]);
    };

    if (argument == "--port") {
      options.port = static_cast<std::uint16_t>(std::stoul(requireValue(argument)));
      continue;
    }
    if (argument == "--bind") {
      options.bindAddress = requireValue(argument);
      continue;
    }
    if (argument == "--scenario-dir") {
      options.scenarioDirectory = requireValue(argument);
      continue;
    }
    if (argument == "--web-root") {
      options.webRoot = requireValue(argument);
      continue;
    }
    if (argument == "--help" || argument == "-h") {
      std::cout << "Usage: particle_simulator_web_server [--port <value>] [--bind <host>] "
                   "[--scenario-dir <path>] [--web-root <path>]\n";
      std::exit(0);
    }

    throw std::runtime_error("Unknown option '" + argument + "'.");
  }
  return options;
}

std::string GenerateSessionId() {
  static std::mutex mutex;
  static std::mt19937_64 generator(std::random_device{}());
  static constexpr char alphabet[] = "0123456789abcdef";
  std::scoped_lock lock(mutex);

  std::string sessionId;
  sessionId.reserve(16);
  std::uniform_int_distribution<int> distribution(0, 15);
  for (int index = 0; index < 16; ++index) {
    sessionId.push_back(alphabet[distribution(generator)]);
  }
  return sessionId;
}

particle_simulator::ScenarioOverrides ParseOverrides(const json& node) {
  particle_simulator::ScenarioOverrides overrides;
  if (!node.is_object()) {
    return overrides;
  }

  if (node.contains("width")) {
    overrides.width = node.at("width").get<int>();
  }
  if (node.contains("height")) {
    overrides.height = node.at("height").get<int>();
  }
  return overrides;
}

crow::response ServeAsset(const fs::path& webRoot, std::string requestedPath) {
  if (requestedPath.empty()) {
    requestedPath = "index.html";
  }

  if (requestedPath.find("..") != std::string::npos) {
    return crow::response(403);
  }

  fs::path resolvedPath = webRoot / fs::path(requestedPath);
  if (fs::is_directory(resolvedPath)) {
    resolvedPath /= "index.html";
  }
  if (!fs::exists(resolvedPath)) {
    resolvedPath = webRoot / "index.html";
  }
  if (!fs::exists(resolvedPath)) {
    return crow::response(
        404,
        "Frontend assets were not found. Build the Vite app in the web directory before starting the server.");
  }

  crow::response response;
  response.code = 200;
  response.set_header("Content-Type", GuessContentType(resolvedPath));
  response.write(ReadTextFile(resolvedPath));
  return response;
}

template <typename Value>
void AppendBinaryValue(std::string& output, const Value& value) {
  const auto* bytes = reinterpret_cast<const char*>(&value);
  output.append(bytes, sizeof(Value));
}

std::uint16_t QuantizePosition(double value, double min, double max) {
  const double extent = max - min;
  if (extent <= 0.0) {
    return 0;
  }
  const double normalized = std::clamp((value - min) / extent, 0.0, 1.0);
  return static_cast<std::uint16_t>(normalized * 65535.0 + 0.5);
}

std::string SerializeSnapshotToBinary(const particle_simulator::SimulationSnapshotView& snapshot) {
  constexpr std::uint32_t magic = 0x33535350;  // "PSS3" in little-endian byte order.
  constexpr std::uint32_t flagsPaused = 1U;
  const auto& particles = *snapshot.particles;
  const auto& trailSegments = *snapshot.trailSegments;

  std::string payload;
  payload.reserve(56 + particles.size() * sizeof(std::uint16_t) * 2 +
                  trailSegments.size() * (sizeof(float) * 4 + sizeof(std::uint8_t) * 4));
  AppendBinaryValue(payload, magic);
  AppendBinaryValue(payload, static_cast<std::uint32_t>(snapshot.particleCount));
  AppendBinaryValue(payload, static_cast<std::uint32_t>(trailSegments.size()));
  AppendBinaryValue(payload, snapshot.paused ? flagsPaused : 0U);
  AppendBinaryValue(payload, static_cast<double>(snapshot.sequence));
  AppendBinaryValue(payload, snapshot.simulationTime);
  AppendBinaryValue(payload, snapshot.speedMultiplier);
  AppendBinaryValue(payload, snapshot.gridCellSize);
  AppendBinaryValue(payload, snapshot.resolvedSeed);
  AppendBinaryValue(payload, static_cast<std::uint32_t>(0));

  for (const auto& particle : particles) {
    const auto x = QuantizePosition(particle.position.x, snapshot.boundsMin.x, snapshot.boundsMax.x);
    const auto y = QuantizePosition(particle.position.y, snapshot.boundsMin.y, snapshot.boundsMax.y);
    AppendBinaryValue(payload, x);
    AppendBinaryValue(payload, y);
  }

  for (const auto& trailSegment : trailSegments) {
    AppendBinaryValue(payload, static_cast<float>(trailSegment.start.x));
    AppendBinaryValue(payload, static_cast<float>(trailSegment.start.y));
    AppendBinaryValue(payload, static_cast<float>(trailSegment.end.x));
    AppendBinaryValue(payload, static_cast<float>(trailSegment.end.y));
  }
  for (const auto& trailSegment : trailSegments) {
    AppendBinaryValue(payload, trailSegment.color.r);
    AppendBinaryValue(payload, trailSegment.color.g);
    AppendBinaryValue(payload, trailSegment.color.b);
    AppendBinaryValue(payload, trailSegment.color.a);
  }
  return payload;
}

class SimulationHub {
 public:
  explicit SimulationHub(fs::path scenarioDirectory)
      : scenarioDirectory_(std::move(scenarioDirectory)),
        worker_([this](std::stop_token stopToken) { RunLoop(stopToken); }) {}

  ~SimulationHub() = default;

  json ListBundledScenarios() const {
    json scenarios = json::array();
    if (!fs::exists(scenarioDirectory_)) {
      return scenarios;
    }

    for (const auto& entry : fs::directory_iterator(scenarioDirectory_)) {
      if (!entry.is_regular_file() || entry.path().extension() != ".json") {
        continue;
      }

      const auto scenario = particle_simulator::LoadScenarioFromFile(entry.path());
      scenarios.push_back({
          {"id", entry.path().stem().string()},
          {"name", entry.path().stem().string()},
          {"scenario", particle_simulator::SerializeScenarioToJson(scenario)},
      });
    }

    return scenarios;
  }

  std::string CreateSession(const json& body) {
    particle_simulator::SimulationLaunchOptions options;
    const json& scenarioNode = body.contains("scenario") ? body.at("scenario") : body;
    options.scenario = particle_simulator::LoadScenarioFromJsonString(scenarioNode.dump());
    options.overrides = body.contains("overrides") ? ParseOverrides(body.at("overrides"))
                                                   : particle_simulator::ScenarioOverrides{};
    if (body.contains("speedMultiplier")) {
      options.speedMultiplier = body.at("speedMultiplier").get<double>();
    }
    if (body.contains("paused")) {
      options.paused = body.at("paused").get<bool>();
    }

    const auto session = std::make_shared<particle_simulator::SimulationSession>(std::move(options));
    const std::string sessionId = GenerateSessionId();

    auto record = std::make_shared<SessionRecord>();
    record->session = session;
    record->lastUpdate = Clock::now();
    record->lastSnapshotSent = Clock::now();
    record->targetSnapshotInterval =
        SnapshotIntervalForTargetFps(session->GetSceneSnapshot().scenario.window.targetFps);

    std::scoped_lock lock(mutex_);
    sessions_[sessionId] = std::move(record);
    return sessionId;
  }

  bool SessionExists(const std::string& sessionId) const {
    std::scoped_lock lock(mutex_);
    return sessions_.contains(sessionId);
  }

  void AttachConnection(const std::string& sessionId, crow::websocket::connection& connection) {
    auto record = GetSession(sessionId);
    {
      std::scoped_lock connectionLock(record->connectionMutex);
      record->connection = &connection;
      record->lastSnapshotSent = Clock::now();
    }

    {
      std::scoped_lock lock(mutex_);
      connectionSessions_[&connection] = sessionId;
    }

    SendEvent(record, json{
                        {"type", "sessionReady"},
                        {"scene", particle_simulator::SerializeSceneSnapshotToJson(record->session->GetSceneSnapshot())},
                    });
    SendSnapshot(record);
  }

  void DetachConnection(crow::websocket::connection& connection) {
    std::shared_ptr<SessionRecord> record;
    {
      std::scoped_lock lock(mutex_);
      const auto iterator = connectionSessions_.find(&connection);
      if (iterator == connectionSessions_.end()) {
        return;
      }
      record = sessions_.at(iterator->second);
      connectionSessions_.erase(iterator);
    }

    std::scoped_lock connectionLock(record->connectionMutex);
    if (record->connection == &connection) {
      record->connection = nullptr;
    }
  }

  void HandleMessage(crow::websocket::connection& connection, const std::string& message) {
    auto record = GetSessionForConnection(connection);
    const json command = json::parse(message);
    const std::string type = command.at("type").get<std::string>();

    if (type == "play") {
      record->session->Play();
      SendStatus(record, "play");
      SendSnapshot(record);
      return;
    }
    if (type == "pause") {
      record->session->Pause();
      SendStatus(record, "pause");
      SendSnapshot(record);
      return;
    }
    if (type == "reset") {
      record->session->Reset();
      SendStatus(record, "reset");
      SendSnapshot(record);
      return;
    }
    if (type == "step") {
      record->session->StepOnce();
      SendStatus(record, "step");
      SendSnapshot(record);
      return;
    }
    if (type == "setSpeed") {
      record->session->SetSpeedMultiplier(command.at("speedMultiplier").get<double>());
      SendStatus(record, "setSpeed");
      SendSnapshot(record);
      return;
    }

    throw std::runtime_error("Unknown websocket command '" + type + "'.");
  }

  void SendError(crow::websocket::connection& connection, const std::string& message) {
    connection.send_text(json{{"type", "error"}, {"message", message}}.dump());
  }

 private:
  std::shared_ptr<SessionRecord> GetSession(const std::string& sessionId) const {
    std::scoped_lock lock(mutex_);
    const auto iterator = sessions_.find(sessionId);
    if (iterator == sessions_.end()) {
      throw std::runtime_error("Unknown session '" + sessionId + "'.");
    }
    return iterator->second;
  }

  std::shared_ptr<SessionRecord> GetSessionForConnection(crow::websocket::connection& connection) const {
    std::scoped_lock lock(mutex_);
    const auto connectionIterator = connectionSessions_.find(&connection);
    if (connectionIterator == connectionSessions_.end()) {
      throw std::runtime_error("WebSocket is not attached to a session.");
    }

    const auto sessionIterator = sessions_.find(connectionIterator->second);
    if (sessionIterator == sessions_.end()) {
      throw std::runtime_error("WebSocket session no longer exists.");
    }
    return sessionIterator->second;
  }

  void RunLoop(std::stop_token stopToken) {
    constexpr auto tickInterval = std::chrono::milliseconds(16);

    while (!stopToken.stop_requested()) {
      std::vector<std::shared_ptr<SessionRecord>> records;
      {
        std::scoped_lock lock(mutex_);
        for (const auto& [id, record] : sessions_) {
          (void)id;
          records.push_back(record);
        }
      }

      const auto now = Clock::now();
      for (const auto& record : records) {
        const double frameTimeSeconds = std::chrono::duration<double>(now - record->lastUpdate).count();
        record->lastUpdate = now;
        const bool advanced = record->session->Update(frameTimeSeconds);
        if (!advanced) {
          continue;
        }

        const bool due = now - record->lastSnapshotSent >= record->targetSnapshotInterval;
        if (due) {
          SendSnapshot(record);
        }
      }

      std::this_thread::sleep_for(tickInterval);
    }
  }

  void SendStatus(const std::shared_ptr<SessionRecord>& record, const std::string& action) {
    SendEvent(record, json{
                        {"type", "status"},
                        {"action", action},
                        {"paused", record->session->IsPaused()},
                        {"speedMultiplier", record->session->GetSpeedMultiplier()},
                    });
  }

  void SendSnapshot(const std::shared_ptr<SessionRecord>& record) {
    record->lastSnapshotSent = Clock::now();
    std::string payload;
    record->session->VisitSnapshot([&payload](const particle_simulator::SimulationSnapshotView& snapshot) {
      payload = SerializeSnapshotToBinary(snapshot);
    });
    SendBinary(record, std::move(payload));
  }

  void SendEvent(const std::shared_ptr<SessionRecord>& record, const json& message) {
    std::scoped_lock connectionLock(record->connectionMutex);
    if (record->connection == nullptr) {
      return;
    }
    record->connection->send_text(message.dump());
  }

  void SendBinary(const std::shared_ptr<SessionRecord>& record, std::string message) {
    std::scoped_lock connectionLock(record->connectionMutex);
    if (record->connection == nullptr) {
      return;
    }
    record->connection->send_binary(std::move(message));
  }

  fs::path scenarioDirectory_;
  mutable std::mutex mutex_;
  std::unordered_map<std::string, std::shared_ptr<SessionRecord>> sessions_;
  std::unordered_map<crow::websocket::connection*, std::string> connectionSessions_;
  std::jthread worker_;
};

}  // namespace

int main(int argc, char** argv) {
  try {
    const ServerOptions options = ParseServerOptions(argc, argv);
    SimulationHub hub(options.scenarioDirectory);

    crow::SimpleApp app;
    app.loglevel(crow::LogLevel::Warning);

    CROW_ROUTE(app, "/api/scenarios")([&hub]() {
      return JsonResponse(json{{"scenarios", hub.ListBundledScenarios()}});
    });

    CROW_ROUTE(app, "/api/session")
        .methods(crow::HTTPMethod::Post)([&hub](const crow::request& request) {
          try {
            const json body = json::parse(request.body);
            return JsonResponse(json{{"sessionId", hub.CreateSession(body)}}, 201);
          } catch (const std::exception& error) {
            return JsonResponse(json{{"error", error.what()}}, 400);
          }
        });

    CROW_WEBSOCKET_ROUTE(app, "/ws")
        .onaccept([&hub](const crow::request& request, void** userData) {
          const char* sessionId = request.url_params.get("sessionId");
          if (sessionId == nullptr || !hub.SessionExists(sessionId)) {
            return false;
          }
          *userData = new std::string(sessionId);
          return true;
        })
        .onopen([&hub](crow::websocket::connection& connection) {
          auto* sessionId = static_cast<std::string*>(connection.userdata());
          if (sessionId == nullptr) {
            connection.close("Missing session id");
            return;
          }

          try {
            hub.AttachConnection(*sessionId, connection);
          } catch (const std::exception& error) {
            hub.SendError(connection, error.what());
            connection.close(error.what());
          }
        })
        .onmessage([&hub](crow::websocket::connection& connection, const std::string& message, bool /*isBinary*/) {
          try {
            hub.HandleMessage(connection, message);
          } catch (const std::exception& error) {
            hub.SendError(connection, error.what());
          }
        })
        .onerror([&hub](crow::websocket::connection& connection, const std::string& errorMessage) {
          hub.SendError(connection, errorMessage);
        })
        .onclose([&hub](crow::websocket::connection& connection, const std::string& /*reason*/) {
          hub.DetachConnection(connection);
          delete static_cast<std::string*>(connection.userdata());
          connection.userdata(nullptr);
        });

    CROW_ROUTE(app, "/")([&options]() { return ServeAsset(options.webRoot, "index.html"); });
    CROW_ROUTE(app, "/<path>")([&options](const crow::request&, std::string path) {
      if (path.starts_with("api/") || path == "ws") {
        return crow::response(404);
      }
      return ServeAsset(options.webRoot, std::move(path));
    });

    std::cout << "Particle Simulator web server listening on http://" << options.bindAddress << ':' << options.port
              << '\n';
    app.bindaddr(options.bindAddress).port(options.port).multithreaded().run();
  } catch (const std::exception& error) {
    std::cerr << "Error: " << error.what() << '\n';
    return 1;
  }

  return 0;
}
