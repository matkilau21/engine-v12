export type ViewMode = 'assembled' | 'cutaway' | 'xray';

export type FinishId = 'rosso' | 'carbonio' | 'billet' | 'verde' | 'oro';

export type LightingId = 'atelier' | 'gallery' | 'thermal';

export type CameraPresetId = 'hero' | 'valvetrain' | 'crank' | 'headers' | 'intake' | 'timing';

export type StrokePhase = 'intake' | 'compression' | 'power' | 'exhaust';

export type ArMode = 'studio' | 'webxr' | 'preview';

export type ArPlacementPhase = 'idle' | 'scanning' | 'surface-detected' | 'placed';

export type ArScaleMode = 'tabletop' | 'full';

export interface ArStatus {
  webxrSupported: boolean;
  mode: ArMode;
  phase: ArPlacementPhase;
  scaleMode: ArScaleMode;
  errorMessage: string | null;
}

export type ComponentId =
  | 'valveCovers'
  | 'intakePlenums'
  | 'exhaustHeaders'
  | 'cylinderHeads'
  | 'valvetrain'
  | 'engineBlock'
  | 'crankshaft'
  | 'pistons'
  | 'drySump'
  | 'timingDrive'
  | 'flywheel';

export interface FinishPreset {
  id: FinishId;
  name: string;
  subtitle: string;
  swatch: string;
  accentSwatch: string;
  valveCoverColor: number;
  valveCoverMode: 'crinkle' | 'carbon' | 'billet';
  plenumMode: 'carbon-gloss' | 'carbon-matte' | 'cast-silver';
  plenumTint: number;
  railColor: number;
  headerTint: number;
  headerIridescence: number;
  camGearColor: number;
  blockTint: number;
}

export interface LightingPreset {
  id: LightingId;
  name: string;
  bgHex: string;
  fogHex: string;
  floorColor: number;
  exposure: number;
  keyColor: number;
  keyIntensity: number;
  fillSky: number;
  fillGround: number;
  fillIntensity: number;
  rimColor: number;
  rimIntensity: number;
  softboxIntensity: number;
  isLightTheme: boolean;
}

export interface CameraPreset {
  id: CameraPresetId;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
}

export interface ComponentSpec {
  id: ComponentId;
  name: string;
  subsystem: string;
  material: string;
  mass: string;
  tolerance: string;
  summary: string;
}

export interface CylinderTelemetry {
  cylinderNumber: number; // 1..12
  bank: 'A' | 'B';
  pairIndex: number; // 0..5
  firingAngleDeg: number; // 0..660 step 60
  cycleAngleDeg: number; // 0..720 relative to firing TDC (0 = ignition TDC)
  phase: StrokePhase;
  pistonNorm: number; // 0 = BDC, 1 = TDC
  intakeLift: number; // 0..1
  exhaustLift: number; // 0..1
  sparkIntensity: number; // 0..1
  combustionIntensity: number; // 0..1
}

export interface EngineTelemetry {
  rpm: number;
  targetRpm: number;
  crankAngleDeg: number; // 0..720
  horsepower: number;
  torqueNm: number;
  firingCylinder: number;
  exhaustTempC: number;
  oilPressureBar: number;
  cylinders: CylinderTelemetry[];
}

export const ENGINE_SPECS = {
  displacementCc: 6498,
  bankAngleDeg: 60,
  boreMm: 95.0,
  strokeMm: 76.4,
  redlineRpm: 9250,
  maxRpm: 9500,
  idleRpm: 950,
  peakHp: 830,
  peakTorqueNm: 692,
  firingOrder: [1, 12, 5, 8, 3, 10, 6, 7, 2, 11, 4, 9] as const,
};

