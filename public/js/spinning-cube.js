import * as THREE from 'three';

/**
 * Renders a lightweight, interactive spinning Minecraft voxel cube inside a container element.
 * Supported block types: grass, diamond, tnt, gold, redstone, obsidian, wood, bookshelf, emerald.
 */

const BLOCK_COLORS = {
  grass: {
    top: 0x5b8731,
    side: 0x866043,
    bottom: 0x5b3b1c,
  },
  diamond: 0x4dedf4,
  tnt: {
    top: 0xa83232,
    side: 0xd92626,
    bottom: 0xa83232,
  },
  gold: 0xf5b942,
  redstone: 0xe53e3e,
  obsidian: 0x1f142b,
  wood: {
    top: 0x8d6c42,
    side: 0x6b5030,
    bottom: 0x8d6c42,
  },
  bookshelf: 0x866043,
  emerald: 0x2ecc71,
};

function createBlockMaterials(blockType) {
  const type = blockType || 'grass';
  const cfg = BLOCK_COLORS[type] || BLOCK_COLORS.grass;

  if (typeof cfg === 'number') {
    // Monolithic colored block
    return new THREE.MeshLambertMaterial({
      color: cfg,
      flatShading: true,
    });
  }

  // Multi-faced block (e.g. grass with green top and dirt sides)
  const sideMat = new THREE.MeshLambertMaterial({ color: cfg.side, flatShading: true });
  const topMat = new THREE.MeshLambertMaterial({ color: cfg.top, flatShading: true });
  const bottomMat = new THREE.MeshLambertMaterial({ color: cfg.bottom, flatShading: true });

  // Box faces order: right, left, top, bottom, front, back
  return [sideMat, sideMat, topMat, bottomMat, sideMat, sideMat];
}

export function renderSpinningCube(container, blockType = 'diamond', options = {}) {
  if (!container) return null;

  // Clear existing content in container
  container.replaceChildren();

  const width = container.clientWidth || 240;
  const height = container.clientHeight || 240;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
  camera.position.set(2.4, 2.0, 3.2);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xfffaed, 1.2);
  dirLight.position.set(4, 6, 5);
  scene.add(dirLight);

  const dirLight2 = new THREE.DirectionalLight(0x90b0e0, 0.4);
  dirLight2.position.set(-4, -2, -3);
  scene.add(dirLight2);

  // Cube Geometry & Material
  const geometry = new THREE.BoxGeometry(1.2, 1.2, 1.2);
  let materials = createBlockMaterials(blockType);
  const cube = new THREE.Mesh(geometry, materials);
  scene.add(cube);

  // Interactive mouse drag rotation
  let isDragging = false;
  let prevMousePos = { x: 0, y: 0 };

  const dom = renderer.domElement;
  dom.style.cursor = 'grab';

  dom.addEventListener('mousedown', (e) => {
    isDragging = true;
    prevMousePos = { x: e.clientX, y: e.clientY };
    dom.style.cursor = 'grabbing';
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
    dom.style.cursor = 'grab';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const deltaX = e.clientX - prevMousePos.x;
    const deltaY = e.clientY - prevMousePos.y;
    cube.rotation.y += deltaX * 0.015;
    cube.rotation.x += deltaY * 0.015;
    prevMousePos = { x: e.clientX, y: e.clientY };
  });

  let animationFrameId;
  const clock = new THREE.Clock();

  function animate() {
    animationFrameId = requestAnimationFrame(animate);
    const elapsedTime = clock.getElapsedTime();

    if (!isDragging) {
      cube.rotation.y += 0.012;
      cube.position.y = Math.sin(elapsedTime * 2.0) * 0.08;
    }

    renderer.render(scene, camera);
  }

  animate();

  return {
    updateBlockType(newType) {
      cube.material = createBlockMaterials(newType);
    },
    destroy() {
      cancelAnimationFrame(animationFrameId);
      geometry.dispose();
      if (Array.isArray(materials)) {
        materials.forEach(m => m.dispose());
      } else if (materials.dispose) {
        materials.dispose();
      }
      renderer.dispose();
      if (dom.parentNode) {
        dom.parentNode.removeChild(dom);
      }
    },
  };
}
