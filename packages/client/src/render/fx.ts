import * as THREE from "three";

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  grow: number;
}

/**
 * Tiny pooled particle system for poofs (elimination), sparks (bonk), sizzle.
 * Cartoony, not graphic (A.2).
 */
export function createFx(scene: THREE.Scene) {
  const pool: Particle[] = [];
  const active: Particle[] = [];
  const geo = new THREE.IcosahedronGeometry(1, 0);

  function spawn(color: string, pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, grow: number, additive: boolean) {
    let p = pool.pop();
    if (!p) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
      p = { mesh: new THREE.Mesh(geo, mat), vel: new THREE.Vector3(), life: 0, maxLife: 1, grow: 0 };
    }
    const mat = p.mesh.material as THREE.MeshBasicMaterial;
    mat.color.set(color);
    mat.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    mat.opacity = 1;
    p.mesh.position.copy(pos);
    p.mesh.scale.setScalar(size);
    p.vel.copy(vel);
    p.life = p.maxLife = life;
    p.grow = grow;
    scene.add(p.mesh);
    active.push(p);
  }

  const tmp = new THREE.Vector3();
  const v = new THREE.Vector3();

  return {
    /** Elimination: smoke puff + embers. */
    poof(at: THREE.Vector3) {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        v.set(Math.cos(a) * 1.2, 1.5 + Math.random(), Math.sin(a) * 1.2);
        spawn("#6b6461", tmp.copy(at).setY(-0.4), v, 0.9, 0.25, 0.9, false);
      }
      for (let i = 0; i < 14; i++) {
        v.set((Math.random() - 0.5) * 4, 3 + Math.random() * 3, (Math.random() - 0.5) * 4);
        spawn("#ffb347", tmp.copy(at).setY(-0.3), v, 0.7, 0.07, -0.05, true);
      }
    },
    /** Shove contact: a quick spark burst. */
    bonk(at: THREE.Vector3, strength: number) {
      const n = Math.min(10, 4 + Math.floor(strength));
      for (let i = 0; i < n; i++) {
        v.set((Math.random() - 0.5) * 5, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 5);
        spawn("#fff1b8", tmp.copy(at).setY(0.6), v, 0.3, 0.06, -0.1, true);
      }
    },
    update(dt: number) {
      for (let i = active.length - 1; i >= 0; i--) {
        const p = active[i]!;
        p.life -= dt;
        if (p.life <= 0) {
          scene.remove(p.mesh);
          active.splice(i, 1);
          pool.push(p);
          continue;
        }
        p.vel.y -= 6 * dt;
        p.mesh.position.addScaledVector(p.vel, dt);
        p.mesh.scale.addScalar(p.grow * dt);
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life / p.maxLife;
      }
    },
  };
}