export const FINISH_PRESETS: FinishPreset[] = [
  {
    id: 'rosso',
    name: 'Rosso Corsa',
    subtitle: 'Crinkle crimson · 2×2 gloss carbon',
    swatch: '#b81d18',
    accentSwatch: '#27292e',
    valveCoverColor: 0xb51b17,
    valveCoverMode: 'crinkle',
    plenumMode: 'carbon-gloss',
    plenumTint: 0x262930,
    railColor: 0xc8ccd4,
    headerTint: 0xc2b29f,
    headerIridescence: 0.32,
    camGearColor: 0xc29f58,
    blockTint: 0xbec4cc,
  },
  {
    id: 'carbonio',
    name: 'Nero Carbonio',
    subtitle: 'Exposed carbon · anodized gold',
    swatch: '#1c1e24',
    accentSwatch: '#c49b4b',
    valveCoverColor: 0x24272f,
    valveCoverMode: 'carbon',
    plenumMode: 'carbon-matte',
    plenumTint: 0x1d2026,
    railColor: 0xc9a04d,
    headerTint: 0x9aa4be,
    headerIridescence: 0.78,
    camGearColor: 0xd1a954,
    blockTint: 0x989fa8,
  },
  {
    id: 'billet',
    name: 'Bianco Billet',
    subtitle: 'Raw CNC aluminum · cobalt rails',
    swatch: '#d5dae2',
    accentSwatch: '#2563eb',
    valveCoverColor: 0xd4dae3,
    valveCoverMode: 'billet',
    plenumMode: 'cast-silver',
    plenumTint: 0xd0d6de,
    railColor: 0x2659c9,
    headerTint: 0xd2cbc2,
    headerIridescence: 0.22,
    camGearColor: 0x2c62d4,
    blockTint: 0xc9cfd7,
  },
  {
    id: 'verde',
    name: 'Verde Scuderia',
    subtitle: 'Racing green crinkle · champagne billet',
    swatch: '#164a35',
    accentSwatch: '#b89b6a',
    valveCoverColor: 0x144732,
    valveCoverMode: 'crinkle',
    plenumMode: 'carbon-gloss',
    plenumTint: 0x22262b,
    railColor: 0xbfa170,
    headerTint: 0xc4b59d,
    headerIridescence: 0.4,
    camGearColor: 0xb89a66,
    blockTint: 0xb7bec6,
  },
  {
    id: 'oro',
    name: 'Oro Atelier',
    subtitle: 'Satin obsidian · forged gold titanium',
    swatch: '#a6823c',
    accentSwatch: '#181a1f',
    valveCoverColor: 0x1b1d22,
    valveCoverMode: 'crinkle',
    plenumMode: 'carbon-matte',
    plenumTint: 0x25272d,
    railColor: 0xd6b05e,
    headerTint: 0xd4b67c,
    headerIridescence: 0.55,
    camGearColor: 0xd8b360,
    blockTint: 0xa4abb4,
  },
];

export const LIGHTING_PRESETS: LightingPreset[] = [
  {
    id: 'atelier',
    name: 'Atelier Dark',
    bgHex: '#0b0c10',
    fogHex: '#0b0c10',
    floorColor: 0x15171d,
    exposure: 1.12,
    keyColor: 0xfff3e2,
    keyIntensity: 2.8,
    fillSky: 0x8ea9cc,
    fillGround: 0x1d1a18,
    fillIntensity: 0.85,
    rimColor: 0xbad4ff,
    rimIntensity: 1.65,
    softboxIntensity: 4.5,
    isLightTheme: false,
  },
  {
    id: 'gallery',
    name: 'Gallery Light',
    bgHex: '#e6e8ec',
    fogHex: '#e6e8ec',
    floorColor: 0xdce0e6,
    exposure: 1.04,
    keyColor: 0xfffaf2,
    keyIntensity: 2.4,
    fillSky: 0xdbe6f5,
    fillGround: 0x9fa3aa,
    fillIntensity: 1.15,
    rimColor: 0xffffff,
    rimIntensity: 1.2,
    softboxIntensity: 3.4,
    isLightTheme: true,
  },
  {
    id: 'thermal',
    name: 'Thermal Lab',
    bgHex: '#070b12',
    fogHex: '#070b12',
    floorColor: 0x0f1520,
    exposure: 1.08,
    keyColor: 0xd8ebff,
    keyIntensity: 2.2,
    fillSky: 0x5c85b8,
    fillGround: 0x1c1412,
    fillIntensity: 0.7,
    rimColor: 0xffa066,
    rimIntensity: 2.1,
    softboxIntensity: 3.8,
    isLightTheme: false,
  },
];

export const CAMERA_PRESETS: CameraPreset[] = [
  {
    id: 'hero',
    label: 'Hero 3/4',
    position: [7.6, 4.9, 7.8],
    target: [0, 2.25, 0],
  },
  {
    id: 'valvetrain',
    label: 'Valvetrain',
    position: [4.2, 5.2, 2.6],
    target: [0.9, 3.3, 0.2],
  },
  {
    id: 'crank',
    label: 'Crank & Pistons',
    position: [4.6, 1.5, 4.4],
    target: [0, 1.9, 0.2],
  },
  {
    id: 'headers',
    label: '6-into-1 Headers',
    position: [7.8, 2.6, -2.8],
    target: [1.4, 2.1, -0.3],
  },
  {
    id: 'intake',
    label: 'Top Induction',
    position: [0.4, 8.6, 4.4],
    target: [0, 3.6, 0],
  },
  {
    id: 'timing',
    label: 'Front Timing',
    position: [0.3, 3.0, 9.2],
    target: [0, 2.4, 2.6],
  },
];

