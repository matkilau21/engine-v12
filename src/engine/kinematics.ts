import { CylinderTelemetry, ENGINE_SPECS, StrokePhase } from './types';

/**
 * Geometric constants in Three.js world units (1 unit = 100 mm).
 */
export const V12_GEO = {
  BANK_ANGLE_RAD: Math.PI / 6, // ±30° from vertical = 60° included V-angle
  BORE_RADIUS: 0.44,
  CRANK_RADIUS: 0.38, // r (76 mm stroke)
  CONROD_LENGTH: 1.46, // L (L/r = 3.84)
  PISTON_CROWN_H: 0.30,
  PISTON_SKIRT_H: 0.34,
  DECK_DIST: 2.24, // distance from crank centerline along bore axis to cylinder deck
  HEAD_HEIGHT: 0.82,
  CYLINDER_PITCH: 1.14,
  ROD_PAIR_OFFSET: 0.145, // side-by-side offset on shared crankpin
  VALVE_MAX_LIFT: 0.135,
  // 6 crankpin longitudinal Z positions (front +Z to rear -Z)
  PIN_Z: [2.85, 1.71, 0.57, -0.57, -1.71, -2.85] as const,
  // Mirror-symmetric 6-throw 120° V12 crankshaft (zero 1st & 2nd order imbalance)
  // Pair index 0..5 -> Cylinders (1,7), (2,8), (3,9), (4,10), (5,11), (6,12)
  THROW_DEG: [0, 240, 120, 120, 240, 0] as const,
};

export interface CylinderConfig {
  index: number; // 0..11
  cylinderNumber: number; // 1..12 (1..6 Bank A right +X, 7..12 Bank B left -X)
  bank: 'A' | 'B';
  bankSign: 1 | -1; // +1 = Bank A (+30° toward +X), -1 = Bank B (-30° toward -X)
  pairIndex: number; // 0..5
  zPos: number;
  throwDeg: number;
  firingAngleDeg: number; // Exact crank angle in [0, 720) when cylinder fires at TDC
}

/**
 * Exact 12-cylinder layout matching authentic 60° V12 firing order:
 * 1 - 12 - 5 - 8 - 3 - 10 - 6 - 7 - 2 - 11 - 4 - 9
 * Every firing event occurs at exact geometric TDC for that cylinder (every 60°).
 */
export const CYLINDER_CONFIGS: CylinderConfig[] = (() => {
  const firingMap: Record<number, number> = {};
  ENGINE_SPECS.firingOrder.forEach((cylNum, orderIdx) => {
    firingMap[cylNum] = orderIdx * 60;
  });

  const configs: CylinderConfig[] = [];
  // Bank A: Cylinders 1..6 (Right bank, +30° toward +X)
  for (let p = 0; p < 6; p++) {
    const cylNum = p + 1;
    configs.push({
      index: p,
      cylinderNumber: cylNum,
      bank: 'A',
      bankSign: 1,
      pairIndex: p,
      zPos: V12_GEO.PIN_Z[p] + V12_GEO.ROD_PAIR_OFFSET,
      throwDeg: V12_GEO.THROW_DEG[p],
      firingAngleDeg: firingMap[cylNum],
    });
  }
  // Bank B: Cylinders 7..12 (Left bank, -30° toward -X)
  for (let p = 0; p < 6; p++) {
    const cylNum = p + 7;
    configs.push({
      index: p + 6,
      cylinderNumber: cylNum,
      bank: 'B',
      bankSign: -1,
      pairIndex: p,
      zPos: V12_GEO.PIN_Z[p] - V12_GEO.ROD_PAIR_OFFSET,
      throwDeg: V12_GEO.THROW_DEG[p],
      firingAngleDeg: firingMap[cylNum],
    });
  }
  return configs;
})();

