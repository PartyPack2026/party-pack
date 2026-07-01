// arena3d.js — realistic-ish 3D renderer for Couch Pack arena games (Blast, Territory)
// Renders on the host screen only. Phones stay 2D controllers.
// Exposes window.Arena3D with create(), and per-game update helpers.

(function () {
  if (!window.THREE) { console.warn('Three.js not loaded'); return; }

  // Shared helpers ---------------------------------------------------------
  function makeRenderer(canvas, w, h) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    return renderer;
  }

  function makeLights(scene, cols, rows) {
    // warm key light casting shadows from above-front
    const key = new THREE.DirectionalLight(0xfff2e0, 1.5);
    key.position.set(cols * 0.35, Math.max(cols, rows) * 0.9, rows * 0.65);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const span = Math.max(cols, rows);
    key.shadow.camera.left = -span; key.shadow.camera.right = span;
    key.shadow.camera.top = span; key.shadow.camera.bottom = -span;
    key.shadow.camera.near = 1; key.shadow.camera.far = span * 4;
    key.shadow.bias = -0.0008;
    scene.add(key);

    // cool fill so shadows aren't pure black
    const fill = new THREE.DirectionalLight(0x6688cc, 0.4);
    fill.position.set(-cols * 0.4, rows * 0.6, -rows * 0.4);
    scene.add(fill);

    // ambient base
    scene.add(new THREE.AmbientLight(0x404858, 0.6));

    // subtle hemisphere for natural sky/ground bounce
    const hemi = new THREE.HemisphereLight(0x9fb8ff, 0x2a2218, 0.5);
    scene.add(hemi);
  }

  function gridToWorld(x, y, cols, rows) {
    // center the grid at origin; x→world x, y(grid row)→world z
    return { x: x - (cols - 1) / 2, z: y - (rows - 1) / 2 };
  }

  // ── BLAST 3D ───────────────────────────────────────────────────────────
  function createBlast(canvas, cols, rows, w, h) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e16);
    scene.fog = new THREE.Fog(0x0a0e16, Math.max(cols, rows) * 1.6, Math.max(cols, rows) * 3.2);

    const camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 200);
    // angled top-down view looking at the arena
    camera.position.set(0, Math.max(cols, rows) * 0.92, rows * 0.92);
    camera.lookAt(0, 0, 0);

    const renderer = makeRenderer(canvas, w, h);
    makeLights(scene, cols, rows);

    // Materials (shared)
    const matFloorA = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.95, metalness: 0.0 });
    const matFloorB = new THREE.MeshStandardMaterial({ color: 0x276b2b, roughness: 0.95, metalness: 0.0 });
    const matHard = new THREE.MeshStandardMaterial({ color: 0x5a6470, roughness: 0.4, metalness: 0.6 });
    const matSoft = new THREE.MeshStandardMaterial({ color: 0xb5651d, roughness: 0.8, metalness: 0.05 });

    // Floor tiles (checkerboard) on y=0
    const floorGeo = new THREE.BoxGeometry(1, 0.2, 1);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const w2 = gridToWorld(x, y, cols, rows);
        const tile = new THREE.Mesh(floorGeo, (x + y) % 2 === 0 ? matFloorA : matFloorB);
        tile.position.set(w2.x, -0.1, w2.z);
        tile.receiveShadow = true;
        scene.add(tile);
      }
    }

    // Block meshes managed by grid key
    const blockGeo = new THREE.BoxGeometry(0.96, 1, 0.96);
    const blocks = {}; // "x,y" -> mesh
    function setBlock(x, y, type) {
      const k = x + ',' + y;
      if (blocks[k]) { scene.remove(blocks[k]); delete blocks[k]; }
      if (type === 1 || type === 2) {
        const mesh = new THREE.Mesh(blockGeo, type === 1 ? matHard : matSoft);
        const w2 = gridToWorld(x, y, cols, rows);
        mesh.position.set(w2.x, 0.5, w2.z);
        mesh.castShadow = true; mesh.receiveShadow = true;
        scene.add(mesh);
        blocks[k] = mesh;
      }
    }

    // Player meshes
    const playerMeshes = {}; // id -> group
    function makePlayer(color) {
      const group = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.35, metalness: 0.2 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.36, 24, 18), bodyMat);
      body.position.y = 0.42; body.scale.y = 1.15;
      body.castShadow = true;
      group.add(body);
      // white eyes
      const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
      const pupMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
      const eL = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 12), eyeMat);
      const eR = eL.clone();
      eL.position.set(-0.13, 0.6, 0.28); eR.position.set(0.13, 0.6, 0.28);
      const pL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), pupMat);
      const pR = pL.clone();
      pL.position.set(-0.13, 0.6, 0.36); pR.position.set(0.13, 0.6, 0.36);
      group.add(eL, eR, pL, pR);
      group.userData.eyes = [eL, eR, pL, pR];
      return group;
    }

    // Bomb meshes
    const bombGeo = new THREE.SphereGeometry(0.34, 20, 16);
    const bombMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.3, metalness: 0.5 });
    const bombMeshes = []; // {mesh, x, y}

    // Powerup meshes
    const powerupMeshes = {}; // "x,y" -> mesh
    function powerupColor(type) { return type === 'bomb' ? 0xff4444 : type === 'range' ? 0xffcb2d : 0x5affa0; }

    // Explosion particle pools (simple expanding glow boxes)
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8c00, transparent: true, opacity: 0.85 });
    const activeFlames = []; // {mesh, born}

    // animation loop
    let raf = null;
    function render() {
      const t = performance.now();
      // bomb pulse
      bombMeshes.forEach(b => {
        const s = 1 + Math.sin(t / 90) * 0.12;
        b.mesh.scale.setScalar(s);
      });
      // flame fade
      for (let i = activeFlames.length - 1; i >= 0; i--) {
        const f = activeFlames[i];
        const age = (t - f.born) / 500;
        if (age >= 1) { scene.remove(f.mesh); activeFlames.splice(i, 1); continue; }
        f.mesh.scale.setScalar(1 + age * 0.4);
        f.mesh.material.opacity = 0.85 * (1 - age);
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(render);
    }
    render();

    return {
      type: 'blast',
      scene, camera, renderer,
      initGrid(grid) {
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) setBlock(x, y, grid[y][x]);
      },
      setBlock,
      breakBlock(x, y) { setBlock(x, y, 0); },
      updatePlayers(players) {
        const seen = new Set();
        players.forEach(p => {
          seen.add(p.id);
          let g = playerMeshes[p.id];
          if (!g) { g = makePlayer(p.color); scene.add(g); playerMeshes[p.id] = g; }
          g.visible = p.alive;
          const w2 = gridToWorld(p.x, p.y, cols, rows);
          // smooth lerp toward target
          g.position.x += (w2.x - g.position.x) * 0.4;
          g.position.z += (w2.z - g.position.z) * 0.4;
          // face direction
          const rot = { up: Math.PI, down: 0, left: -Math.PI/2, right: Math.PI/2 }[p.dir || 'down'];
          g.rotation.y += (rot - g.rotation.y) * 0.3;
        });
        Object.keys(playerMeshes).forEach(id => { if (!seen.has(id)) playerMeshes[id].visible = false; });
      },
      updateBombs(bombs) {
        // rebuild bomb meshes to match
        while (bombMeshes.length > bombs.length) { const b = bombMeshes.pop(); scene.remove(b.mesh); }
        bombs.forEach((bm, i) => {
          let entry = bombMeshes[i];
          if (!entry) { const mesh = new THREE.Mesh(bombGeo, bombMat); mesh.castShadow = true; scene.add(mesh); entry = { mesh }; bombMeshes[i] = entry; }
          const w2 = gridToWorld(bm.x, bm.y, cols, rows);
          entry.mesh.position.set(w2.x, 0.34, w2.z);
        });
      },
      updatePowerups(powerups) {
        const keys = Object.keys(powerups);
        // remove gone
        Object.keys(powerupMeshes).forEach(k => { if (!powerups[k]) { scene.remove(powerupMeshes[k]); delete powerupMeshes[k]; } });
        keys.forEach(k => {
          if (!powerupMeshes[k]) {
            const [x, y] = k.split(',').map(Number);
            const mat = new THREE.MeshStandardMaterial({ color: powerupColor(powerups[k]), emissive: powerupColor(powerups[k]), emissiveIntensity: 0.4, roughness: 0.2, metalness: 0.3 });
            const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), mat);
            const w2 = gridToWorld(x, y, cols, rows);
            mesh.position.set(w2.x, 0.4, w2.z);
            mesh.castShadow = true;
            scene.add(mesh);
            powerupMeshes[k] = mesh;
          }
          // spin
          powerupMeshes[k].rotation.y += 0.05;
          powerupMeshes[k].position.y = 0.4 + Math.sin(performance.now() / 300) * 0.08;
        });
      },
      updateFlames(flameKeys) {
        // draw flame cells as glowing boxes (recreated each tick is fine — small count)
        flameKeys.forEach(k => {
          const [x, y] = k.split(',').map(Number);
          // avoid stacking many for same cell within a frame
          const w2 = gridToWorld(x, y, cols, rows);
          const exists = activeFlames.some(f => Math.abs(f.mesh.position.x - w2.x) < 0.1 && Math.abs(f.mesh.position.z - w2.z) < 0.1 && (performance.now() - f.born) < 120);
          if (exists) return;
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), flameMat.clone());
          mesh.position.set(w2.x, 0.45, w2.z);
          scene.add(mesh);
          activeFlames.push({ mesh, born: performance.now() });
        });
      },
      explodeBurst(cells) {
        // brighter pop at explosion centre cells
        cells.forEach(c => {
          const w2 = gridToWorld(c.x, c.y, cols, rows);
          const mat = new THREE.MeshBasicMaterial({ color: 0xfff2a0, transparent: true, opacity: 0.95 });
          const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 12), mat);
          mesh.position.set(w2.x, 0.45, w2.z);
          scene.add(mesh);
          activeFlames.push({ mesh, born: performance.now() });
        });
      },
      resize(nw, nh) { renderer.setSize(nw, nh, false); camera.aspect = nw / nh; camera.updateProjectionMatrix(); },
      dispose() { if (raf) cancelAnimationFrame(raf); renderer.dispose(); }
    };
  }

  // ── TERRITORY 3D ───────────────────────────────────────────────────────
  function createTerritory(canvas, cols, rows, w, h, playerColors) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070a10);
    const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 300);
    camera.position.set(0, Math.max(cols, rows) * 0.78, rows * 0.62);
    camera.lookAt(0, 0, 0);
    const renderer = makeRenderer(canvas, w, h);
    makeLights(scene, cols, rows);

    // ground plane
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(cols, 0.4, rows),
      new THREE.MeshStandardMaterial({ color: 0x111722, roughness: 0.9 })
    );
    ground.position.y = -0.2; ground.receiveShadow = true;
    scene.add(ground);

    // territory cells as thin colored tiles; we update colors per cell
    const cellGeo = new THREE.BoxGeometry(0.98, 0.12, 0.98);
    const cells = []; // index -> mesh
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x1a2230, roughness: 0.8 });
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const mesh = new THREE.Mesh(cellGeo, baseMat.clone());
        mesh.position.set(x - (cols - 1) / 2, 0.06, y - (rows - 1) / 2);
        mesh.receiveShadow = true;
        scene.add(mesh);
        cells.push(mesh);
      }
    }

    const playerMeshes = {};
    function makeBlob(color) {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 16),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.3, metalness: 0.3, emissive: new THREE.Color(color), emissiveIntensity: 0.15 }));
      m.position.y = 0.4; m.castShadow = true;
      g.add(m);
      return g;
    }

    let raf = null;
    function render() { renderer.render(scene, camera); raf = requestAnimationFrame(render); }
    render();

    return {
      type: 'territory',
      scene, camera, renderer,
      updateGrid(grid) {
        for (let i = 0; i < cells.length; i++) {
          const owner = grid[i];
          const col = owner === -1 ? 0x1a2230 : new THREE.Color(playerColors[owner] || '#444').getHex();
          cells[i].material.color.setHex(col);
          cells[i].material.emissive.setHex(owner === -1 ? 0x000000 : col);
          cells[i].material.emissiveIntensity = owner === -1 ? 0 : 0.12;
        }
      },
      updatePlayers(players) {
        players.forEach(p => {
          let g = playerMeshes[p.id];
          if (!g) { g = makeBlob(p.color); scene.add(g); playerMeshes[p.id] = g; }
          g.visible = p.alive;
          const tx = p.x - (cols - 1) / 2, tz = p.y - (rows - 1) / 2;
          g.position.x += (tx - g.position.x) * 0.5;
          g.position.z += (tz - g.position.z) * 0.5;
        });
      },
      resize(nw, nh) { renderer.setSize(nw, nh, false); camera.aspect = nw / nh; camera.updateProjectionMatrix(); },
      dispose() { if (raf) cancelAnimationFrame(raf); renderer.dispose(); }
    };
  }

  window.Arena3D = {
    available: true,
    createBlast,
    createTerritory
  };
})();
