/**
 * AudioManager — handles all game audio with Web Audio API.
 * 
 * Audio files:
 *   Player_engine.m4a   — looping engine hum, pitch/volume tied to throttle
 *   laser_bullet.m4a    — one-shot per fire, pooled for rapid overlap
 *   boost_sound.m4a     — plays while boosting, stops when boost ends
 *   Enemy_down_explosion.m4a — one-shot per enemy kill
 *   Enemy_flyby.m4a     — one-shot when enemy passes close
 */

import * as THREE from 'three';
import engineSrc from './assets/Player_engine.m4a?url';
import laserSrc from './assets/laser_bullet.m4a?url';
import boostSrc from './assets/boost_sound.m4a?url';
import explosionSrc from './assets/Enemy_down_explosion.m4a?url';
import flybySrc from './assets/Enemy_flyby.m4a?url';
import hoverSrc from './assets/hover.wav?url';
import clickSrc from './assets/click.wav?url';
import gruntSrc from './assets/Grunt.m4a?url';
import warningSrc from './assets/Warning.m4a?url';

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.compressor = null;
    this.masterGain = null;

    // Decoded buffers
    this.buffers = {
      engine: null,
      laser: null,
      boost: null,
      explosion: null,
      flyby: null,
      hover: null,
      click: null,
      grunt: null,
      warning: null
    };

    // Source nodes / state
    this.engineSource = null;
    this.engineGain = null;
    this.enginePlaying = false;

    this.boostSource = null;
    this.boostGain = null;
    this.boostPlaying = false;

    this.warningSource = null;
    this.warningGain = null;
    this.warningPlaying = false;

    // Pools
    this.laserPool = [];
    this.laserPoolSize = 5;
    this.laserIndex = 0;

    this.explosionPool = [];
    this.explosionPoolSize = 3;
    this.explosionIndex = 0;

    // Active spatial flybys tracking
    this.activeFlybys = [];

    // Flyby cooldown
    this.flybyCooldown = 0;
    this.flybyMinInterval = 3.0; // seconds

    // Preload audio files via fetch
    this._filesToLoad = [
      { key: 'hover', src: hoverSrc },
      { key: 'click', src: clickSrc },
      { key: 'engine', src: engineSrc },
      { key: 'laser', src: laserSrc },
      { key: 'boost', src: boostSrc },
      { key: 'explosion', src: explosionSrc },
      { key: 'flyby', src: flybySrc },
      { key: 'grunt', src: gruntSrc },
      { key: 'warning', src: warningSrc }
    ];

    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();

      // Add a compressor to prevent loud overlapping sounds (engine + boost) from clipping
      // and causing the browser to heavily duck all other audio.
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -12;
      this.compressor.knee.value = 15;
      this.compressor.ratio.value = 3;
      this.compressor.attack.value = 0.01;
      this.compressor.release.value = 0.15;
      this.compressor.connect(this.ctx.destination);

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.8; // Master volume
      this.masterGain.connect(this.compressor);

      // Set up engine gain node
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.0;
      this.engineGain.connect(this.masterGain);

      // Set up boost gain node
      this.boostGain = this.ctx.createGain();
      this.boostGain.gain.value = 0.0;
      this.boostGain.connect(this.masterGain);

      // Set up warning gain node
      this.warningGain = this.ctx.createGain();
      this.warningGain.gain.value = 0.0;
      this.warningGain.connect(this.masterGain);

      this.preloadPromise = this._preload();
    } catch (err) {
      console.warn('AudioManager: Web Audio API unavailable in constructor', err);
      this.preloadPromise = Promise.resolve();
    }
  }

  async _preload() {
    if (!this.ctx) return;

    // Separate priority assets (UI hover/click) from background gameplay assets
    const priorityKeys = ['hover', 'click'];
    const priorityFiles = this._filesToLoad.filter(f => priorityKeys.includes(f.key));
    const backgroundFiles = this._filesToLoad.filter(f => !priorityKeys.includes(f.key));

    // 1. Fetch & decode priority UI sounds first (so they are playable ASAP)
    const priorityPromises = priorityFiles.map(async ({ key, src }) => {
      try {
        if (!src) throw new Error(`Source for ${key} is undefined`);
        const response = await fetch(src);
        if (!response.ok) throw new Error(`HTTP status: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        this.buffers[key] = await this.ctx.decodeAudioData(arrayBuffer);
      } catch (err) {
        console.warn(`AudioManager: failed to preload priority UI asset ${key}`, err);
      }
    });
    await Promise.all(priorityPromises);

    // 2. Fetch & decode background assets in parallel
    const backgroundPromises = backgroundFiles.map(async ({ key, src }) => {
      try {
        if (!src) throw new Error(`Source for ${key} is undefined`);
        const response = await fetch(src);
        if (!response.ok) throw new Error(`HTTP status: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        this.buffers[key] = await this.ctx.decodeAudioData(arrayBuffer);
      } catch (err) {
        console.warn(`AudioManager: failed to preload background asset ${key}`, err);
      }
    });

    await Promise.all(backgroundPromises);
    this.ready = true;
  }

  /**
   * Call on first user interaction (e.g. "Let's Play" click).
   * Awaits preloading and resumes context.
   */
  async resume() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();

        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -12;
        this.compressor.knee.value = 15;
        this.compressor.ratio.value = 3;
        this.compressor.attack.value = 0.01;
        this.compressor.release.value = 0.15;
        this.compressor.connect(this.ctx.destination);

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.8;
        this.masterGain.connect(this.compressor);

        this.engineGain = this.ctx.createGain();
        this.engineGain.gain.value = 0.0;
        this.engineGain.connect(this.masterGain);

        this.boostGain = this.ctx.createGain();
        this.boostGain.gain.value = 0.0;
        this.boostGain.connect(this.masterGain);

        this.warningGain = this.ctx.createGain();
        this.warningGain.gain.value = 0.0;
        this.warningGain.connect(this.masterGain);

        this.preloadPromise = this._preload();
      } catch (err) {
        console.warn('AudioManager: Web Audio API unavailable on resume', err);
        return;
      }
    }

    if (this.preloadPromise) {
      await this.preloadPromise;
    }

    try {
      if (this.ctx && this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      // Start engine loop immediately
      this._startEngine();
    } catch (err) {
      console.warn('AudioManager: Failed to resume audio context', err);
    }
  }

  // ─── Engine Loop ───────────────────────────────────────────────────

  _startEngine() {
    if (!this.ready || !this.buffers.engine || this.enginePlaying) return;

    this.engineSource = this.ctx.createBufferSource();
    this.engineSource.buffer = this.buffers.engine;
    this.engineSource.loop = true;
    this.engineSource.playbackRate.value = 1.0;
    this.engineSource.connect(this.engineGain);
    this.engineSource.start(0);
    this.enginePlaying = true;
  }

  /**
   * Call every frame with current throttle and speed.
   * Adjusts engine pitch and volume.
   */
  updateEngine(throttle, speed) {
    if (!this.ready || !this.enginePlaying) return;

    // Map throttle 60–360 → playbackRate 0.75–1.4
    const normalizedThrottle = Math.max(0, Math.min(1, (throttle - 60) / 300));
    const targetRate = 0.75 + normalizedThrottle * 0.65;
    this.engineSource.playbackRate.value += (targetRate - this.engineSource.playbackRate.value) * 0.08;

    // Map speed 0–400 → volume 0.55–0.85 (Increased player engine volume)
    const normalizedSpeed = Math.max(0, Math.min(1, speed / 400));
    const targetVol = 0.55 + normalizedSpeed * 0.3;
    this.engineGain.gain.value += (targetVol - this.engineGain.gain.value) * 0.08;
  }

  /**
   * Updates the spatial audio listener position and orientation based on player camera.
   */
  updateListener(position, quaternion) {
    if (!this.ready || !this.ctx) return;
    const listener = this.ctx.listener;
    const time = this.ctx.currentTime;

    // Camera forward is along -Z in local coordinates
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);

    if (listener.positionX) {
      listener.positionX.setValueAtTime(position.x, time);
      listener.positionY.setValueAtTime(position.y, time);
      listener.positionZ.setValueAtTime(position.z, time);

      listener.forwardX.setValueAtTime(fwd.x, time);
      listener.forwardY.setValueAtTime(fwd.y, time);
      listener.forwardZ.setValueAtTime(fwd.z, time);

      listener.upX.setValueAtTime(up.x, time);
      listener.upY.setValueAtTime(up.y, time);
      listener.upZ.setValueAtTime(up.z, time);
    } else {
      listener.setPosition(position.x, position.y, position.z);
      listener.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  // ─── Laser ─────────────────────────────────────────────────────────

  playLaser() {
    if (!this.ready || !this.buffers.laser) return;

    const source = this.ctx.createBufferSource();
    source.buffer = this.buffers.laser;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.85; // Increased laser volume
    source.connect(gain);
    gain.connect(this.masterGain);

    // Slight random pitch variation for variety
    source.playbackRate.value = 0.9 + Math.random() * 0.2;
    source.start(0);
  }

  // ─── Boost ─────────────────────────────────────────────────────────

  /**
   * Call every frame with current boost state.
   * Starts boost sound when boosting begins, fades out when it ends.
   */
  updateBoost(isBoosting) {
    if (!this.ready || !this.buffers.boost) return;

    if (isBoosting && !this.boostPlaying) {
      // Start boost sound
      this.boostSource = this.ctx.createBufferSource();
      this.boostSource.buffer = this.buffers.boost;
      this.boostSource.loop = true;
      this.boostSource.connect(this.boostGain);
      this.boostGain.gain.value = 0.0;
      this.boostSource.start(0);
      this.boostPlaying = true;
    }

    if (this.boostPlaying) {
      // Fade in/out
      const targetVol = isBoosting ? 0.35 : 0.0; // Lowered boost volume so it doesn't mask other SFX
      this.boostGain.gain.value += (targetVol - this.boostGain.gain.value) * 0.12;

      // Stop source when fully faded out
      if (!isBoosting && this.boostGain.gain.value < 0.01) {
        this._stopBoost();
      }
    }
  }

  _stopBoost() {
    if (this.boostSource) {
      try { this.boostSource.stop(); } catch (_) { /* already stopped */ }
      this.boostSource = null;
    }
    this.boostPlaying = false;
    if (this.boostGain) this.boostGain.gain.value = 0;
  }

  // ─── Warning ───────────────────────────────────────────────────────

  /**
   * Call every frame with current warning state.
   * Loops warning sound while active.
   */
  updateWarning(isActive) {
    if (!this.ready || !this.buffers.warning) return;

    if (isActive && !this.warningPlaying) {
      this.warningSource = this.ctx.createBufferSource();
      this.warningSource.buffer = this.buffers.warning;
      this.warningSource.loop = true;
      this.warningSource.connect(this.warningGain);
      this.warningGain.gain.value = 0.0;
      this.warningSource.start(0);
      this.warningPlaying = true;
    }

    if (this.warningPlaying) {
      const targetVol = isActive ? 0.8 : 0.0;
      this.warningGain.gain.value += (targetVol - this.warningGain.gain.value) * 0.12;

      if (!isActive && this.warningGain.gain.value < 0.01) {
        this._stopWarning();
      }
    }
  }

  _stopWarning() {
    if (this.warningSource) {
      try { this.warningSource.stop(); } catch (_) { }
      this.warningSource = null;
    }
    this.warningPlaying = false;
    if (this.warningGain) this.warningGain.gain.value = 0;
  }

  // ─── Explosion ─────────────────────────────────────────────────────

  playExplosion(position) {
    if (!this.ready || !this.buffers.explosion) return;

    const source = this.ctx.createBufferSource();
    source.buffer = this.buffers.explosion;

    // Create spatial panner node for directional / distance roll-off audio
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 250;      // Keeps full volume within 250 units
    panner.maxDistance = 2500;     // Beyond this it is inaudible
    panner.rolloffFactor = 1.0;    // Softer fall-off so it remains audible during high-speed boosts

    const time = this.ctx.currentTime;
    if (position) {
      if (panner.positionX) {
        panner.positionX.setValueAtTime(position.x, time);
        panner.positionY.setValueAtTime(position.y, time);
        panner.positionZ.setValueAtTime(position.z, time);
      } else {
        panner.setPosition(position.x, position.y, position.z);
      }
    }

    const gain = this.ctx.createGain();
    gain.gain.value = 1.6; // Increased volume and more bass

    source.connect(panner);
    panner.connect(gain);
    gain.connect(this.masterGain);

    source.playbackRate.value = 0.55 + Math.random() * 0.2; // Lower pitch for heavier bass
    source.start(0);
  }

  // ─── Flyby ─────────────────────────────────────────────────────────

  /**
   * Call with deltaTime and an array of enemies.
   * Plays flyby sound when an enemy passes close and is getting closer.
   */
  updateFlyby(deltaTime, enemies, playerPos) {
    if (!this.ready) return;

    // Update spatial coordinates of active flyby sounds in real-time
    const time = this.ctx.currentTime;
    for (let i = 0; i < this.activeFlybys.length; i++) {
      const flyby = this.activeFlybys[i];
      if (flyby.enemy && flyby.enemy.active) {
        const pos = flyby.enemy.mesh.position;
        if (flyby.panner.positionX) {
          flyby.panner.positionX.setValueAtTime(pos.x, time);
          flyby.panner.positionY.setValueAtTime(pos.y, time);
          flyby.panner.positionZ.setValueAtTime(pos.z, time);
        } else {
          flyby.panner.setPosition(pos.x, pos.y, pos.z);
        }
      }
    }

    if (!this.buffers.flyby) return;

    this.flybyCooldown = Math.max(0, this.flybyCooldown - deltaTime);
    if (this.flybyCooldown > 0) return;

    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (!enemy.active || enemy.dying) continue;

      const dist = enemy.mesh.position.distanceTo(playerPos);
      // Trigger a flyby sound when enemy is within 120 units and closing rapidly
      if (dist < 120 && dist > 20) {
        const toPlayer = playerPos.clone().sub(enemy.mesh.position).normalize();
        const closing = enemy.velocity.dot(toPlayer);
        if (closing > 25) {
          this._playFlyby(enemy);
          this.flybyCooldown = this.flybyMinInterval;
          break;
        }
      }
    }
  }

  _playFlyby(enemy) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffers.flyby;

    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 80;       // Faster volume changes but starting further out
    panner.maxDistance = 1200;
    panner.rolloffFactor = 1.0;

    const pos = enemy.mesh.position;
    const time = this.ctx.currentTime;
    if (panner.positionX) {
      panner.positionX.setValueAtTime(pos.x, time);
      panner.positionY.setValueAtTime(pos.y, time);
      panner.positionZ.setValueAtTime(pos.z, time);
    } else {
      panner.setPosition(pos.x, pos.y, pos.z);
    }

    const gain = this.ctx.createGain();
    gain.gain.value = 1.3; // Loud, clear flyby swoosh

    source.connect(panner);
    panner.connect(gain);
    gain.connect(this.masterGain);

    source.playbackRate.value = 0.95 + Math.random() * 0.1;
    source.start(0);

    // Keep reference to update panner position on updateFlyby ticks
    const flybyRef = { source, panner, enemy };
    this.activeFlybys.push(flybyRef);

    source.onended = () => {
      this.activeFlybys = this.activeFlybys.filter(item => item !== flybyRef);
    };
  }

  // ─── Reset ─────────────────────────────────────────────────────────

  reset() {
    this._stopBoost();
    this._stopWarning();
    // Stop all active flybys
    for (const f of this.activeFlybys) {
      try { f.source.stop(); } catch (_) { }
    }
    this.activeFlybys = [];

    // Restart engine loop
    this._startEngine();
  }

  _stopEngine() {
    if (this.engineSource) {
      try { this.engineSource.stop(); } catch (_) { }
      this.engineSource = null;
    }
    this.enginePlaying = false;
    if (this.engineGain) this.engineGain.gain.value = 0;
  }

  stopAll() {
    this._stopEngine();
    this._stopBoost();
    this._stopWarning();
    for (const f of this.activeFlybys) {
      try { f.source.stop(); } catch (_) { }
    }
    this.activeFlybys = [];
  }

  // ─── UI & Grunt ────────────────────────────────────────────────────

  playUIHover() {
    if (!this.buffers.hover) return;
    if (this.ctx.state !== 'running') return; // Only play if context is running

    const source = this.ctx.createBufferSource();
    source.buffer = this.buffers.hover;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.6;
    source.connect(gain);
    gain.connect(this.masterGain);

    source.start(0);
  }

  async playUIClick() {
    if (!this.buffers.click) return;
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    const source = this.ctx.createBufferSource();
    source.buffer = this.buffers.click;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.8;
    source.connect(gain);
    gain.connect(this.masterGain);

    source.start(0);
  }

  playGrunt() {
    if (!this.ready || !this.buffers.grunt) return;

    const source = this.ctx.createBufferSource();
    source.buffer = this.buffers.grunt;

    const gain = this.ctx.createGain();
    gain.gain.value = 1.0;
    source.connect(gain);
    gain.connect(this.masterGain);

    source.start(0);
  }

  // ─── Cleanup ───────────────────────────────────────────────────────

  dispose() {
    if (this.engineSource) {
      try { this.engineSource.stop(); } catch (_) { /* */ }
    }
    this._stopBoost();
    this._stopWarning();
    if (this.ctx) {
      this.ctx.close();
    }
  }
}