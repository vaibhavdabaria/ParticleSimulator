cmake_minimum_required(VERSION 3.14)
project(ParticleSimulator VERSION 0.1.0 LANGUAGES CXX)

# Newer CMake releases can reject third-party projects that still declare
# compatibility with very old policy versions. FetchContent dependencies such as
# doctest still use that older style, so raise the accepted policy floor here.
set(CMAKE_POLICY_VERSION_MINIMUM 3.5)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

include(FetchContent)
include(CTest)

option(PARTICLE_SIMULATOR_BUILD_TESTS "Build Particle Simulator tests" ON)
option(PARTICLE_SIMULATOR_BUILD_WEB_SERVER "Build the web server target" ON)
option(PARTICLE_SIMULATOR_BUILD_WEB_FRONTEND "Build the frontend assets with npm" OFF)

FetchContent_Declare(
  raylib
  GIT_REPOSITORY https://github.com/raysan5/raylib.git
  GIT_TAG 5.5
)

FetchContent_Declare(
  nlohmann_json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG v3.11.3
)

FetchContent_Declare(
  doctest
  GIT_REPOSITORY https://github.com/doctest/doctest.git
  GIT_TAG v2.4.11
)

FetchContent_Declare(
  crow
  GIT_REPOSITORY https://github.com/CrowCpp/Crow.git
  GIT_TAG v1.2.1
)

FetchContent_Declare(
  asio
  GIT_REPOSITORY https://github.com/chriskohlhoff/asio.git
  GIT_TAG asio-1-30-2
)

set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_GAMES OFF CACHE BOOL "" FORCE)
set(CROW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(CROW_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(CROW_ENABLE_SSL OFF CACHE BOOL "" FORCE)
set(CROW_ENABLE_COMPRESSION OFF CACHE BOOL "" FORCE)
set(CROW_FEATURES "" CACHE STRING "" FORCE)

FetchContent_GetProperties(raylib)
if(NOT raylib_POPULATED)
  FetchContent_Populate(raylib)

  if(MSVC)
    set(RAYLIB_COMPILER_FLAGS_FILE "${raylib_SOURCE_DIR}/cmake/CompilerFlags.cmake")
    file(READ "${RAYLIB_COMPILER_FLAGS_FILE}" RAYLIB_COMPILER_FLAGS_CONTENT)
    string(REPLACE
      "add_if_flag_compiles(-Werror=pointer-arith CMAKE_C_FLAGS)"
      "if(NOT MSVC)\nadd_if_flag_compiles(-Werror=pointer-arith CMAKE_C_FLAGS)\nendif()"
      RAYLIB_COMPILER_FLAGS_CONTENT
      "${RAYLIB_COMPILER_FLAGS_CONTENT}")
    string(REPLACE
      "add_if_flag_compiles(-Werror=implicit-function-declaration CMAKE_C_FLAGS)"
      "if(NOT MSVC)\nadd_if_flag_compiles(-Werror=implicit-function-declaration CMAKE_C_FLAGS)\nendif()"
      RAYLIB_COMPILER_FLAGS_CONTENT
      "${RAYLIB_COMPILER_FLAGS_CONTENT}")
    string(REPLACE
      "add_if_flag_compiles(-fno-strict-aliasing CMAKE_C_FLAGS)"
      "if(NOT MSVC)\nadd_if_flag_compiles(-fno-strict-aliasing CMAKE_C_FLAGS)\nendif()"
      RAYLIB_COMPILER_FLAGS_CONTENT
      "${RAYLIB_COMPILER_FLAGS_CONTENT}")
    file(WRITE "${RAYLIB_COMPILER_FLAGS_FILE}" "${RAYLIB_COMPILER_FLAGS_CONTENT}")
  endif()

  add_subdirectory("${raylib_SOURCE_DIR}" "${raylib_BINARY_DIR}" EXCLUDE_FROM_ALL)
endif()

FetchContent_MakeAvailable(nlohmann_json)

add_library(
  particle_simulator_core
  src/app.cpp
  src/cli.cpp
  src/config.cpp
  src/simulation.cpp
)

target_include_directories(
  particle_simulator_core
  PUBLIC
    ${PROJECT_SOURCE_DIR}/include
)

target_link_libraries(
  particle_simulator_core
  PUBLIC
    nlohmann_json::nlohmann_json
)

target_compile_features(particle_simulator_core PUBLIC cxx_std_20)

add_executable(
  particle_simulator
  src/main.cpp
  src/rendering.cpp
)

target_link_libraries(
  particle_simulator
  PRIVATE
    particle_simulator_core
    raylib
)

if(WIN32)
  target_link_libraries(particle_simulator PRIVATE winmm)
endif()

if(PARTICLE_SIMULATOR_BUILD_WEB_SERVER)
  FetchContent_GetProperties(asio)
  if(NOT asio_POPULATED)
    FetchContent_Populate(asio)
  endif()
  set(ASIO_INCLUDE_DIR "${asio_SOURCE_DIR}/asio/include" CACHE PATH "" FORCE)
  FetchContent_MakeAvailable(crow)

  add_executable(
    particle_simulator_web_server
    src/web_server.cpp
  )

  target_link_libraries(
    particle_simulator_web_server
    PRIVATE
      particle_simulator_core
      Crow::Crow
  )

  if(WIN32)
    target_compile_definitions(particle_simulator_web_server PRIVATE _WIN32_WINNT=0x0601)
  endif()

  if(PARTICLE_SIMULATOR_BUILD_WEB_FRONTEND)
    find_program(NPM_EXECUTABLE npm)
    if(NPM_EXECUTABLE)
      add_custom_target(
        particle_simulator_web_frontend
        COMMAND ${NPM_EXECUTABLE} install
        COMMAND ${NPM_EXECUTABLE} run build
        WORKING_DIRECTORY ${PROJECT_SOURCE_DIR}/web
        COMMENT "Installing and building the web frontend"
      )
      add_dependencies(particle_simulator_web_server particle_simulator_web_frontend)
    else()
      message(WARNING "npm was not found, so PARTICLE_SIMULATOR_BUILD_WEB_FRONTEND was ignored.")
    endif()
  endif()
endif()

if(PARTICLE_SIMULATOR_BUILD_TESTS)
  FetchContent_MakeAvailable(doctest)

  add_executable(
    particle_simulator_tests
    tests/test_main.cpp
    tests/config_tests.cpp
    tests/session_tests.cpp
    tests/simulation_tests.cpp
  )

  target_link_libraries(
    particle_simulator_tests
    PRIVATE
      particle_simulator_core
      doctest::doctest
  )

  include(${doctest_SOURCE_DIR}/scripts/cmake/doctest.cmake)
  doctest_discover_tests(particle_simulator_tests)
endif()
