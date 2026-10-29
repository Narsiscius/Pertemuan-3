import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let camera, scene, renderer, orbit, dropZone;
const controllers = [];
const interactables = []; // daftar objek yang boleh berinteraksi
const raycaster = new THREE.Raycaster();
const tempMatrix = new THREE.Matrix4();
const tempVec = new THREE.Vector3();
const pointer = new THREE.Vector2();
const logBox = document.getElementById('log');
const lines = [];

// Pengaturan drop zone (pusat x, z dan ukuran sisi dalam meter)
const ZONE = { x: 0, z: -0.5, size: 0.9 };
const ZONE_IDLE = 0xffffff;
const ZONE_ACTIVE = 0x2ecc71;

// Log ke layar dan console, berguna sebagai bukti pengujian
function log(msg) {
  console.log(msg);
  lines.unshift(msg);
  lines.length = Math.min(lines.length, 5);
  logBox.textContent = lines.join(' | ');
}

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1f2a);
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 50);
  camera.position.set(0, 1.6, 2);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(2, 4, 2);
  scene.add(sun);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: 0x2e3447 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  scene.add(new THREE.GridHelper(10, 20, 0x555a6e, 0x3a3f52));

  buildDropZone();

  // Baris atas (tiga objek awal)
  addObject(new THREE.BoxGeometry(0.3, 0.3, 0.3), 0xe74c3c, -0.6, 1.2, -1);
  addObject(new THREE.SphereGeometry(0.18, 32, 16), 0x3498db, 0, 1.2, -1);
  addObject(new THREE.ConeGeometry(0.16, 0.35, 32), 0x2ecc71, 0.6, 1.2, -1);

  // Baris bawah (tiga objek baru dengan geometri berbeda)
  addObject(new THREE.TorusGeometry(0.15, 0.05, 16, 48), 0xf1c40f, -0.6, 0.8, -1);
  addObject(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 32), 0x9b59b6, 0, 0.8, -1);
  addObject(new THREE.OctahedronGeometry(0.18), 0xe67e22, 0.6, 0.8, -1);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true; // aktifkan WebXR
  document.body.appendChild(renderer.domElement);
  document.body.appendChild(VRButton.createButton(renderer));

  // Kontrol mouse untuk mode desktop (tidak aktif saat sesi XR)
  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.set(0, 1.2, -1);
  orbit.update();

  setupControllers();
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') resetScene(); // reset ekuivalen untuk desktop
  });
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.setAnimationLoop(render);
}

// Kotak transparan di lantai sebagai area drop
function buildDropZone() {
  const material = new THREE.MeshBasicMaterial({
    color: ZONE_IDLE,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide
  });
  dropZone = new THREE.Mesh(new THREE.PlaneGeometry(ZONE.size, ZONE.size), material);
  dropZone.rotation.x = -Math.PI / 2;
  dropZone.position.set(ZONE.x, 0.01, ZONE.z); // sedikit di atas lantai agar tidak z-fighting
  scene.add(dropZone);

  const border = new THREE.LineSegments(
    new THREE.EdgesGeometry(dropZone.geometry),
    new THREE.LineBasicMaterial({ color: 0xffffff })
  );
  dropZone.add(border);
}

// Apakah posisi dunia objek berada di dalam batas drop zone (sumbu X dan Z)
function isInDropZone(obj) {
  obj.getWorldPosition(tempVec);
  const half = ZONE.size / 2;
  return Math.abs(tempVec.x - ZONE.x) <= half && Math.abs(tempVec.z - ZONE.z) <= half;
}

function addObject(geometry, color, x, y, z) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color }));
  mesh.position.set(x, y, z);
  // Simpan kondisi awal untuk fitur reset
  mesh.userData.home = {
    position: mesh.position.clone(),
    quaternion: mesh.quaternion.clone(),
    scale: mesh.scale.clone(),
    color
  };
  scene.add(mesh);
  interactables.push(mesh);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function setupControllers() {
  const modelFactory = new XRControllerModelFactory();
  for (let i = 0; i < 2; i++) {
    const controller = renderer.xr.getController(i);
    controller.addEventListener('connected', (e) => {
      controller.userData.gamepad = e.data.gamepad; // untuk haptic dan thumbstick
      controller.add(buildRay());
      log('Controller ' + i + ' terhubung (' + e.data.handedness + ')');
    });
    controller.addEventListener('disconnected', () => controller.clear());
    controller.addEventListener('selectstart', onSelectStart);
    controller.addEventListener('selectend', onSelectEnd);
    controller.addEventListener('squeezestart', onSqueezeStart);
    scene.add(controller);
    controllers.push(controller);

    const grip = renderer.xr.getControllerGrip(i);
    grip.add(modelFactory.createControllerModel(grip));
    scene.add(grip);
  }
}

function buildRay() {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1)
  ]);
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffffff }));
  line.name = 'ray';
  line.scale.z = 5; // panjang sinar 5 meter
  return line;
}

