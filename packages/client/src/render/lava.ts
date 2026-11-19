import * as THREE from "three";

/** Scrolling emissive lava with subtle bubbling (A.8). Cheap value-noise FBM, mobile friendly. */
export function createLava(): { mesh: THREE.Mesh; update: (timeSec: number) => void } {
  const uniforms = { uTime: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      uniform float uTime;
      varying vec3 vWorld;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0; float a = 0.5;
        for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
        return v;
      }
      void main() {
        vec2 p = vWorld.xz * 0.35;
        float t = uTime * 0.12;
        float n = fbm(p + vec2(t, -t * 0.7) + fbm(p * 1.7 - t) * 0.8);
        float bubbles = smoothstep(0.78, 0.92, noise(p * 3.0 + vec2(0.0, uTime * 0.25)));
        vec3 deep = vec3(0.45, 0.04, 0.02);
        vec3 hot = vec3(1.0, 0.35, 0.03);
        vec3 white = vec3(1.0, 0.85, 0.35);
        vec3 col = mix(deep, hot, smoothstep(0.25, 0.75, n));
        col = mix(col, white, smoothstep(0.72, 0.95, n) * 0.8 + bubbles * 0.6);
        // Darken toward the crater wall so the arena reads as the hot center.
        float d = length(vWorld.xz);
        col *= mix(1.0, 0.45, smoothstep(9.0, 22.0, d));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(70, 70, 1, 1), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.7;
  return { mesh, update: (t) => (uniforms.uTime.value = t) };
}
