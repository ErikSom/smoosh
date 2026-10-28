# Optional native Box2D bridge

Smoosh works with the standard `box2d3-wasm` npm package. This optional bridge batches pose/fixture packing and feedback inside the same WASM module as Box2D. The adapter detects `SmooshBox2DBridge` automatically; the site displays whether it is using native or JavaScript packing.

To build the bridge with [Birch-san/box2d3-wasm](https://github.com/Birch-san/box2d3-wasm):

1. Copy `smoosh.cpp` into that repository's `box2d3-wasm/csrc/` folder.
2. Add `"$CSRC_DIR/smoosh.cpp"` to `box2d3-wasm/shell/1_build_wasm.sh` beside `glue.cpp`, `threading.cpp` and `debugDraw.cpp` in the Emscripten link command.
3. Follow the Box2D repository's Emscripten configure/build instructions and rebuild the desired WASM variant.
4. Pass the resulting Box2D module and world to `Smoosh.create()`. Keep all related Box2D wrapper/WASM files from the same build together.

The bridge ABI is defined alongside the JavaScript implementation in `src/layout.mjs` and `src/box2d-adapter.mjs`. Run the native/fallback comparison tests against a custom build before updating that ABI. Public CI uses the unmodified published Box2D package; its native-only comparison test is skipped when the class is absent.
