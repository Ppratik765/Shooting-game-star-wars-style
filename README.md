# Wire Frame Space Shooter

## Overview

Wire Frame Space Shooter is a high-intensity, 6-Degrees-of-Freedom (6-DOF) retro arcade flight simulator featuring cinematic death sequences and smooth combat mechanics. Players navigate a perilous, procedurally generated wireframe canyon, managing thrust and weapon charge while engaging dynamic enemy formations. 

With a strict focus on arcade-perfect responsiveness, atmospheric visuals, and weighty flight physics, the project delivers a deeply immersive space combat experience directly in the browser. Recently, the architecture has been upgraded with a **Rust-based WebAssembly (Wasm) Core Engine**, pushing browser performance to its limits by offloading heavy computational physics, particle calculations, and bulk collision detection to highly optimized native-speed code.

---

## Table of Contents

1. [Key Features](#key-features)
2. [Core Systems Architecture](#core-systems-architecture)
3. [Rust + WebAssembly Integration](#rust--webassembly-integration)
4. [Mobile vs. Desktop Optimization](#mobile-vs-desktop-optimization)
5. [Directory Structure](#directory-structure)
6. [Controls & Interaction](#controls--interaction)
7. [Installation & Setup](#installation--setup)
8. [Technical Stack](#technical-stack)
9. [Audio Attribution](#audio-attribution)
10. [License & Citation](#license--citation)

---

## Key Features

* **Advanced Flight Mechanics (Rust-Powered)**: Physics-based 6-DOF movement featuring inertia, simulated mass, thrust/boost mechanics, and stalling logic based on pitch angles. All flight physics are calculated in Rust for deterministic precision.
* **Dynamic Combat System**: Energy-based projectile weapons utilizing object pooling for performance. Features cooling cycles, screen-shake impacts, and raycast-based aiming convergence. Bulk collision detection between hundreds of projectiles and enemies is processed entirely in Wasm.
* **Atmospheric Visuals**: A striking retro-futuristic wireframe aesthetic overlaid with modern post-processing. Utilizes Three.js `UnrealBloomPass` for intense neon glows, volumetric ground fog (`FogExp2`), and procedurally generated point-cloud terrain using Simplex noise.
* **Intelligent Enemy Formations**: TIE-variant enemy ships (Standard, Interceptor, Bomber, Advanced) featuring predictive interception logic, swarm behaviors, and environmental collision detection (crashing into procedural terrain).
* **Power-Up System**: Dynamic, glowing geometric power-ups (Hull Integrity, Shield Capacitors, Engine Overdrives) that drop during combat to sustain the player through infinite waves.
* **Responsive Tactical UI/UX**: Diegetic HUD elements built with HTML/CSS superimposed over the WebGL canvas. Features real-time spatial radar, an Arc HUD for stamina and charge tracking, dynamic crosshair lerping, and cinematic camera transitions upon critical events.
* **Spatial Audio Engine**: Custom audio manager leveraging the Web Audio API for 3D positional audio, dynamic engine pitch shifting, and distance-based volume roll-offs.

---

## Core Systems Architecture

| System | Primary Responsibility | Key Interactions |
| --- | --- | --- |
| **GameManager** | Manages the main game loop, state transitions, time scaling, and scene rendering. | Initializes and coordinates all other managers; dictates game over states. |
| **PlayerShip (JS + Rust)** | Calculates 6-DOF physics, handles stamina regeneration, gravity, lift, and camera manipulation. | Reads directly from Wasm shared linear memory buffers via `Float32Array` views for zero-overhead state syncing. |
| **WeaponSystem** | Maintains an object pool of projectiles to ensure optimal memory performance. | Offloads bulk bounding-sphere collision detection to the Rust Wasm engine. |
| **EnemyManager** | Spawns and animates enemy units, manages wave difficulty, and flight AI. | Uses `Terrain` to calculate environmental crashes; triggers Wasm `ParticleSystem` on death. |
| **ParticleSystem (Rust)** | Handles high-performance `THREE.InstancedMesh` explosions. | The Rust engine calculates physics for up to 4,000 particles, writing matrices and colors directly into shared memory that Three.js reads. |
| **AudioManager** | Manages all Web Audio API nodes, spatial panning, and asynchronous decoding. | Dynamically alters engine pitch based on velocity; tracks enemy positions for flyby audio. |
| **UIManager** | Bridges the 3D space to the 2D DOM. Renders the Arc HUD, radar blips, and UI overlays. | Projects 3D enemy coordinates to 2D screen space for floating health bars. |

---

## Rust + WebAssembly Integration

To achieve maximum framerate with thousands of active particles and entities, the core physics engine was ported to Rust and compiled to WebAssembly using `wasm-bindgen`.

### Data-Oriented Batch Processing
Instead of passing individual objects back and forth across the JS/Wasm boundary (which incurs massive serialization overhead), the game utilizes a **Data-Oriented Design (DOD)**:
1. JavaScript gathers a flat array of all enemy positions and laser positions.
2. It passes pointers to these flat Float32Arrays into a single Wasm function (`check_bulk_laser_hits`).
3. Rust performs lightning-fast contiguous memory iteration to resolve all collisions.
4. Rust returns an array of hit indices, completely bypassing per-object boundary overhead.

### Zero-Copy Memory Sharing
The `ParticleSystem` and `PlayerShip` utilize zero-copy memory architecture. The Rust engine allocates memory for the particle transformation matrices and colors. JavaScript creates `Float32Array` views directly over this linear Wasm memory (`wasm.memory.buffer`). Every frame, Three.js reads from these buffers directly into the GPU via `InstancedMesh`, allowing 4,000+ physics-driven particles without a single memory copy or garbage collection pause.

---

## Mobile vs. Desktop Optimization

To ensure a locked 60 FPS on high-end desktop GPUs as well as integrated mobile graphics, the engine employs dynamic rendering pathways based on device capability:

* **Post-Processing & Bloom**: 
  * **Desktop**: Utilizes a highly customized `UnrealBloomPass` dialed into exactly 3 render passes to provide a lush, expensive neon blur.
  * **Mobile**: `UnrealBloomPass` is completely disabled to save GPU fill rate. Instead, a custom "Fake Glow" technique is applied—spawning slightly larger, highly transparent cloned wireframe meshes with `AdditiveBlending` on enemies and powerups to simulate a neon aura at a fraction of the cost.
* **Particle Blending**: Mobile explosions force `AdditiveBlending` on standard particles to create a blinding white-hot plasma core without relying on HDR bloom thresholding.
* **Terrain Generation**: Desktop uses a 500x500 scrolling point grid, while mobile scales down to 250x250, radically reducing the number of Simplex Noise evaluations in the vertex shader.
* **Fill Rate Clamping**: The `pixelRatio` is tightly clamped to `1.0` on integrated GPUs to prevent high-DPI displays from starving the GPU pipeline.

---

## Directory Structure

```text
Wire Frame Shooting/
├── core-engine/            # Rust WebAssembly Core Engine
│   ├── Cargo.toml          # Rust dependencies
│   └── src/
│       ├── lib.rs          # Wasm entry points & memory allocators
│       ├── engine.rs       # Main simulation loop
│       ├── entities/       # Player physics (player.rs)
│       └── systems/        # Particles & bulk collisions (particles.rs, collisions.rs)
├── pkg/                    # Compiled WebAssembly output (generated by wasm-pack)
├── dist/                   # Production Webpack/Vite build output
├── public/                 # Static assets (favicons, etc.)
├── src/                    # JavaScript Source code
│   ├── wasm.js             # Wasm module loader and JS-side wrappers
│   ├── AudioManager.js     # Handles Web Audio API and spatial sound effects
│   ├── EnemyManager.js     # Enemy spawning, movement, and flight AI logic
│   ├── GameManager.js      # Core game loop and state management
│   ├── InputController.js  # Keyboard, mouse, and device orientation handling
│   ├── ParticleSystem.js   # Instanced mesh visual effects for explosions (reads Wasm memory)
│   ├── PlayerShip.js       # Bridges input to the Rust player physics engine
│   ├── Terrain.js          # Procedural wireframe canyon generation (Simplex Noise shader)
│   ├── UIManager.js        # Heads-up display, radar, and 3D-to-2D UI mapping
│   ├── WeaponSystem.js     # Projectile pooling, raycasting, and hit detection
│   ├── main.js             # Application entry point and rendering pipeline setup
│   └── style.css           # CSS styling for the interface, HUD, and overlays
├── index.html              # Main HTML entry point
├── package.json            # NPM configuration and scripts
└── README.md               # Project documentation
```

---

## Controls & Interaction

### Desktop Operations
* **W / S**: Pitch (Nose Down / Nose Up)
* **A / D**: Roll and Lateral Strafe (Navigate Valleys)
* **Mouse Movement**: Aiming (Crosshair lerps toward cursor)
* **Left Shift**: Activate Engine Boost (Consumes Stamina)
* **Left Mouse Button / Spacebar**: Fire Dual Plasma Charges

### Mobile Operations
* **Orientation Detection**: Automatically prompts user to rotate to Landscape mode.
* **Device Tilt (Gyroscope)**: Steer ship via the DeviceOrientation API (Beta/Gamma angles).
* **Screen Tap**: Fire Dual Plasma Charges (Left/Right side thumb taps).

---

## Installation & Setup

Because this project utilizes a Rust WebAssembly core, you must have the Rust toolchain installed.

1. **Install Prerequisites**: 
   * [Node.js](https://nodejs.org/)
   * [Rust Toolchain (rustup)](https://rustup.rs/)
   * [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) (`cargo install wasm-pack`)

2. **Clone the repository**:
   ```bash
   git clone https://github.com/Ppratik765/Shooting-game-star-wars-style.git
   cd Shooting-game-star-wars-style
   ```

3. **Compile the WebAssembly Engine**:
   Navigate into the Rust directory and build the `pkg` directory for the web:
   ```bash
   cd core-engine
   wasm-pack build --target web --out-dir ../pkg
   cd ..
   ```

4. **Install JS Dependencies**:
   ```bash
   npm install
   ```

5. **Start the Development Server**:
   Launch the local Vite development environment:
   ```bash
   npm run dev
   ```

6. **Build for Production**:
   To create an optimized, minified build in the `dist` directory:
   ```bash
   npm run build
   ```

---

## Technical Stack

* **Language**: Vanilla JavaScript (ES6 Modules) + Rust
* **WebAssembly**: `wasm-bindgen` for JS/Rust interoperability
* **3D Rendering**: Three.js (WebGL)
* **Post-Processing**: Three.js `EffectComposer` (`RenderPass`, `UnrealBloomPass`)
* **Audio**: Native Web Audio API
* **Procedural Math**: GLSL Simplex Noise (Vertex Shaders)
* **Interface**: HTML5, CSS3
* **Build Tool**: Vite

The application is built entirely without heavy frontend frameworks (like React or Vue) to ensure minimal DOM manipulation overhead. The combination of JavaScript object pooling and Rust WebAssembly linear memory arrays maintains a consistent 60+ FPS performance even during intense combat scenarios with thousands of entities.

---

## Audio Attribution

The immersive soundscape of this project relies heavily on the open-source audio community. Sound effects, including the engine loops, plasma blasts, UI interaction feedback, flybys, and impact explosions, were sourced from [Freesound.org](https://freesound.org/).

All audio files utilized in this project are licensed under the **Creative Commons 0 (CC0)** public domain license. Gratitude is extended to the various independent Foley artists and sound designers who contribute to the Freesound database, making independent game development possible.

---

## License & Citation

This project is licensed under the MIT License. You are free to use, modify, and distribute this software, provided that the original copyright notice and this permission notice are included in all copies or substantial portions of the software.

If you utilize this architecture, WebAssembly physics methodology, or rendering pipeline in academic research or technical demonstrations, please attribute as follows:

```text
Priyanshu Pratik, Wire Frame Shooting, 2026.
```