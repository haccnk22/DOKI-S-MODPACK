import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * MCIntroduce 3D Voxel Minecraft Scene
 * - Built with Three.js (served locally from /node_modules/three)
 * - Optimized with InstancedMesh for extreme 60fps performance
 * - Flat-shaded low-poly Minecraft block aesthetic
 * - Interactive OrbitControls, day/night lighting cycle, floating animated items
 */

export function initVoxelScene(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Scene setup
  const scene = new THREE.Scene();
  const initialBg = new THREE.Color(0x78a7ff);
  scene.background = initialBg;
  scene.fog = new THREE.FogExp2(0x78a7ff, 0.025);

  // Camera setup
  const width = container.clientWidth || 800;
  const height = container.clientHeight || 450;
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(16, 14, 18);

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // OrbitControls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.8;
  controls.minDistance = 8;
  controls.maxDistance = 35;
  controls.maxPolarAngle = Math.PI / 2 - 0.02; // Prevent camera from going beneath the terrain
  controls.target.set(0, 2, 0);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(0xfffaed, 1.2);
  sunLight.position.set(20, 25, 15);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 1024;
  sunLight.shadow.mapSize.height = 1024;
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far = 60;
  const d = 16;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  scene.add(sunLight);

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.35);
  scene.add(hemiLight);

  // Sun and Moon visual voxel meshes
  const sunGeo = new THREE.BoxGeometry(2, 2, 0.5);
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xffea75 });
  const sunMesh = new THREE.Mesh(sunGeo, sunMat);
  scene.add(sunMesh);

  const moonGeo = new THREE.BoxGeometry(1.6, 1.6, 0.5);
  const moonMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e8 });
  const moonMesh = new THREE.Mesh(moonGeo, moonMat);
  scene.add(moonMesh);

  // Block definitions & colors
  const BLOCK_COLORS = {
    grass: 0x5b8731,
    dirt: 0x866043,
    wood: 0x6b5030,
    leaves: 0x34581e,
    stone: 0x737373,
    water: 0x2e6f9e,
    sand: 0xd6b777,
    diamond: 0x4dedf4,
    gold: 0xf5b942,
    redstone: 0xd92626,
    bedrock: 0x2a2a2a,
  };

  const blockGeometry = new THREE.BoxGeometry(1, 1, 1);

  // Materials with authentic flat shading
  const materials = {
    grass: new THREE.MeshLambertMaterial({ color: BLOCK_COLORS.grass, flatShading: true }),
    dirt: new THREE.MeshLambertMaterial({ color: BLOCK_COLORS.dirt, flatShading: true }),
    wood: new THREE.MeshLambertMaterial({ color: BLOCK_COLORS.wood, flatShading: true }),
    leaves: new THREE.MeshLambertMaterial({ color: BLOCK_COLORS.leaves, flatShading: true }),
    stone: new THREE.MeshLambertMaterial({ color: BLOCK_COLORS.stone, flatShading: true }),
    water: new THREE.MeshLambertMaterial({ color: BLOCK_COLORS.water, transparent: true, opacity: 0.8, flatShading: true }),
    sand: new THREE.MeshLambertMaterial({ color: BLOCK_COLORS.sand, flatShading: true }),
    diamond: new THREE.MeshLambertMaterial({ color: BLOCK_COLORS.diamond, flatShading: true }),
    gold: new THREE.MeshLambertMaterial({ color: BLOCK_COLORS.gold, flatShading: true }),
    redstone: new THREE.MeshLambertMaterial({ color: BLOCK_COLORS.redstone, flatShading: true }),
    bedrock: new THREE.MeshLambertMaterial({ color: BLOCK_COLORS.bedrock, flatShading: true }),
  };

  // Build Voxel World Map
  const blockPositions = {
    grass: [],
    dirt: [],
    wood: [],
    leaves: [],
    stone: [],
    water: [],
    sand: [],
    diamond: [],
    gold: [],
    redstone: [],
    bedrock: [],
  };

  const GRID_SIZE = 14;
  const HALF_GRID = Math.floor(GRID_SIZE / 2);

  // Generate terrain
  for (let x = -HALF_GRID; x < HALF_GRID; x++) {
    for (let z = -HALF_GRID; z < HALF_GRID; z++) {
      // Distance from center
      const distFromCenter = Math.sqrt(x * x + z * z);
      
      // Bedrock layer
      blockPositions.bedrock.push(new THREE.Vector3(x, -1, z));

      // Water pond in corner (x < -2 and z < -2)
      const isWater = (x < -2 && z < -2 && distFromCenter > 3.5);
      
      // Hill on opposite side (x > 1 and z > 1)
      const isHill = (x > 1 && z > 1);
      const isHighHill = (x > 3 && z > 3);

      let surfaceY = 0;
      if (isWater) {
        surfaceY = 0;
      } else if (isHighHill) {
        surfaceY = 3;
      } else if (isHill) {
        surfaceY = 2;
      } else {
        surfaceY = 1;
      }

      // Fill vertical column
      for (let y = 0; y <= surfaceY; y++) {
        const pos = new THREE.Vector3(x, y, z);
        if (isWater) {
          if (y === 0) {
            blockPositions.sand.push(pos);
          } else if (y === 1) {
            blockPositions.water.push(pos);
          }
        } else if (y === surfaceY) {
          // Top block is grass
          blockPositions.grass.push(pos);
        } else if (y === surfaceY - 1) {
          // One block below is dirt
          blockPositions.dirt.push(pos);
        } else {
          // Deep blocks are stone, with occasional ore
          if (x === 4 && z === 4 && y === 1) {
            blockPositions.diamond.push(pos);
          } else if (x === 3 && z === 2 && y === 1) {
            blockPositions.gold.push(pos);
          } else if (x === 2 && z === 3 && y === 0) {
            blockPositions.redstone.push(pos);
          } else {
            blockPositions.stone.push(pos);
          }
        }
      }

      // Add sand beaches adjacent to water
      if (!isWater && ((x === -2 && z < -2) || (z === -2 && x < -2))) {
        blockPositions.sand.push(new THREE.Vector3(x, 1, z));
      }
    }
  }

  // Add Oak Tree at position (-1, surface, 2)
  const treeBaseX = -1;
  const treeBaseZ = 2;
  const treeBaseY = 1;

  // Trunk (4 blocks high)
  for (let ty = 1; ty <= 4; ty++) {
    blockPositions.wood.push(new THREE.Vector3(treeBaseX, treeBaseY + ty, treeBaseZ));
  }

  // Leaves Canopy
  // Layer 1: 5x5 around trunk height 3 and 4
  for (let lx = -2; lx <= 2; lx++) {
    for (let lz = -2; lz <= 2; lz++) {
      if (Math.abs(lx) === 2 && Math.abs(lz) === 2) continue; // Cut corners
      if (lx === 0 && lz === 0) continue; // Trunk
      blockPositions.leaves.push(new THREE.Vector3(treeBaseX + lx, treeBaseY + 3, treeBaseZ + lz));
      blockPositions.leaves.push(new THREE.Vector3(treeBaseX + lx, treeBaseY + 4, treeBaseZ + lz));
    }
  }

  // Layer 2: 3x3 around trunk height 5
  for (let lx = -1; lx <= 1; lx++) {
    for (let lz = -1; lz <= 1; lz++) {
      blockPositions.leaves.push(new THREE.Vector3(treeBaseX + lx, treeBaseY + 5, treeBaseZ + lz));
    }
  }

  // Top cap (plus shape at height 6)
  blockPositions.leaves.push(new THREE.Vector3(treeBaseX, treeBaseY + 6, treeBaseZ));
  blockPositions.leaves.push(new THREE.Vector3(treeBaseX + 1, treeBaseY + 6, treeBaseZ));
  blockPositions.leaves.push(new THREE.Vector3(treeBaseX - 1, treeBaseY + 6, treeBaseZ));
  blockPositions.leaves.push(new THREE.Vector3(treeBaseX, treeBaseY + 6, treeBaseZ + 1));
  blockPositions.leaves.push(new THREE.Vector3(treeBaseX, treeBaseY + 6, treeBaseZ - 1));

  // Small second tree (Birch/Spruce style at x: 2, z: -3)
  const tree2X = 2;
  const tree2Z = -3;
  const tree2Y = 1;
  for (let ty = 1; ty <= 3; ty++) {
    blockPositions.wood.push(new THREE.Vector3(tree2X, tree2Y + ty, tree2Z));
  }
  for (let lx = -1; lx <= 1; lx++) {
    for (let lz = -1; lz <= 1; lz++) {
      blockPositions.leaves.push(new THREE.Vector3(tree2X + lx, tree2Y + 3, tree2Z + lz));
      blockPositions.leaves.push(new THREE.Vector3(tree2X + lx, tree2Y + 4, tree2Z + lz));
    }
  }
  blockPositions.leaves.push(new THREE.Vector3(tree2X, tree2Y + 5, tree2Z));

  // Create Instanced Meshes for each block type
  const dummy = new THREE.Object3D();
  const instancedMeshes = [];

  for (const [key, positions] of Object.entries(blockPositions)) {
    if (positions.length === 0) continue;
    const mesh = new THREE.InstancedMesh(blockGeometry, materials[key], positions.length);
    mesh.castShadow = (key !== 'water');
    mesh.receiveShadow = true;

    for (let i = 0; i < positions.length; i++) {
      dummy.position.copy(positions[i]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    instancedMeshes.push(mesh);
  }

  // Floating Animated Items:
  // 1. Spinning Diamond Block on the mountain peak
  const floatingDiamondGroup = new THREE.Group();
  const floatDiamondMesh = new THREE.Mesh(blockGeometry, materials.diamond);
  floatDiamondMesh.scale.set(0.65, 0.65, 0.65);
  floatingDiamondGroup.position.set(4, 4.8, 4);
  floatingDiamondGroup.add(floatDiamondMesh);
  scene.add(floatingDiamondGroup);

  // 2. Spinning Gold Cube floating near the tree
  const floatingGoldGroup = new THREE.Group();
  const floatGoldMesh = new THREE.Mesh(blockGeometry, materials.gold);
  floatGoldMesh.scale.set(0.5, 0.5, 0.5);
  floatingGoldGroup.position.set(-1, 8.5, 2);
  floatingGoldGroup.add(floatGoldMesh);
  scene.add(floatingGoldGroup);

  // Floating Low-Poly Voxel Clouds
  const cloudGroup = new THREE.Group();
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  
  function createCloud(cx, cy, cz) {
    const cloud = new THREE.Group();
    const cloudBlocks = [
      [0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
      [1, 0, 1], [-1, 0, 1], [2, 0, 0], [0, 0, 2], [1, 0, -1]
    ];
    cloudBlocks.forEach(([bx, by, bz]) => {
      const cMesh = new THREE.Mesh(blockGeometry, cloudMat);
      cMesh.position.set(bx, by, bz);
      cloud.add(cMesh);
    });
    cloud.position.set(cx, cy, cz);
    return cloud;
  }

  const clouds = [
    createCloud(-15, 12, -8),
    createCloud(8, 14, -12),
    createCloud(12, 13, 10),
  ];
  clouds.forEach(c => cloudGroup.add(c));
  scene.add(cloudGroup);

  // Day / Night Cycle state
  let timeOfDay = 0.25; // 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset
  let autoCycle = true;
  const cycleSpeed = 0.02; // cycle speed per second

  const skyColors = {
    day: new THREE.Color(0x78a7ff),
    sunset: new THREE.Color(0xd97543),
    night: new THREE.Color(0x0a1020),
  };

  const sunColors = {
    day: new THREE.Color(0xfffaed),
    sunset: new THREE.Color(0xff8844),
    night: new THREE.Color(0x304575),
  };

  function updateLighting(delta) {
    if (autoCycle) {
      timeOfDay = (timeOfDay + delta * cycleSpeed) % 1.0;
    }

    const angle = timeOfDay * Math.PI * 2;
    const orbitRadius = 32;

    // Sun position & orientation
    const sunX = Math.cos(angle) * orbitRadius;
    const sunY = Math.sin(angle) * orbitRadius;
    const sunZ = 8;
    sunLight.position.set(sunX, sunY, sunZ);
    sunMesh.position.set(sunX * 0.9, sunY * 0.9, sunZ * 0.9);
    sunMesh.lookAt(0, 0, 0);

    // Moon position (opposite to sun)
    moonMesh.position.set(-sunX * 0.9, -sunY * 0.9, -sunZ * 0.9);
    moonMesh.lookAt(0, 0, 0);

    // Day/Night sky blending
    const isDay = sunY > 0;
    const altitudeRatio = Math.max(0, Math.min(1, (sunY + 5) / 25)); // 0 when low, 1 when high

    let skyColor, sunColor, ambientIntensity;

    if (altitudeRatio > 0.4) {
      // Full day
      skyColor = skyColors.day;
      sunColor = sunColors.day;
      ambientIntensity = 0.65;
      sunLight.intensity = 1.2;
    } else if (altitudeRatio > 0.05) {
      // Golden hour / Sunset
      const t = (altitudeRatio - 0.05) / 0.35;
      skyColor = new THREE.Color().lerpColors(skyColors.sunset, skyColors.day, t);
      sunColor = new THREE.Color().lerpColors(sunColors.sunset, sunColors.day, t);
      ambientIntensity = 0.45;
      sunLight.intensity = 0.9;
    } else {
      // Night
      skyColor = skyColors.night;
      sunColor = sunColors.night;
      ambientIntensity = 0.22;
      sunLight.intensity = 0.3;
    }

    scene.background = skyColor;
    if (scene.fog) {
      scene.fog.color = skyColor;
    }
    sunLight.color = sunColor;
    ambientLight.intensity = ambientIntensity;
  }

  // Animation Loop
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();

    // OrbitControls update
    controls.update();

    // Floating diamond animation
    floatingDiamondGroup.rotation.y += 0.02;
    floatingDiamondGroup.rotation.x = Math.sin(elapsedTime * 1.5) * 0.15;
    floatingDiamondGroup.position.y = 4.8 + Math.sin(elapsedTime * 2.5) * 0.25;

    // Floating gold block animation
    floatingGoldGroup.rotation.y -= 0.025;
    floatingGoldGroup.position.y = 8.5 + Math.sin(elapsedTime * 2.0 + 1) * 0.2;

    // Cloud drift
    clouds.forEach((cloud, index) => {
      cloud.position.x += delta * (0.4 + index * 0.15);
      if (cloud.position.x > 25) {
        cloud.position.x = -25;
      }
    });

    // Day/Night cycle
    updateLighting(delta);

    renderer.render(scene, camera);
  }

  animate();

  // Resize handler
  function onWindowResize() {
    const newWidth = container.clientWidth;
    const newHeight = container.clientHeight;
    if (newWidth === 0 || newHeight === 0) return;
    camera.aspect = newWidth / newHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(newWidth, newHeight);
  }

  window.addEventListener('resize', onWindowResize);

  // Expose control API for the UI buttons
  return {
    setTimeOfDay(val) {
      autoCycle = false;
      timeOfDay = val;
    },
    setAutoCycle(enabled) {
      autoCycle = enabled;
    },
    resetCamera() {
      camera.position.set(16, 14, 18);
      controls.target.set(0, 2, 0);
      controls.update();
    },
    toggleAutoRotate() {
      controls.autoRotate = !controls.autoRotate;
      return controls.autoRotate;
    }
  };
}
