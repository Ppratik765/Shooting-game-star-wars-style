import { UIManager } from './UIManager.js';
import { InputController } from './InputController.js';
import { PlayerShip } from './PlayerShip.js';
import { Terrain } from './Terrain.js';
import { WeaponSystem } from './WeaponSystem.js';
import { ParticleSystem } from './ParticleSystem.js';
import { EnemyManager } from './EnemyManager.js';

export class GameManager {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.isDead = false;
    this.deathFlashTimer = 0;

    this.state = {
      timeSurvived: 0,
      kills: 0
    };

    // Initialize subsystems
    this.uiManager = new UIManager();
    this.inputController = new InputController();
    this.playerShip = new PlayerShip(this.camera);
    this.terrain = new Terrain(this.scene);
    this.particleSystem = new ParticleSystem(this.scene);
    this.enemyManager = new EnemyManager(this.scene, this.particleSystem, this.playerShip);
    this.weaponSystem = new WeaponSystem(this.scene, this.camera, this.enemyManager, this.uiManager);

    // Give enemy manager access to terrain
    this.enemyManager.terrain = this.terrain;

    // Callbacks
    this.enemyManager.onEnemyKilled = () => {
      this.state.kills++;
      this.uiManager.addLog('TARGET DESTROYED');
    };

    this.enemyManager.onPlayerHit = () => {
      this.uiManager.triggerDamageFlash();
      this.uiManager.addLog('INCOMING FIRE — HULL DAMAGE', 'critical');
    };

    // Retry button
    const retryBtn = document.getElementById('retry-button');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.reset());
    }

    this.uiManager.addLog('ALL SYSTEMS NOMINAL', 'normal');
    this.uiManager.addLog('WEAPONS HOT — ENGAGE AT WILL', 'warning');
  }

  update(deltaTime, currentTime) {
    // Clamp delta to prevent physics explosion on tab-switch
    deltaTime = Math.min(deltaTime, 0.1);

    if (this.isDead) {
      // Still render particles for visual effect during death
      this.particleSystem.update(deltaTime, this.terrain);
      return;
    }

    // Update game time
    this.state.timeSurvived += deltaTime;

    // Update subsystems
    this.playerShip.update(deltaTime, this.inputController, this.terrain);
    this.terrain.update(this.playerShip.camera.position.x, this.playerShip.camera.position.z);
    this.enemyManager.update(deltaTime);
    this.weaponSystem.update(deltaTime, this.inputController, currentTime, this.playerShip.velocity);
    this.particleSystem.update(deltaTime, this.terrain);

    // UI updates
    this.uiManager.setCrosshairTarget(this.inputController.mouse.x, this.inputController.mouse.y);
    this.uiManager.update(
      deltaTime,
      this.playerShip.getState(),
      this.state,
      this.weaponSystem.getChargeState()
    );
    this.uiManager.updateEnemyUI(this.camera, this.enemyManager.getEnemies(), this.weaponSystem.lockedEnemy);

    // Cleanup input
    this.inputController.clearDeltas();

    // Check death conditions
    this._checkPlayerCollisions();
    this._checkDeathConditions();
  }

  _checkPlayerCollisions() {
    const enemies = this.enemyManager.getEnemies();
    const playerPos = this.playerShip.camera.position;

    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (!enemy.active) continue;

      const dist = playerPos.distanceTo(enemy.mesh.position);
      if (dist < 12) {
        this.uiManager.triggerDamageFlash();
        this.uiManager.addLog('HULL BREACH DETECTED', 'critical');
        this.playerShip.hp -= 20;
        this.enemyManager.killEnemy(enemy, false);
      }
    }
  }

  _checkDeathConditions() {
    // Terrain crash
    if (this.playerShip.terrainCrashed) {
      this._triggerDeath('TERRAIN IMPACT — SHIP DESTROYED');
      return;
    }

    // HP depletion
    if (this.playerShip.hp <= 0) {
      this.playerShip.hp = 0;
      this._triggerDeath('HULL INTEGRITY ZERO — SHIP DESTROYED');
    }
  }

  _triggerDeath(message) {
    this.isDead = true;
    this.uiManager.addLog(message, 'critical');

    // Spawn massive explosion at player position
    this.particleSystem.spawnGroundExplosion(this.playerShip.camera.position);

    // Flash the damage overlay hard
    this.uiManager.triggerDamageFlash();

    // Show game over after a short delay
    setTimeout(() => {
      this.uiManager.showGameOver(this.state);
    }, 800);
  }

  reset() {
    this.isDead = false;
    this.state.timeSurvived = 0;
    this.state.kills = 0;

    this.playerShip.reset();
    this.enemyManager.reset();
    this.weaponSystem.reset();
    this.particleSystem.reset();
    this.uiManager.reset();

    this.uiManager.addLog('CLONE ACTIVATED — SYSTEMS ONLINE', 'normal');
  }
}