export const COMPONENT_SPECS: Record<ComponentId, ComponentSpec> = {
  valveCovers: {
    id: 'valveCovers',
    name: 'DOHC Camshaft Covers',
    subsystem: 'Upper Enclosure',
    material: 'Sand-cast Magnesium Alloy / Autoclave Carbon',
    mass: '4.8 kg (pair)',
    tolerance: '±0.05 mm gasket deck',
    summary: 'Low-profile magnesium cam covers sealing the 48-valve DOHC head assembly with integrated oil baffle galleries and billet filler neck.',
  },
  intakePlenums: {
    id: 'intakePlenums',
    name: 'Dual Carbon Induction Plenums',
    subsystem: 'Air Intake & Fuel Delivery',
    material: '2×2 Twill Pre-Preg Carbon Fiber & Billet 7075-T6',
    mass: '6.2 kg complete',
    tolerance: '±0.08 mm runner match',
    summary: 'Tuned Helmholtz dual plenums feeding 12 individual tapered velocity stacks, twin 76 mm drive-by-wire throttle bodies, and high-pressure billet fuel rails.',
  },
  exhaustHeaders: {
    id: 'exhaustHeaders',
    name: '6-into-1 Equal-Length Headers',
    subsystem: 'Exhaust Scavenging',
    material: 'Thin-wall Inconel 625 (0.9 mm wall)',
    mass: '11.4 kg (both banks)',
    tolerance: '±1.2 mm primary length',
    summary: 'Hydroformed equal-length tubular primaries tuned for 6th-order acoustic resonance and maximum scavenging efficiency past 8,500 RPM.',
  },
  cylinderHeads: {
    id: 'cylinderHeads',
    name: '48-Valve Pent-Roof Cylinder Heads',
    subsystem: 'Combustion & Gas Exchange',
    material: 'Gravity-Cast AlSi7Mg-T6 Aluminum',
    mass: '28.6 kg (pair)',
    tolerance: '±0.015 mm valve guide',
    summary: 'High-tumble intake ports with 13.5:1 compression pent-roof chambers, central iridium spark wells, and CNC-ported exhaust runners.',
  },
  valvetrain: {
    id: 'valvetrain',
    name: 'Quad-Cam 48V Valvetrain',
    subsystem: 'Valve Actuation',
    material: 'Chilled Billet Steel Cams · Titanium Valves',
    mass: '9.1 kg total',
    tolerance: '±0.008 mm cam lobe lift',
    summary: 'Four hollow-drilled overhead camshafts rotating at 0.5× crank speed, actuating 48 hollow-stem titanium valves with progressive helical springs.',
  },
  engineBlock: {
    id: 'engineBlock',
    name: '60° V12 Crankcase & Block',
    subsystem: 'Primary Structure',
    material: 'Alusil Hypereutectic Aluminum-Silicon Alloy',
    mass: '46.5 kg bare',
    tolerance: '±0.006 mm bore cylindricity',
    summary: 'Deep-skirt 60° V12 monoblock with plasma-transferred wire-arc liners, cross-bolted 7-main bearing ladder, and external acoustic stiffening ribs.',
  },
  crankshaft: {
    id: 'crankshaft',
    name: '6-Throw Forged Crankshaft',
    subsystem: 'Rotating Assembly',
    material: '4340 Billet Chromoly Steel, Nitrided',
    mass: '21.8 kg balanced',
    tolerance: '±0.004 mm journal runout',
    summary: 'Zero-primary/secondary-imbalance 120° symmetric 6-throw crankshaft with knife-edged counterweights and cross-drilled oil passages.',
  },
  pistons: {
    id: 'pistons',
    name: 'Forged Pistons & Titanium H-Rods',
    subsystem: 'Reciprocating Assembly',
    material: '2618 Forged Aluminum · Ti-6Al-4V Rods',
    mass: '392 g piston / 435 g rod',
    tolerance: '±0.5 g matched set',
    summary: 'Short-skirt slipper pistons with DLC-coated wrist pins and crack-split forged titanium H-beam connecting rods rated for 9,500 RPM.',
  },
  drySump: {
    id: 'drySump',
    name: 'Finned Dry-Sump Scavenge Pan',
    subsystem: 'Lubrication System',
    material: 'CNC-Milled 6061-T6 Billet Aluminum',
    mass: '5.4 kg',
    tolerance: '±0.04 mm windage tray',
    summary: 'Ultra-shallow structural dry-sump pan lowering center of gravity by 55 mm while multi-stage scavenge galleries maintain 5.8 bar under high-G cornering.',
  },
  timingDrive: {
    id: 'timingDrive',
    name: 'Front Cam Drive & Harmonic Damper',
    subsystem: 'Synchronization & Accessories',
    material: '7075-T6 Anodized Sprockets · Kevlar Belt',
    mass: '7.2 kg',
    tolerance: '±0.1° cam phase accuracy',
    summary: 'Precision 2:1 crank-to-cam timing reduction with twin variable phasers, elastomeric harmonic balancer, and high-efficiency accessory drive.',
  },
  flywheel: {
    id: 'flywheel',
    name: 'Ultra-Low Inertia Flywheel & Clutch',
    subsystem: 'Power Transmission',
    material: 'Chromoly Steel Ring · Carbon-Carbon Pack',
    mass: '4.1 kg',
    tolerance: '0.02 g·cm dynamic balance',
    summary: 'Skeletal lightweight flywheel with 132-tooth starter ring gear enabling razor-sharp 28,000 RPM/sec unloaded rev response.',
  },
};