export interface CylinderKinematicsResult {
  // Crankpin position in engine XY plane
  pinX: number;
  pinY: number;
  // Wrist pin distance along the bank bore axis from crank center
  pistonDist: number;
  // Wrist pin position in engine XY plane
  wristX: number;
  wristY: number;
  // Connecting rod world rotation around Z axis (pointing from crankpin to wrist pin)
  conrodAngleZ: number;
  // Normalized piston position (0 = BDC, 1 = TDC)
  pistonNorm: number;
  // 4-stroke cycle angle in [0, 720): 0 = Ignition TDC, 180 = Power BDC, 360 = Exhaust TDC, 540 = Intake BDC
  cycleDeg: number;
  phase: StrokePhase;
  intakeLift: number; // 0..1
  exhaustLift: number; // 0..1
  sparkIntensity: number; // 0..1
  combustionIntensity: number; // 0..1
}

/**
 * Smooth raised-cosine valve lift profile over an angular window [startDeg, endDeg]
 * in the 0..720° 4-stroke cycle.
 */
function valveLiftProfile(cycleDeg: number, startDeg: number, endDeg: number): number {
  let d = cycleDeg;
  // Handle wrap-around near 0 / 720
  if (endDeg > 720 && d < startDeg - 180) d += 720;
  if (startDeg < 0 && d > endDeg + 180) d -= 720;
  if (d <= startDeg || d >= endDeg) return 0;
  const u = (d - startDeg) / (endDeg - startDeg); // 0..1
  const s = Math.sin(u * Math.PI);
  return s * s; // smooth C1 bell curve (zero velocity at seat & nose)
}

/**
 * Solves exact slider-crank geometry, valve lifts, and combustion phase for a cylinder
 * at the given crankshaft angle (in radians, monotonic or wrapped).
 *
 * Rotation convention: crank rotates around +Z by `(crankRad - Math.PI / 6)` so
 * Cyl 1 (Bank A, +30°, throw 0°) reaches exact geometric TDC at crankDeg = 0°!
 */
export function solveCylinderKinematics(
  cfg: CylinderConfig,
  crankRad: number,
  out: CylinderKinematicsResult
): CylinderKinematicsResult {
  const { CRANK_RADIUS: r, CONROD_LENGTH: L, BANK_ANGLE_RAD: halfV } = V12_GEO;
  const throwRad = (cfg.throwDeg * Math.PI) / 180;

  // World crankpin rotation angle (rotation around +Z from +Y axis: x = -r*sin(a), y = r*cos(a))
  const pinWorldAngle = crankRad - halfV + throwRad;
  const pinX = -r * Math.sin(pinWorldAngle);
  const pinY = r * Math.cos(pinWorldAngle);

  // Unit vector along cylinder bore axis:
  // Bank A (+1): (+sin(30°), +cos(30°))  -> bankAngleFromY = -30° in +Z CCW coords
  // Bank B (-1): (-sin(30°), +cos(30°))  -> bankAngleFromY = +30° in +Z CCW coords
  const ux = cfg.bankSign * Math.sin(halfV);
  const uy = Math.cos(halfV);

  // Project crankpin onto bore axis (parallel s_pin) and perpendicular axis (perp p_pin)
  const sPin = pinX * ux + pinY * uy;
  const pPin = pinX * uy - pinY * ux;

  // Exact slider-crank wrist pin distance along bore axis
  const conrodProj = Math.sqrt(Math.max(0.0001, L * L - pPin * pPin));
  const pistonDist = sPin + conrodProj;

  const wristX = ux * pistonDist;
  const wristY = uy * pistonDist;

  // Connecting rod vector from crankpin to wrist pin
  const dx = wristX - pinX;
  const dy = wristY - pinY;
  // Angle relative to +Y axis so a rod built along +Y points from crankpin to wrist pin
  const conrodAngleZ = Math.atan2(-dx, dy);

  const minS = L - r;
  const maxS = L + r;
  const pistonNorm = Math.max(0, Math.min(1, (pistonDist - minS) / (maxS - minS)));

  // 4-stroke cycle position [0, 720) relative to this cylinder's firing TDC
  const crankDeg720 = (((crankRad * 180) / Math.PI) % 720 + 720) % 720;
  const cycleDeg = ((crankDeg720 - cfg.firingAngleDeg) % 720 + 720) % 720;

  let phase: StrokePhase;
  if (cycleDeg < 180) {
    phase = 'power';
  } else if (cycleDeg < 360) {
    phase = 'exhaust';
  } else if (cycleDeg < 540) {
    phase = 'intake';
  } else {
    phase = 'compression';
  }

  // Authentic high-revving V12 cam timing with mild overlap at exhaust-to-intake TDC (360°):
  // Exhaust opens ~150° (BBDC) -> closes ~380° (ATDC)
  const exhaustLift = valveLiftProfile(cycleDeg, 152, 382);
  // Intake opens ~342° (BTDC) -> closes ~575° (ABDC)
  const intakeLift = valveLiftProfile(cycleDeg, 342, 575);

  // Ignition spark flash right around firing TDC (712°..720° and 0°..18°)
  let sparkIntensity = 0;
  if (cycleDeg >= 710) {
    sparkIntensity = (cycleDeg - 710) / 10;
  } else if (cycleDeg <= 22) {
    sparkIntensity = 1 - cycleDeg / 22;
  }

  // Expanding flame front during early power stroke (0°..145°)
  let combustionIntensity = 0;
  if (cycleDeg < 145) {
    const t = cycleDeg / 145;
    combustionIntensity = Math.pow(1 - t, 1.45);
  }

  out.pinX = pinX;
  out.pinY = pinY;
  out.pistonDist = pistonDist;
  out.wristX = wristX;
  out.wristY = wristY;
  out.conrodAngleZ = conrodAngleZ;
  out.pistonNorm = pistonNorm;
  out.cycleDeg = cycleDeg;
  out.phase = phase;
  out.intakeLift = intakeLift;
  out.exhaustLift = exhaustLift;
  out.sparkIntensity = sparkIntensity;
  out.combustionIntensity = combustionIntensity;
  return out;
}

