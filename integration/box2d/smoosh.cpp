// Smoosh's fixed storage ABI. Keep constants in sync with smoosh/src/layout.mjs.
// All particle simulation stays on WebGPU; this bridge batches Box2D access.
#include <box2d/box2d.h>
#include <box2d/math_functions.h>
#include <emscripten/bind.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <stdexcept>
#include <vector>

namespace {
constexpr int maxBodies = 128, maxShapes = 512, bodyWords = 12, shapeWords = 46;
constexpr int shapesOffset = 4 + maxBodies * bodyWords;
constexpr int totalWords = shapesOffset + maxShapes * shapeWords;

class SmooshBox2DBridge {
    float cell;
    double originX, originY;
    std::vector<b2BodyId> bodies;
    std::array<float, totalWords> data{};
    std::array<int32_t, maxBodies * 4> impulses{};
    bool geometryDirty = true;

    void geometry() {
        int shapeCount = 0;
        for (size_t i = 0; i < bodies.size(); ++i) {
            const int base = 4 + int(i) * bodyWords;
            data[base + 9] = float(shapeCount);
            data[base + 10] = 0;
            data[base + 11] = 0;
            if (!b2Body_IsValid(bodies[i])) continue;
            const int count = b2Body_GetShapeCount(bodies[i]);
            std::vector<b2ShapeId> shapes(count);
            b2Body_GetShapes(bodies[i], shapes.data(), count);
            float bodyRadius = 0;
            for (b2ShapeId id : shapes) {
                if (b2Shape_IsSensor(id)) continue;
                const auto type = b2Shape_GetType(id);
                if (type != b2_circleShape && type != b2_polygonShape && type != b2_capsuleShape && type != b2_segmentShape && type != b2_chainSegmentShape) continue;
                if (shapeCount >= maxShapes) throw std::runtime_error("Smoosh supports at most 512 registered shapes");
                float* s = data.data() + shapesOffset + shapeCount * shapeWords;
                std::fill(s, s + shapeWords, 0.0f);
                s[3] = float(type);
                float radius = 0;
                if (type == b2_circleShape) {
                    const auto circle = b2Shape_GetCircle(id);
                    s[0] = circle.center.x / cell; s[1] = circle.center.y / cell; s[2] = circle.radius / cell;
                    radius = std::hypot(s[0], s[1]) + s[2];
                    s[4] = s[2];
                } else if (type == b2_polygonShape) {
                    const auto polygon = b2Shape_GetPolygon(id);
                    s[2] = polygon.radius / cell; s[5] = float(polygon.count);
                    for (int v = 0; v < polygon.count; ++v) {
                        const float x = polygon.vertices[v].x / cell, y = polygon.vertices[v].y / cell;
                        s[6 + v * 2] = x; s[7 + v * 2] = y;
                        s[22 + v * 2] = polygon.normals[v].x; s[23 + v * 2] = polygon.normals[v].y;
                        s[38 + v] = polygon.normals[v].x * x + polygon.normals[v].y * y;
                        radius = std::max(radius, std::hypot(x, y) + s[2]);
                    }
                    s[4] = radius;
                } else {
                    b2Vec2 p1, p2;
                    if (type == b2_capsuleShape) {
                        const auto capsule = b2Shape_GetCapsule(id);
                        p1 = capsule.center1; p2 = capsule.center2; s[2] = capsule.radius / cell;
                    } else {
                        const auto segment = type == b2_chainSegmentShape ? b2Shape_GetChainSegment(id).segment : b2Shape_GetSegment(id);
                        p1 = segment.point1; p2 = segment.point2; s[2] = 0.35f;
                    }
                    s[6] = p1.x / cell; s[7] = p1.y / cell;
                    s[8] = p2.x / cell; s[9] = p2.y / cell;
                    radius = std::max(std::hypot(s[6], s[7]), std::hypot(s[8], s[9])) + s[2];
                    s[4] = radius;
                }
                bodyRadius = std::max(bodyRadius, radius);
                data[base + 10] += 1;
                shapeCount++;
            }
            data[base + 11] = (bodyRadius + 2) * (bodyRadius + 2);
        }
        const uint32_t count = uint32_t(bodies.size()), shapes = uint32_t(shapeCount);
        std::memcpy(data.data(), &count, sizeof(count));
        std::memcpy(data.data() + 1, &shapes, sizeof(shapes));
        geometryDirty = false;
    }

public:
    SmooshBox2DBridge(float cellSize, double x, double y) : cell(cellSize), originX(x), originY(y) {
        if (!(cell > 0 && std::isfinite(cell) && std::isfinite(x) && std::isfinite(y))) throw std::invalid_argument("Invalid Smoosh coordinate system");
        bodies.reserve(maxBodies);
    }
    void addBody(b2BodyId body) {
        if (!b2Body_IsValid(body)) throw std::invalid_argument("Invalid Box2D body");
        if (bodies.size() >= maxBodies) throw std::runtime_error("Smoosh supports at most 128 registered bodies");
        if (std::any_of(bodies.begin(), bodies.end(), [body](b2BodyId id) { return B2_ID_EQUALS(id, body); })) return;
        bodies.push_back(body); geometryDirty = true;
    }
    void clear() { bodies.clear(); geometryDirty = true; data.fill(0); impulses.fill(0); }
    void invalidateGeometry() { geometryDirty = true; }
    void refresh() {
        if (geometryDirty) geometry();
        for (size_t i = 0; i < bodies.size(); ++i) {
            float* b = data.data() + 4 + int(i) * bodyWords;
            if (!b2Body_IsValid(bodies[i])) { b[0] = 0; b[10] = 0; continue; }
            const auto position = b2Body_GetPosition(bodies[i]);
            const auto center = b2Body_GetWorldCenter(bodies[i]);
            const auto velocity = b2Body_GetLinearVelocity(bodies[i]);
            const auto rotation = b2Body_GetRotation(bodies[i]);
            b[0] = b2Body_GetType(bodies[i]) == b2_dynamicBody ? b2Body_GetMass(bodies[i]) : 0;
            b[1] = float((center.x - originX) / cell + 5); b[5] = float((center.y - originY) / cell + 5);
            b[2] = float((position.x - originX) / cell + 5); b[3] = float((position.y - originY) / cell + 5);
            b[4] = b2Rot_GetAngle(rotation); b[6] = velocity.x / cell; b[7] = velocity.y / cell;
            b[8] = b2Body_GetAngularVelocity(bodies[i]);
        }
    }
    emscripten::val getData() { return emscripten::val(emscripten::typed_memory_view(data.size(), data.data())); }
    emscripten::val getImpulseBuffer() { return emscripten::val(emscripten::typed_memory_view(impulses.size(), impulses.data())); }
    void applyImpulses(float maxVelocityChange) {
        for (size_t i = 0; i < bodies.size(); ++i) {
            const auto id = bodies[i];
            if (!b2Body_IsValid(id) || b2Body_GetType(id) != b2_dynamicBody) continue;
            b2Vec2 impulse = { float(impulses[i * 4]) / 100000.0f, float(impulses[i * 4 + 1]) / 100000.0f };
            float angular = float(impulses[i * 4 + 2]) / 100000.0f;
            const float length = b2Length(impulse), maxImpulse = b2Body_GetMass(id) * maxVelocityChange;
            const float factor = length > maxImpulse && length > 0 ? maxImpulse / length : 1.0f;
            impulse = b2MulSV(factor, impulse);
            const float maxAngular = b2Body_GetRotationalInertia(id) * maxVelocityChange;
            angular = std::clamp(angular * factor, -maxAngular, maxAngular);
            if (b2LengthSquared(impulse) > 0) b2Body_ApplyLinearImpulseToCenter(id, impulse, true);
            if (angular != 0) b2Body_ApplyAngularImpulse(id, angular, true);
        }
        impulses.fill(0);
    }
};
}

EMSCRIPTEN_BINDINGS(smoosh_bridge) {
    emscripten::class_<SmooshBox2DBridge>("SmooshBox2DBridge")
        .constructor<float, double, double>()
        .function("addBody", &SmooshBox2DBridge::addBody)
        .function("clear", &SmooshBox2DBridge::clear)
        .function("invalidateGeometry", &SmooshBox2DBridge::invalidateGeometry)
        .function("refresh", &SmooshBox2DBridge::refresh)
        .function("getData", &SmooshBox2DBridge::getData)
        .function("getImpulseBuffer", &SmooshBox2DBridge::getImpulseBuffer)
        .function("applyImpulses", &SmooshBox2DBridge::applyImpulses);
}
