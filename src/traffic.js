// City traffic: CC0 Quaternius vehicles cruising the circuit in both lanes,
// wheels spinning, each with a soft blob shadow. The player weaves past them.
import * as THREE from 'three';
import { frameAt } from './track.js';
import { makeGLTFLoader, rigWheels } from './car.js';
import { makeContactShadowTexture } from './textures.js';
import { mulberry32 } from './textures.js';

const MODELS = [
  'assets/traffic/taxi.glb',
  'assets/traffic/sedan1.glb',
  'assets/traffic/sedan2.glb',
  'assets/traffic/suv.glb',
  'assets/traffic/cop.glb',
  'assets/traffic/sports1.glb',
  'assets/traffic/sports2.glb',
];
const COUNT = 10;
const TRAFFIC_LENGTH = 4.1;

export function buildTraffic(scene, curve, length) {
  const rng = mulberry32(808);
  const cars = []; // {group, s, v, lane, rig}
  const shadowMat = new THREE.MeshBasicMaterial({
    map: makeContactShadowTexture(), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, opacity: 0.85,
  });
  const shadowGeo = new THREE.PlaneGeometry(2.4, 4.6);
  shadowGeo.rotateX(-Math.PI / 2);

  const loader = makeGLTFLoader();
  MODELS.forEach((path, mi) => {
    loader.load(path, (gltf) => {
      for (let k = 0; k < 2; k++) {
        if (cars.length >= COUNT) return;
        const model = gltf.scene.clone(true);
        const wheelRig = rigWheels(model);
        model.rotation.y = wheelRig.forwardSign < 0 ? Math.PI : 0;

        const holder = new THREE.Group();
        holder.add(model);
        const box = new THREE.Box3().setFromObject(holder);
        const size = box.getSize(new THREE.Vector3());
        const scale = TRAFFIC_LENGTH / Math.max(size.x, size.z);
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
            mats.forEach((m) => { if (m.isMeshStandardMaterial) m.envMapIntensity = 0.45; });
          }
        });

        const group = new THREE.Group();
        group.add(holder);
        const blob = new THREE.Mesh(shadowGeo, shadowMat);
        blob.position.y = 0.06;
        blob.renderOrder = 2;
        group.add(blob);
        scene.add(group);

        const oncoming = rng() < 0.45; // left lane meets the player head-on
        cars.push({
          group,
          s: (cars.length / COUNT) * length + rng() * 60,
          v: (34 + rng() * 26) / 3.6, // 34–60 km/h city traffic
          lane: oncoming ? -2.7 : 2.7,
          dir: oncoming ? -1 : 1,
          rig: { ...wheelRig, radius: wheelRig.radius * scale },
        });
      }
    });
  });

  return {
    cars,
    update(dt) {
      for (const c of cars) {
        c.s = ((c.s + c.dir * c.v * dt) % length + length) % length;
        const { p, t, r } = frameAt(curve, length, c.s);
        c.group.position.set(p.x + r.x * c.lane, p.y + 0.02, p.z + r.z * c.lane);
        c.group.rotation.y = Math.atan2(c.dir * t.x, c.dir * t.z);
        const spin = (c.v * dt) / c.rig.radius * c.rig.forwardSign;
        for (const w of c.rig.spinNodes) w.rotation.x += spin;
      }
    },
  };
}
