/**
 * Controls (F8, A.7): floating joystick (left half) + one skill button (right),
 * keyboard fallback (WASD / arrows + Space). Produces { dirX, dirZ, skill }.
 *
 * Camera looks from +z toward the origin, so screen-right = +x and screen-down = +z.
 */
export interface InputState {
  dirX: number;
  dirZ: number;
  skill: boolean;
}

const JOY_RADIUS = 56; // px of travel for full speed
const DEAD_ZONE = 0.12;

export interface SkillButtonState {
  label: string;
  /** 0 = ready, 1 = just used. */
  cooldownFrac: number;
  ready: boolean;
}

export interface Controls {
  setSkillState(s: SkillButtonState): void;
  read(): InputState;
  setEnabled(on: boolean): void;
  destroy(): void;
}

export function createControls(root: HTMLElement): Controls {
  const layer = document.createElement("div");
  layer.className = "controls";
  layer.innerHTML = `
    <div class="joy-zone"></div>
    <div class="joy-base"><div class="joy-knob"></div></div>
    <button class="skill-btn" aria-label="Skill"><span class="skill-label">SKILL</span></button>
  `;
  root.appendChild(layer);
  const zone = layer.querySelector<HTMLDivElement>(".joy-zone")!;
  const base = layer.querySelector<HTMLDivElement>(".joy-base")!;
  const knob = layer.querySelector<HTMLDivElement>(".joy-knob")!;
  const skillBtn = layer.querySelector<HTMLButtonElement>(".skill-btn")!;

  const skillLabel = skillBtn.querySelector<HTMLSpanElement>(".skill-label")!;
  let lastLabel = "SKILL";
  let lastFrac = -1;
  let lastReady = false;

  let enabled = true;
  let joyId: number | null = null;
  let ox = 0, oy = 0;
  let jx = 0, jy = 0;
  let skillTouch = false;
  const keys = new Set<string>();

  const showBase = (x: number, y: number) => {
    base.style.transform = `translate(${x}px, ${y}px)`;
    base.classList.add("active");
  };

  zone.addEventListener("pointerdown", (e) => {
    if (!enabled || joyId !== null) return;
    joyId = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    ox = e.clientX;
    oy = e.clientY;
    jx = jy = 0;
    showBase(ox, oy);
    knob.style.transform = "translate(-50%, -50%)";
  });
  zone.addEventListener("pointermove", (e) => {
    if (e.pointerId !== joyId) return;
    let dx = e.clientX - ox, dy = e.clientY - oy;
    const len = Math.hypot(dx, dy);
    // Floating: if the thumb drags past the rim, the base follows (feels better on phones).
    if (len > JOY_RADIUS) {
      const over = len - JOY_RADIUS;
      ox += (dx / len) * over;
      oy += (dy / len) * over;
      dx = e.clientX - ox;
      dy = e.clientY - oy;
      showBase(ox, oy);
    }
    jx = dx / JOY_RADIUS;
    jy = dy / JOY_RADIUS;
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  });
  const endJoy = (e: PointerEvent) => {
    if (e.pointerId !== joyId) return;
    joyId = null;
    jx = jy = 0;
    base.classList.remove("active");
  };
  zone.addEventListener("pointerup", endJoy);
  zone.addEventListener("pointercancel", endJoy);

  skillBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    skillTouch = true;
    skillBtn.classList.add("pressed");
  });
  const endSkill = () => {
    skillTouch = false;
    skillBtn.classList.remove("pressed");
  };
  skillBtn.addEventListener("pointerup", endSkill);
  skillBtn.addEventListener("pointercancel", endSkill);
  skillBtn.addEventListener("pointerleave", endSkill);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    keys.add(e.code);
    if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  const onBlur = () => keys.clear();
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  return {
    setSkillState(s) {
      if (s.label !== lastLabel) {
        lastLabel = s.label;
        skillLabel.textContent = s.label;
      }
      const frac = Math.round(Math.min(1, Math.max(0, s.cooldownFrac)) * 200) / 200;
      if (frac !== lastFrac) {
        lastFrac = frac;
        skillBtn.style.setProperty("--cd", `${frac * 360}deg`);
      }
      if (s.ready !== lastReady) {
        lastReady = s.ready;
        skillBtn.classList.toggle("ready", s.ready);
      }
    },
    read() {
      if (!enabled) return { dirX: 0, dirZ: 0, skill: false };
      let x = jx, z = jy;
      const kx = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
      const kz = (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);
      if (kx !== 0 || kz !== 0) {
        x = kx;
        z = kz;
      }
      const len = Math.hypot(x, z);
      if (len < DEAD_ZONE) { x = 0; z = 0; }
      else if (len > 1) { x /= len; z /= len; }
      return { dirX: x, dirZ: z, skill: skillTouch || keys.has("Space") };
    },
    setEnabled(on) {
      enabled = on;
      layer.classList.toggle("hidden", !on);
      if (!on) { joyId = null; jx = jy = 0; base.classList.remove("active"); endSkill(); }
    },
    destroy() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      layer.remove();
    },
  };
}