/**
 * Realistic naturally aspirated 6.5L V12 torque & horsepower curve.
 * Peak Torque: ~692 Nm @ 6,750 RPM | Peak Power: ~830 HP @ 8,500 RPM | Redline: 9,250 RPM.
 */
export function computeEngineOutput(rpm: number): {
  torqueNm: number;
  horsepower: number;
  exhaustTempC: number;
  oilPressureBar: number;
} {
  if (rpm <= 10) {
    return { torqueNm: 0, horsepower: 0, exhaustTempC: 42, oilPressureBar: 0 };
  }
  const x = rpm / 1000;
  // Smooth volumetric-efficiency bell curve peaking at 6.75k RPM
  const ve =
    0.72 +
    0.28 * Math.exp(-Math.pow((x - 6.8) / 3.4, 2)) -
    (x > 8.6 ? Math.pow(x - 8.6, 2) * 0.14 : 0);
  const idleRoll = Math.min(1, rpm / 1400);
  const torqueNm = Math.max(0, ENGINE_SPECS.peakTorqueNm * ve * (0.62 + 0.38 * idleRoll));
  // Mechanical power: P(kW) = T(Nm) * RPM / 9549.3; HP = kW * 1.34102
  const horsepower = (torqueNm * rpm) / 7121.0;
  const exhaustTempC = 280 + Math.min(1, rpm / 9250) * 660;
  const oilPressureBar = 2.1 + Math.min(1, rpm / 6500) * 3.9;
  return {
    torqueNm: Math.round(torqueNm),
    horsepower: Math.round(horsepower),
    exhaustTempC: Math.round(exhaustTempC),
    oilPressureBar: Number(oilPressureBar.toFixed(1)),
  };
}

/**
 * Build a reusable blank telemetry array for zero-allocation updates.
 */
export function createEmptyCylinderTelemetry(): CylinderTelemetry[] {
  return CYLINDER_CONFIGS.map((cfg) => ({
    cylinderNumber: cfg.cylinderNumber,
    bank: cfg.bank,
    pairIndex: cfg.pairIndex,
    firingAngleDeg: cfg.firingAngleDeg,
    cycleAngleDeg: 0,
    phase: 'power',
    pistonNorm: 1,
    intakeLift: 0,
    exhaustLift: 0,
    sparkIntensity: 0,
    combustionIntensity: 0,
  }));
}
