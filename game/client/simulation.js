export const STEP = 1 / 60;
export const JUMP = 1,
  SPRINT = 2,
  CROUCH = 4,
  ADS = 8,
  SLIDE = 16;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const motion = (s) => {
  const vx = s.vx || 0,
    vz = s.vz || 0,
    slideSpeed = Math.hypot(vx, vz) || 1;
  return {
    x: s.x,
    y: s.y,
    z: s.z,
    vx,
    vy: s.vy || 0,
    vz,
    ground: s.ground ?? true,
    crouch: !!s.crouch,
    sliding: !!s.sliding,
    slideTime: s.slideTime || 0,
    slideCooldown: s.slideCooldown || 0,
    slideX: s.slideX ?? (s.sliding ? vx / slideSpeed : 0),
    slideZ: s.slideZ ?? (s.sliding ? vz / slideSpeed : 0),
    slideHeld: false,
    crouchHeld: false,
    jumpHeld: !!s.jumpHeld,
  };
};

// Fixed-step prediction, kept numerically equivalent to internal/game/world.go.
export class World {
  constructor(colliders) {
    this.colliders = colliders;
    this.grid = new Map();
    this.seen = new Uint32Array(colliders.length);
    this.queryId = 0;
    this.nearbyBuffer = [];
    for (let index = 0; index < colliders.length; index++) {
      const c = colliders[index];
      for (
        let x = Math.floor(c.min[0] / 4);
        x <= Math.floor(c.max[0] / 4);
        x++
      ) {
        for (
          let z = Math.floor(c.min[2] / 4);
          z <= Math.floor(c.max[2] / 4);
          z++
        ) {
          if (!this.grid.has(x)) this.grid.set(x, new Map());
          const column = this.grid.get(x);
          if (!column.has(z)) column.set(z, []);
          column.get(z).push(index);
        }
      }
    }
  }
  nearby(x, z) {
    const out = this.nearbyBuffer;
    out.length = 0;
    this.queryId = (this.queryId + 1) >>> 0;
    if (this.queryId === 0) {
      this.seen.fill(0);
      this.queryId = 1;
    }
    for (
      let i = Math.floor((x - 0.33) / 4);
      i <= Math.floor((x + 0.33) / 4);
      i++
    )
      for (
        let j = Math.floor((z - 0.33) / 4);
        j <= Math.floor((z + 0.33) / 4);
        j++
      )
        for (const index of this.grid.get(i)?.get(j) || []) {
          if (this.seen[index] !== this.queryId) {
            this.seen[index] = this.queryId;
            out.push(this.colliders[index]);
          }
        }
    return out;
  }
  blockedAt(x, y, z, h) {
    for (const c of this.nearby(x, z))
      if (
        !c.noMove &&
        x + 0.32 > c.min[0] + 0.001 &&
        x - 0.32 < c.max[0] - 0.001 &&
        z + 0.32 > c.min[2] + 0.001 &&
        z - 0.32 < c.max[2] - 0.001 &&
        y + h > c.min[1] + 0.002 &&
        y < c.max[1] - 0.002
      )
        return true;
    return false;
  }
  blocked(p, h) {
    return this.blockedAt(p.x, p.y, p.z, h);
  }
  move(m, input) {
    const crouch = !!(input.buttons & CROUCH),
      slideInput = !!(input.buttons & SLIDE),
      slidePressed = (slideInput && !m.slideHeld) || (crouch && !m.crouchHeld),
      wasCrouched = m.crouch,
      preSlideSpeed = Math.hypot(m.vx, m.vz),
      wantsSprint = !!(input.buttons & SPRINT) && !(input.buttons & ADS) &&
        Math.hypot(input.forward, input.right) > 0.01;
    m.slideHeld = slideInput;
    m.crouchHeld = crouch;
    m.slideCooldown = Math.max(0, m.slideCooldown - STEP);
    if ((slidePressed || slideInput) && wantsSprint && !m.sliding && !wasCrouched && m.ground &&
        preSlideSpeed > 5.2 && m.slideCooldown <= 0) {
      m.sliding = true;
      m.slideTime = 0;
      m.crouch = false;
      m.slideX = m.vx / preSlideSpeed;
      m.slideZ = m.vz / preSlideSpeed;
      const boosted = clamp(preSlideSpeed * 1.3, 8.6, 11);
      m.vx = m.slideX * boosted;
      m.vz = m.slideZ * boosted;
    }
    const sliding = m.sliding;
    let height = 1.8;
    if (sliding) {
      m.crouch = false;
      height = 0.95;
      m.slideTime += STEP;
      const speed = Math.max(0, Math.hypot(m.vx, m.vz) * Math.exp(-0.75 * STEP) -
        (1.2 + m.slideTime * 3.2) * STEP);
      m.vx = m.slideX * speed;
      m.vz = m.slideZ * speed;
    } else {
      const waitingForSlideSpeed = slideInput && wantsSprint && !wasCrouched;
      if (crouch && !waitingForSlideSpeed) m.crouch = true;
      else if (!this.blocked(m, 1.8)) m.crouch = false;
      if (m.crouch) height = 1.2;
      let speed = m.crouch ? 2.7 : wantsSprint && !m.crouch ? 7.5 : 4.6;
      if (input.buttons & ADS) speed *= 0.65;
      let f = input.forward,
        r = input.right;
      const len = Math.hypot(f, r);
      if (len > 1) {
        f /= len;
        r /= len;
      }
      const sy = Math.sin(input.yaw),
        cy = Math.cos(input.yaw);
      let ax = (-sy * f + cy * r) * speed - m.vx,
        az = (-cy * f - sy * r) * speed - m.vz;
      const accel = Math.hypot(ax, az);
      if (accel > 36 * STEP) {
        ax *= (36 * STEP) / accel;
        az *= (36 * STEP) / accel;
      }
      m.vx += ax;
      m.vz += az;
    }
    const jump = !!(input.buttons & JUMP);
    if (jump && !m.jumpHeld && m.ground) {
      m.vy = 7;
      m.ground = false;
    }
    m.jumpHeld = jump;
    m.vy -= 22 * STEP;
    for (let axis = 0; axis < 2; axis++) {
      const x = m.x + (axis === 0 ? m.vx * STEP : 0);
      const z = m.z + (axis === 1 ? m.vz * STEP : 0);
      if (!this.blockedAt(x, m.y, z, height)) {
        m.x = x;
        m.z = z;
      } else if (m.ground) {
        if (!this.blockedAt(x, m.y + 0.42, z, height)) {
          m.x = x;
          m.y += 0.42;
          m.z = z;
        }
      }
    }
    let dy = m.vy * STEP;
    const oldY = m.y;
    m.ground = false;
    for (const c of this.nearby(m.x, m.z)) {
      if (
        c.noMove ||
        m.x + 0.32 <= c.min[0] + 0.001 ||
        m.x - 0.32 >= c.max[0] - 0.001 ||
        m.z + 0.32 <= c.min[2] + 0.001 ||
        m.z - 0.32 >= c.max[2] - 0.001
      )
        continue;
      if (dy <= 0 && oldY >= c.max[1] - 0.02 && oldY + dy <= c.max[1]) {
        dy = Math.max(dy, c.max[1] - oldY);
        m.ground = true;
      }
      if (
        dy > 0 &&
        oldY + height <= c.min[1] + 0.002 &&
        oldY + height + dy >= c.min[1]
      )
        dy = Math.min(dy, c.min[1] - height - oldY);
    }
    m.y += dy;
    if (m.ground || Math.abs(dy - m.vy * STEP) > 0.00001) m.vy = 0;
    if (sliding && (Math.hypot(m.vx, m.vz) < 3.6 || m.slideTime > 1.25 ||
        (m.slideTime > 0.28 && crouch))) {
      m.sliding = false;
      m.slideTime = 0;
      m.slideCooldown = 0.4;
      m.crouch = crouch || this.blocked(m, 1.8);
    }
    m.x = clamp(m.x, -31, 31);
    m.z = clamp(m.z, -24, 25);
  }
}
