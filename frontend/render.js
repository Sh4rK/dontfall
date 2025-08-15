// Three.js renderer for Don't Fall (tiles via InstancedMesh, simple capsule players)

import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';

export class Renderer {
  constructor(containerEl) {
    this.container = containerEl;
    this.scene = new THREE.Scene();
    this.camera = null;
    this.renderer = null;

    this.tileMesh = null;
    this.tileCount = 0;
    this.tileGrid = { width: 0, height: 0, halfW: 0, halfH: 0, size: 1.0 };

    this.players = new Map(); // id -> { mesh, color }
    this.playersGroup = new THREE.Group();
    this.scene.add(this.playersGroup);

    this.arrow = null;

    this._tmpMat = new THREE.Matrix4();
    this._qIdent = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3(1,1,1);

    this._onResize = () => this.resize();
  }

  setup(constants, mapSize) {
    const W = mapSize?.width ?? 15;
    const H = mapSize?.height ?? 15;
    const TS = constants.TILE_SIZE ?? 1.0;
    this.tileGrid = { width: W, height: H, halfW: W/2, halfH: H/2, size: TS };

    // Camera
    const fov = 60;
    const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 200);
    const span = Math.max(W, H) * TS;
    const camY = span * 0.9;
    const camZ = span * 0.9;
    this.camera.position.set(0, camY, camZ);
    this.camera.lookAt(0, 0, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.container.appendChild(this.renderer.domElement);

    // Lights
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(1, 2, 1);
    this.scene.add(dir);

    // Tiles Instanced
    const tileGeom = new THREE.BoxGeometry(TS * 0.96, 0.12, TS * 0.96);
    const tileMat = new THREE.MeshStandardMaterial({ color: 0xe7ecf7, roughness: 0.9, metalness: 0.0 });
    this.tileCount = W * H;
    this.tileMesh = new THREE.InstancedMesh(tileGeom, tileMat, this.tileCount);
    this.tileMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.tileMesh);

    // Local player arrow
    const coneGeom = new THREE.ConeGeometry(TS * 0.25, TS * 0.6, 16);
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0x550000, roughness: 0.6 });
    this.arrow = new THREE.Mesh(coneGeom, coneMat);
    this.arrow.rotation.x = Math.PI; // point down
    this.arrow.visible = false;
    this.scene.add(this.arrow);

    window.addEventListener('resize', this._onResize);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    try { this.renderer?.dispose(); } catch {}
  }

  resize() {
    if (!this.renderer || !this.camera) return;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  // Ensure player mesh exists and color set
  ensurePlayer(id, colorHex = '#cccccc', constants) {
    let p = this.players.get(id);
    if (p) {
      // update color if changed
      const desired = new THREE.Color(colorHex);
      if (!p.mesh.material.color.equals(desired)) {
        p.mesh.material.color.copy(desired);
        p.mesh.material.needsUpdate = true;
      }
      return p.mesh;
    }

    const radius = constants.PLAYER_RADIUS ?? 0.35;
    const height = Math.max((constants.PLAYER_HEIGHT ?? 1.2) - 2 * radius, 0.1);
    const geom = new THREE.CapsuleGeometry(radius, height, 8, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(colorHex),
      roughness: 0.7,
      metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.playersGroup.add(mesh);
    this.players.set(id, { mesh, color: colorHex });
    return mesh;
  }

  // Render one frame
  frame(nowMs, displayPlayers, tilesModel, arrowVisible, selfId, constants) {
    if (!this.renderer || !this.camera) return;

    // Update tiles instanced transforms
    if (this.tileMesh && tilesModel) {
      const { width, height, halfW, halfH, size } = this.tileGrid;
      const amp = constants.TILE_SHAKE_AMPLITUDE ?? 0.05;
      const freq = constants.TILE_SHAKE_FREQUENCY_HZ ?? 10;
      const fallDur = 800; // ms visual drop

      for (let ty = 0; ty < height; ty++) {
        for (let tx = 0; tx < width; tx++) {
          const idx = ty * width + tx;
          const st = tilesModel.state[idx]; // 0 solid, 1 shaking, 2 fallen
          const shakeStart = tilesModel.shakeStart[idx] || 0;
          const fallStart = tilesModel.fallStart[idx] || 0;

          // Base position
          const x = (tx + 0.5 - halfW) * size;
          const z = (ty + 0.5 - halfH) * size;
          let y = 0;

          if (st === 1) {
            const t = (nowMs - shakeStart) / 1000;
            y += amp * Math.sin(t * freq * Math.PI * 2);
          } else if (st === 2) {
            const prog = Math.min(1, Math.max(0, (nowMs - fallStart) / fallDur));
            y -= prog * 2.0; // drop down 2 units
          }

          this._v.set(x, y, z);
          this._tmpMat.compose(this._v, this._qIdent, this._s);
          this.tileMesh.setMatrixAt(idx, this._tmpMat);
        }
      }
      this.tileMesh.instanceMatrix.needsUpdate = true;
    }

    // Update players
    const seen = new Set();
    for (const [id, pstate] of displayPlayers) {
      const mesh = this.ensurePlayer(id, pstate.color, constants);
      seen.add(id);
      if (pstate.alive) {
        mesh.visible = true;
        mesh.position.set(pstate.pos.x, (constants.PLAYER_HEIGHT ?? 1.2) / 2, pstate.pos.y);
        // subtle dash highlight
        const dash = !!pstate.dashActive;
        mesh.material.emissive.setHex(dash ? 0x333333 : 0x000000);
      } else {
        mesh.visible = false;
      }
    }
    // Hide meshes not present
    for (const [id, obj] of this.players) {
      if (!seen.has(id)) obj.mesh.visible = false;
    }

    // Arrow over local
    if (arrowVisible && displayPlayers.has(selfId)) {
      const me = displayPlayers.get(selfId);
      this.arrow.visible = true;
      this.arrow.position.set(me.pos.x, (constants.PLAYER_HEIGHT ?? 1.2) + 0.6, me.pos.y);
    } else {
      this.arrow.visible = false;
    }

    this.renderer.render(this.scene, this.camera);
  }
}