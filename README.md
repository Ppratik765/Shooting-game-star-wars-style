# Wire Frame Space Shooter

## Overview

Wire Frame Space Shooter is a high-intensity, 6-Degrees-of-Freedom (6-DOF) retro arcade flight simulator featuring cinematic death sequences and smooth combat mechanics. Players navigate a perilous, procedurally generated wireframe hills, managing thrust and weapon charge while engaging dynamic enemy formations. With a strict focus on arcade-perfect responsiveness, atmospheric visuals, and weighty flight physics, the project delivers a deeply immersive space combat experience directly in the browser.

---

## Table of Contents

1. [Key Features]
2. [Core Systems Architecture]
3. [Directory Structure]
4. [Controls & Interaction]
5. [Installation & Setup]
6. [Technical Stack]
7. [Audio Attribution]
8. [License & Citation]
---

## Key Features

* **Advanced Flight Mechanics**: Physics-based 6-DOF movement featuring inertia, simulated mass, thrust/boost mechanics, and stalling logic based on pitch angles.
* **Dynamic Combat System**: Energy-based projectile weapons utilising object pooling for performance. Features cooling cycles, screen-shake impacts, and raycast-based aiming convergence.
* **Atmospheric Visuals**: A striking retro-futuristic wireframe aesthetic overlaid with modern post-processing. Utilises `UnrealBloomPass` for intense neon glows, volumetric ground fog (`FogExp2`), and procedurally generated point-cloud terrain using Simplex noise.
* **Intelligent Enemy Formations**: TIE-variant enemy ships featuring predictive interception logic, swarm behaviours, and environmental collision detection (crashing into procedural terrain).
* **Responsive Tactical UI/UX**: Diegetic HUD elements built with HTML/CSS superimposed over the WebGL canvas. Features real-time spatial radar, an Arc HUD for stamina and charge tracking, dynamic crosshair lerping, and cinematic camera transitions upon critical events.
* **Spatial Audio Engine**: Custom audio manager leveraging the Web Audio API for 3D positional audio, dynamic engine pitch shifting, and distance-based volume roll-offs.

---

## Core Systems Architecture

| System | Primary Responsibility | Key Interactions |
| --- | --- | --- |
| **GameManager** | Manages the main game loop, state transitions, time scaling, and scene rendering. | Initializes and coordinates all other managers; dictates game over states. |
| **PlayerShip** | Calculates 6-DOF physics, handles stamina regeneration, gravity, lift, and camera manipulation. | Receives input from `InputController`; interacts with `Terrain` for collision detection. |
| **WeaponSystem** | Maintains an object pool of projectiles to ensure optimal memory performance. | Calculates raycast trajectories; checks bounding-sphere collisions with enemies. |
| **EnemyManager** | Spawns and animates enemy units, manages wave difficulty, and flight AI. | Uses `Terrain` to calculate environmental crashes; triggers `ParticleSystem` on death. |
| **ParticleSystem** | Handles high-performance `THREE.InstancedMesh` explosions. | Manages airbursts and ground-impact shockwaves without instantiating new geometries. |
| **AudioManager** | Manages all Web Audio API nodes, spatial panning, and asynchronous decoding. | Dynamically alters engine pitch based on velocity; tracks enemy positions for flyby audio. |
| **UIManager** | Bridges the 3D space to the 2D DOM. Renders the Arc HUD, radar blips, and UI overlays. | Projects 3D enemy coordinates to 2D screen space for floating health bars. |

---

## Directory Structure

```text
Wire Frame Shooting/
├── dist/                   # Production build output
├── node_modules/           # Project dependencies
├── public/                 # Static assets
│   ├── favicon.svg
│   └── icons.svg
├── src/                    # Source code
│   ├── AudioManager.js     # Handles Web Audio API and spatial sound effects
│   ├── EnemyManager.js     # Enemy spawning, movement, and flight AI logic
│   ├── GameManager.js      # Core game loop and state management
│   ├── InputController.js  # Keyboard, mouse, and device orientation handling
│   ├── ParticleSystem.js   # Instanced mesh visual effects for explosions
│   ├── PlayerShip.js       # Player physics, gravity, and state tracking
│   ├── Terrain.js          # Procedural wireframe canyon generation (Simplex Noise)
│   ├── UIManager.js        # Heads-up display, radar, and 3D-to-2D UI mapping
│   ├── WeaponSystem.js     # Projectile pooling, raycasting, and hit detection
│   ├── assets/             # In-game textures, audio files, and SVGs
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

* **Device Tilt (Gyroscope)**: Steer ship via the DeviceOrientation API
* **Screen Tap**: Fire Dual Plasma Charges

---

## Installation & Setup

1. **Clone the repository**: Ensure you have Node.js installed on your system.
2. **Install dependencies**: Navigate to the project root and run:
```bash
npm install

```


3. **Start the development server**: Launch the local Vite development environment by running:
```bash
npm run dev

```


4. **Build for production**: To create an optimized, minified build in the `dist` directory, run:
```bash
npm run build

```



---

## Technical Stack

* **Language**: Vanilla JavaScript (ES6 Modules)
* **3D Rendering**: Three.js (WebGL)
* **Post-Processing**: Three.js `EffectComposer` (`RenderPass`, `UnrealBloomPass`)
* **Audio**: Native Web Audio API
* **Procedural Math**: `simplex-noise`
* **Interface**: HTML5, CSS3
* **Build Tool**: Vite

The application is built entirely without heavy frontend frameworks (like React or Vue) to ensure minimal overhead. It leverages an object pooling architecture for projectiles and particles, maintaining a consistent 60+ FPS performance even during intense combat scenarios with heavy post-processing.

---

## Audio Attribution

The immersive soundscape of this project relies heavily on the open-source audio community. Sound effects, including the engine loops, plasma blasts, UI interaction feedback, flybys, and impact explosions, were sourced from [Freesound.org](https://www.google.com/search?q=https://freesound.org/).

All audio files utilised in this project are licensed under the **Creative Commons 0 (CC0)** public domain license. Gratitude is extended to the various independent Foley artists and sound designers who contribute to the Freesound database, making independent game development possible.

---

## License & Citation

This project is licensed under the MIT License. You are free to use, modify, and distribute this software, provided that the original copyright notice and this permission notice are included in all copies or substantial portions of the software.

If you utilise this architecture, flight physics methodology, or rendering pipeline in academic research or technical demonstrations, please attribute as follows:

```text
Priyanshu Pratik, Wire Frame Shooting, 2026.

```
