// The player car. A procedural placeholder drives the track out of the box;
// drop a free CC0 model at assets/car.glb (see README) and it takes over
// automatically. URL param ?carRot=90/180/270 fixes models with a different
// forward axis.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { makeContactShadowTexture } from './textures.js';

const CAR_LENGTH = 4.35; // meters, GLB models are scaled to this

function buildPlaceholder() {
  const car = new THREE.Group();

  const paint = new THREE.MeshPhysicalMaterial({
    color: 0x8c0e13, metalness: 0.1, roughness: 0.42,
    clearcoat: 0.55, clearcoatRoughness: 0.22, envMapIntensity: 0.45,
  });
  const darkTrim = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.6, metalness: 0.2 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0c1116, metalness: 0.1, roughness: 0.05, envMapIntensity: 1.4,
  });
  // the scene-wide envMapIntensity pass must not flatten the paint job
  paint.userData.keepEnv = true;
  glass.userData.keepEnv = true;

  // body: side silhouette extruded across the width, bevel rounds the edges
  const s = new THREE.Shape();
  s.moveTo(-2.15, 0.28);           // rear bumper bottom
  s.lineTo(-2.18, 0.62);           // tail
  s.lineTo(-1.95, 0.72);           // trunk lip
  s.lineTo(-1.15, 0.78);           // rear deck
  s.lineTo(-0.55, 1.18);           // rear window → roof
  s.lineTo(0.45, 1.20);            // roof
  s.lineTo(1.15, 0.78);            // windshield base
  s.lineTo(1.95, 0.68);            // hood
  s.lineTo(2.16, 0.55);            // nose
  s.lineTo(2.18, 0.30);            // front bumper
  s.lineTo(1.65, 0.22);
  s.lineTo(-1.7, 0.22);            // rocker panel
  s.closePath();
  const bodyGeo = new THREE.ExtrudeGeometry(s, {
    depth: 1.56, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.13, bevelSegments: 3,
  });
  bodyGeo.translate(0, 0, -0.78);
  bodyGeo.rotateY(-Math.PI / 2); // forward = +z
  const body = new THREE.Mesh(bodyGeo, paint);
  body.castShadow = true;
  car.add(body);

  // cabin glass: slightly smaller extrusion over the roof area
  const g = new THREE.Shape();
  g.moveTo(-0.62, 0.80);
  g.lineTo(-0.42, 1.14);
  g.lineTo(0.40, 1.16);
  g.lineTo(0.95, 0.80);
  g.closePath();
  const glassGeo = new THREE.ExtrudeGeometry(g, {
    depth: 1.34, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2,
  });
  glassGeo.translate(0, 0.02, -0.67);
  glassGeo.rotateY(-Math.PI / 2);
  car.add(new THREE.Mesh(glassGeo, glass));

  // spoiler
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.34), darkTrim);
  spoiler.position.set(0, 0.98, -2.0);
  spoiler.castShadow = true;
  car.add(spoiler);
  for (const sx of [-0.55, 0.55]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.24, 0.1), darkTrim);
    strut.position.set(sx, 0.85, -2.02);
    car.add(strut);
  }

  // lights: emissive so the tail lights bloom
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x380000, emissive: 0xc90f0f, emissiveIntensity: 1.1 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xd8dce0, emissive: 0xbfd0e2, emissiveIntensity: 0.5 });
  for (const sx of [-0.62, 0.62]) {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.11, 0.06), tailMat);
    tail.position.set(sx, 0.72, -2.26);
    car.add(tail);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.06), headMat);
    head.position.set(sx, 0.6, 2.28);
    car.add(head);
  }

  // wheels: cylinder tire + lighter hub, front pair steers
  const tireGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 18);
  tireGeo.rotateZ(Math.PI / 2); // axle along x
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.9 });
  const hubGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.27, 12);
  hubGeo.rotateZ(Math.PI / 2);
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.9 });
  const wheels = [], steerPivots = [];
  for (const [wx, wz] of [[-0.88, 1.38], [0.88, 1.38], [-0.88, -1.32], [0.88, -1.32]]) {
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(tireGeo, tireMat), new THREE.Mesh(hubGeo, hubMat));
    spin.children.forEach((m) => (m.castShadow = true));
    wheels.push(spin);
    if (wz > 0) {
      const pivot = new THREE.Group();
      pivot.position.set(wx, 0.34, wz);
      pivot.add(spin);
      steerPivots.push(pivot);
      car.add(pivot);
    } else {
      spin.position.set(wx, 0.34, wz);
      car.add(spin);
    }
  }

  return { group: car, wheels, steerPivots, wheelRadius: 0.34 };
}

export function createCar(scene) {
  const root = new THREE.Group();
  scene.add(root);

  let rig = buildPlaceholder();
  root.add(rig.group);

  // soft blob shadow under the car (in addition to the sun shadow)
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 5.1),
    new THREE.MeshBasicMaterial({
      map: makeContactShadowTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, opacity: 0.9,
    })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.renderOrder = 2;
  scene.add(blob);

  // try to replace the placeholder with a real model
  const params = new URLSearchParams(location.search);
  const extraYaw = (parseFloat(params.get('carRot') ?? '0') * Math.PI) / 180;
  new GLTFLoader().load('assets/car.glb', (gltf) => {
    const model = gltf.scene;
    model.rotation.y = extraYaw;
    const holder = new THREE.Group();
    holder.add(model);
    // normalize: longest horizontal axis = car length, wheels on the ground
    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3());
    const scale = CAR_LENGTH / Math.max(size.x, size.z);
    holder.scale.setScalar(scale);
    const box2 = new THREE.Box3().setFromObject(holder);
    const center = box2.getCenter(new THREE.Vector3());
    model.position.x -= center.x / scale;
    model.position.z -= center.z / scale;
    model.position.y -= box2.min.y / scale;
    holder.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { if (m.isMeshStandardMaterial) m.envMapIntensity = 1.0; });
      }
    });
    root.remove(rig.group);
    rig = { group: holder, wheels: [], steerPivots: [], wheelRadius: 0.34 };
    root.add(holder);
  }, undefined, () => { /* no assets/car.glb yet — placeholder keeps driving */ });

  return {
    root,
    // place the car on the track: p = position, t = tangent, roll = lean, steer = front wheel angle
    update(p, t, roll, steer, speed, dt) {
      root.position.copy(p);
      // Euler XYZ: the z component banks the car around its own forward axis.
      // Body rolls OUT of the corner (opposite of the camera's lean-in).
      root.rotation.set(0, Math.atan2(t.x, t.z), roll * 0.7);
      const spin = (speed * dt) / rig.wheelRadius;
      for (const w of rig.wheels) w.rotation.x += spin;
      for (const pv of rig.steerPivots) pv.rotation.y = steer;
      blob.position.set(p.x, 0.05, p.z);
      blob.rotation.z = -root.rotation.y;
    },
    setVisible(v) { root.visible = v; },
  };
}