// Menghitung objek yang terkena sinar dari sebuah controller
function getIntersections(controller) {
  tempMatrix.identity().extractRotation(controller.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
  return raycaster.intersectObjects(interactables, false);
}

// Getaran singkat pada controller (jika perangkat mendukung)
function pulse(controller, strength = 0.5, ms = 80) {
  const gp = controller.userData.gamepad;
  const actuator = gp && gp.hapticActuators && gp.hapticActuators[0];
  if (actuator && actuator.pulse) actuator.pulse(strength, ms);
}

// Trigger ditekan: genggam objek yang terkena sinar
function onSelectStart(event) {
  const controller = event.target;
  const hits = getIntersections(controller);
  if (hits.length > 0) {
    const obj = hits[0].object;
    controller.attach(obj); // objek menjadi anak controller
    controller.userData.selected = obj;
    pulse(controller);
    log('GRAB: ' + obj.geometry.type);
  }
}

// Trigger dilepas: kembalikan objek ke scene di posisi terakhirnya
function onSelectEnd(event) {
  const controller = event.target;
  const obj = controller.userData.selected;
  if (obj) {
    scene.attach(obj); // posisi dunia tetap terjaga
    controller.userData.selected = undefined;
    log('RELEASE: ' + obj.geometry.type);
    if (isInDropZone(obj)) {
      pulse(controller, 0.8, 120);
      log('DROP ZONE: ' + obj.geometry.type + ' masuk area');
    }
  }
}

// Grip ditekan: ganti warna objek yang disorot
function onSqueezeStart(event) {
  const controller = event.target;
  const hits = getIntersections(controller);
  if (hits.length > 0) {
    hits[0].object.material.color.setHex(Math.floor(Math.random() * 0xffffff));
    pulse(controller, 0.3, 50);
    log('SQUEEZE: warna diubah');
  }
}

// Kembalikan semua objek ke posisi, rotasi, skala, dan warna awal
function resetScene() {
  controllers.forEach((c) => {
    c.userData.selected = undefined; // lepaskan genggaman
  });
  interactables.forEach((obj) => {
    const home = obj.userData.home;
    if (obj.parent !== scene) scene.add(obj); // pastikan tidak lagi menempel di controller
    obj.position.copy(home.position);
    obj.quaternion.copy(home.quaternion);
    obj.scale.copy(home.scale);
    obj.material.color.setHex(home.color);
  });
  log('RESET: semua objek kembali ke posisi awal');
}

function render() {
  // Reset sorotan semua objek
  interactables.forEach((o) => o.material.emissive.setHex(0x000000));

  controllers.forEach((c) => {
    const gp = c.userData.gamepad;
    const held = c.userData.selected;

    // Tombol reset (gp.buttons[4]), hanya dipicu saat baru ditekan
    const resetDown = !!(gp && gp.buttons[4] && gp.buttons[4].pressed);
    if (resetDown && !c.userData.resetWasDown) resetScene();
    c.userData.resetWasDown = resetDown;

    if (c.userData.selected) {
      // Objek sedang digenggam: sorot, skala dengan thumbstick Y, rotasi dengan thumbstick X
      const obj = c.userData.selected;
      obj.material.emissive.setHex(0x222222);
      if (gp && gp.axes.length >= 4) {
        const x = gp.axes[2]; // sumbu X thumbstick
        const y = gp.axes[3]; // sumbu Y thumbstick
        if (Math.abs(x) > 0.15) {
          obj.rotateY(x * 0.05); // putar mengelilingi sumbu Y lokal objek
        }
        if (Math.abs(y) > 0.15) { // abaikan drift kecil
          obj.scale.multiplyScalar(1 - y * 0.02).clampScalar(0.3, 3);
        }
      }
    } else if (!held && c.children.length > 0) {
      // Controller sudah terhubung dan tidak memegang apa pun: cek hover
      const hits = getIntersections(c);
      if (hits.length > 0) hits[0].object.material.emissive.setHex(0x444444);
    }
  });

  // Warna drop zone: hijau selama ada objek (yang tidak sedang digenggam) di dalamnya
  const occupied = interactables.some((o) => o.parent === scene && isInDropZone(o));
  dropZone.material.color.setHex(occupied ? ZONE_ACTIVE : ZONE_IDLE);
  dropZone.material.opacity = occupied ? 0.5 : 0.35;

  if (!renderer.xr.isPresenting) orbit.update();
  renderer.render(scene, camera);
}

// Interaksi ekuivalen untuk mode desktop: klik mouse mengganti warna objek
function onPointerDown(e) {
  if (renderer.xr.isPresenting) return;
  pointer.set(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(interactables, false);
  if (hits.length > 0) {
    hits[0].object.material.color.setHex(Math.floor(Math.random() * 0xffffff));
    log('CLICK (desktop): warna diubah');
  }
}

init();