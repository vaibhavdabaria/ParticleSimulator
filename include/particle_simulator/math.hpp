#pragma once

#include <algorithm>
#include <cmath>

namespace particle_simulator {

// Minimal 2D vector type used everywhere in the simulator.
// We keep it intentionally small so math stays lightweight and easy to inline.
struct Vec2 {
  double x = 0.0;
  double y = 0.0;
};

// Basic vector arithmetic helpers.
inline Vec2 operator+(const Vec2& lhs, const Vec2& rhs) {
  return {lhs.x + rhs.x, lhs.y + rhs.y};
}

inline Vec2 operator-(const Vec2& lhs, const Vec2& rhs) {
  return {lhs.x - rhs.x, lhs.y - rhs.y};
}

inline Vec2 operator*(const Vec2& value, double scalar) {
  return {value.x * scalar, value.y * scalar};
}

inline Vec2 operator*(double scalar, const Vec2& value) {
  return value * scalar;
}

inline Vec2 operator/(const Vec2& value, double scalar) {
  return {value.x / scalar, value.y / scalar};
}

inline Vec2& operator+=(Vec2& lhs, const Vec2& rhs) {
  lhs.x += rhs.x;
  lhs.y += rhs.y;
  return lhs;
}

inline Vec2& operator-=(Vec2& lhs, const Vec2& rhs) {
  lhs.x -= rhs.x;
  lhs.y -= rhs.y;
  return lhs;
}

inline Vec2& operator*=(Vec2& value, double scalar) {
  value.x *= scalar;
  value.y *= scalar;
  return value;
}

// Dot product is the foundation for projection, angles, and collision math.
inline double Dot(const Vec2& lhs, const Vec2& rhs) {
  return lhs.x * rhs.x + lhs.y * rhs.y;
}

// Avoids an unnecessary square root when we only need relative distance.
inline double LengthSquared(const Vec2& value) {
  return Dot(value, value);
}

inline double Length(const Vec2& value) {
  return std::sqrt(LengthSquared(value));
}

// Returns a unit vector in the same direction.
// Near-zero vectors are mapped to {0, 0} to avoid divide-by-zero noise.
inline Vec2 Normalize(const Vec2& value) {
  const double length = Length(value);
  if (length <= 1e-9) {
    return {};
  }
  return value / length;
}

// Clamp each component independently into the supplied bounds.
inline Vec2 Clamp(const Vec2& value, const Vec2& min, const Vec2& max) {
  return {
      std::clamp(value.x, min.x, max.x),
      std::clamp(value.y, min.y, max.y),
  };
}

// Scalar clamp convenience overload.
inline double Clamp(double value, double min, double max) {
  return std::clamp(value, min, max);
}

// Linear interpolation helper.
inline double Lerp(double a, double b, double t) {
  return a + (b - a) * t;
}

}  // namespace particle_simulator
