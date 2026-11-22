import * as THREE from 'three';
import { ProceduralTextureSet } from './textures';
import { ComponentId, FINISH_PRESETS, FinishId, FinishPreset, ViewMode } from './types';

export interface EngineMaterialLibrary {
  // Primary configurator finishes (Bank B / solid, plus Bank A cutaway counterparts)
  valveCoverSolid: THREE.MeshPhysicalMaterial;
  valveCoverCutaway: THREE.MeshPhysicalMaterial;
  plenumSolid: THREE.MeshPhysicalMaterial;
  plenumCutaway: THREE.MeshPhysicalMaterial;
  blockSolid: THREE.MeshStandardMaterial;
  blockCutaway: THREE.MeshPhysicalMaterial;
  headSolid: THREE.MeshStandardMaterial;
  headCutaway: THREE.MeshPhysicalMaterial;
  drySump: THREE.MeshStandardMaterial;

  // Precision mechanical metals
  crankshaftSteel: THREE.MeshPhysicalMaterial;
  pistonAluminum: THREE.MeshPhysicalMaterial;
  pistonRingDark: THREE.MeshStandardMaterial;
  conrodTitanium: THREE.MeshPhysicalMaterial;
  boreLiner: THREE.MeshStandardMaterial;
  camshaftSteel: THREE.MeshPhysicalMaterial;
  valveTitanium: THREE.MeshPhysicalMaterial;
  valveSpring: THREE.MeshStandardMaterial;

  // Intake, fuel, exhaust & trim
  intakeRunner: THREE.MeshPhysicalMaterial;
  fuelRail: THREE.MeshPhysicalMaterial;
  throttleBody: THREE.MeshPhysicalMaterial;
  butterflyBrass: THREE.MeshPhysicalMaterial;
  exhaustHeader: THREE.MeshPhysicalMaterial;
  exhaustFlange: THREE.MeshStandardMaterial;
  camSprocket: THREE.MeshPhysicalMaterial;
  timingBelt: THREE.MeshStandardMaterial;
  fastenerChrome: THREE.MeshStandardMaterial;
  coilPackDark: THREE.MeshStandardMaterial;
  sparkCeramic: THREE.MeshStandardMaterial;
  badgePlaque: THREE.MeshStandardMaterial;
  flywheelSteel: THREE.MeshPhysicalMaterial;
  clutchCover: THREE.MeshPhysicalMaterial;
  cradleAnodized: THREE.MeshStandardMaterial;

  // Dynamic combustion materials (12 cylinders + 12 sparks)
  combustionMats: THREE.MeshBasicMaterial[];
  sparkMats: THREE.MeshBasicMaterial[];

  // Studio environment floor & contact shadow
  floorPlinth: THREE.MeshStandardMaterial;
  floorRimAccent: THREE.MeshStandardMaterial;
  contactShadow: THREE.MeshBasicMaterial;

  // Controllers
  applyFinish: (finishId: FinishId) => void;
  applyViewMode: (mode: ViewMode) => void;
  updateExhaustHeat: (rpm: number, isThermalLab: boolean) => void;
  setHighlight: (selected: ComponentId | null, hovered: ComponentId | null) => void;
  dispose: () => void;
}

const COMPONENT_MATERIAL_KEYS: Record<ComponentId, (keyof EngineMaterialLibrary)[]> = {
  valveCovers: ['valveCoverSolid', 'valveCoverCutaway'],
  intakePlenums: ['plenumSolid', 'plenumCutaway', 'intakeRunner', 'fuelRail', 'throttleBody'],
  exhaustHeaders: ['exhaustHeader', 'exhaustFlange'],
  cylinderHeads: ['headSolid', 'headCutaway'],
  valvetrain: ['camshaftSteel', 'valveTitanium', 'valveSpring'],
  engineBlock: ['blockSolid', 'blockCutaway', 'boreLiner'],
  crankshaft: ['crankshaftSteel'],
  pistons: ['pistonAluminum', 'conrodTitanium'],
  drySump: ['drySump'],
  timingDrive: ['camSprocket', 'timingBelt'],
  flywheel: ['flywheelSteel', 'clutchCover'],
};

export function createEngineMaterials(
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean
): EngineMaterialLibrary {
  const allMaterials: THREE.Material[] = [];
  const track = <T extends THREE.Material>(m: T): T => {
    allMaterials.push(m);
    return m;
  };

  let currentFinish: FinishPreset = FINISH_PRESETS[0];
  let currentMode: ViewMode = 'assembled';
  let currentSelected: ComponentId | null = null;
  let currentHovered: ComponentId | null = null;
  let currentHeatEmissive = new THREE.Color(0x000000);
  let currentHeatIntensity = 0;

  // Valve Covers (Solid Bank B + Cutaway-capable Bank A)
  const valveCoverSolid = track(
    new THREE.MeshPhysicalMaterial({
      color: currentFinish.valveCoverColor,
      metalness: 0.25,
      roughness: 0.62,
      bumpMap: textures.crinkleBump,
      bumpScale: 0.018,
      roughnessMap: textures.crinkleRoughness,
      clearcoat: 0.25,
      clearcoatRoughness: 0.45,
      envMapIntensity: 1.15,
    })
  );

  const valveCoverCutaway = track(valveCoverSolid.clone());

  // Carbon Plenums (Solid + Cutaway-capable)
  const plenumSolid = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: textures.carbonAlbedo,
      bumpMap: textures.carbonBump,
      bumpScale: 0.012,
      roughnessMap: textures.carbonRoughness,
      metalness: 0.12,
      roughness: 0.24,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.35,
    })
  );

  const plenumCutaway = track(plenumSolid.clone());

  // Cylinder Block (Sand-cast aluminum + Cutaway Bank A shell)
  const blockSolid = track(
    new THREE.MeshStandardMaterial({
      color: currentFinish.blockTint,
      metalness: 0.78,
      roughness: 0.44,
      bumpMap: textures.castAlumBump,
      bumpScale: 0.016,
      envMapIntensity: 1.0,
    })
  );

  const blockCutaway = track(
    new THREE.MeshPhysicalMaterial({
      color: currentFinish.blockTint,
      metalness: 0.78,
      roughness: 0.44,
      bumpMap: textures.castAlumBump,
      bumpScale: 0.016,
      envMapIntensity: 1.0,
    })
  );

  // Cylinder Heads
  const headSolid = track(
    new THREE.MeshStandardMaterial({
      color: 0xcfd5dd,
      metalness: 0.84,
      roughness: 0.34,
      bumpMap: textures.castAlumBump,
      bumpScale: 0.01,
      envMapIntensity: 1.1,
    })
  );

  const headCutaway = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xcfd5dd,
      metalness: 0.84,
      roughness: 0.34,
      bumpMap: textures.castAlumBump,
      bumpScale: 0.01,
      envMapIntensity: 1.1,
    })
  );

  // Dry Sump Pan
  const drySump = track(
    new THREE.MeshStandardMaterial({
      color: 0x3b4049,
      metalness: 0.72,
      roughness: 0.48,
      bumpMap: textures.castAlumBump,
      bumpScale: 0.014,
      envMapIntensity: 0.95,
    })
  );

  // Crankshaft (Nitrided 4340 Billet Chromoly Steel — dark gunmetal mirror-polished journals)
  const crankshaftSteel = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xaab2be,
      metalness: 0.96,
      roughness: 0.16,
      bumpMap: textures.brushedMetalBump,
      bumpScale: 0.006,
      anisotropy: 0.75,
      clearcoat: 0.15,
      envMapIntensity: 1.35,
    })
  );

  // Forged Pistons (Bright CNC Aluminum)
  const pistonAluminum = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xe6ebf2,
      metalness: 0.92,
      roughness: 0.18,
      anisotropy: 0.85,
      envMapIntensity: 1.3,
    })
  );

  const pistonRingDark = track(
    new THREE.MeshStandardMaterial({
      color: 0x262a30,
      metalness: 0.85,
      roughness: 0.25,
    })
  );

  // Titanium H-Beam Conrods (Warm satin Ti-6Al-4V tone)
  const conrodTitanium = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xb9b4a8,
      metalness: 0.9,
      roughness: 0.28,
      bumpMap: textures.brushedMetalBump,
      bumpScale: 0.008,
      anisotropy: 0.65,
      envMapIntensity: 1.2,
    })
  );

  // Cylinder Bore Honed Liner
  const boreLiner = track(
    new THREE.MeshStandardMaterial({
      color: 0x8e96a2,
      metalness: 0.92,
      roughness: 0.22,
      side: THREE.DoubleSide,
    })
  );

  // Camshafts & Valves
  const camshaftSteel = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xbfc7d2,
      metalness: 0.95,
      roughness: 0.14,
      anisotropy: 0.8,
      envMapIntensity: 1.3,
    })
  );

  const valveTitanium = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xd9d2c2,
      metalness: 0.94,
      roughness: 0.16,
      envMapIntensity: 1.25,
    })
  );

  const valveSpring = track(
    new THREE.MeshStandardMaterial({
      color: 0x3b414c,
      metalness: 0.88,
      roughness: 0.32,
    })
  );

  // Intake Runners / Velocity Stacks (Billet satin aluminum)
  const intakeRunner = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xd8dde6,
      metalness: 0.92,
      roughness: 0.22,
      bumpMap: textures.brushedMetalBump,
      bumpScale: 0.005,
      anisotropy: 0.7,
      envMapIntensity: 1.25,
    })
  );

  // Anodized Billet Fuel Rails (Changes with Finish Preset)
  const fuelRail = track(
    new THREE.MeshPhysicalMaterial({
      color: currentFinish.railColor,
      metalness: 0.88,
      roughness: 0.24,
      anisotropy: 0.8,
      clearcoat: 0.35,
      envMapIntensity: 1.25,
    })
  );

  const throttleBody = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xc8ced8,
      metalness: 0.86,
      roughness: 0.28,
      envMapIntensity: 1.15,
    })
  );

  const butterflyBrass = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xd4a952,
      metalness: 0.95,
      roughness: 0.18,
      envMapIntensity: 1.35,
    })
  );

  // 6-into-1 Inconel / Titanium Exhaust Headers with Thermal Iridescence
  const exhaustHeader = track(
    new THREE.MeshPhysicalMaterial({
      color: currentFinish.headerTint,
      map: textures.headerHeatAlbedo,
      bumpMap: textures.brushedMetalBump,
      bumpScale: 0.006,
      metalness: 0.94,
      roughness: 0.24,
      iridescence: currentFinish.headerIridescence,
      iridescenceIOR: 1.45,
      iridescenceThicknessRange: [180, 480],
      anisotropy: 0.65,
      envMapIntensity: 1.3,
    })
  );

  const exhaustFlange = track(
    new THREE.MeshStandardMaterial({
      color: 0x8e8378,
      metalness: 0.88,
      roughness: 0.38,
    })
  );

  // Cam Sprockets (Anodized Billet)
  const camSprocket = track(
    new THREE.MeshPhysicalMaterial({
      color: currentFinish.camGearColor,
      metalness: 0.88,
      roughness: 0.24,
      anisotropy: 0.85,
      clearcoat: 0.25,
      envMapIntensity: 1.3,
    })
  );

  // Kevlar Timing Belt (Matte elastomeric contrast!)
  const timingBelt = track(
    new THREE.MeshStandardMaterial({
      color: 0x191b20,
      metalness: 0.04,
      roughness: 0.86,
    })
  );

  // Fasteners & Bolts
  const fastenerChrome = track(
    new THREE.MeshStandardMaterial({
      color: 0xe2e6ee,
      metalness: 0.96,
      roughness: 0.15,
    })
  );

  // Ignition Coil Packs & Ceramic Insulators
  const coilPackDark = track(
    new THREE.MeshStandardMaterial({
      color: 0x1d2026,
      metalness: 0.12,
      roughness: 0.72,
    })
  );

  const sparkCeramic = track(
    new THREE.MeshStandardMaterial({
      color: 0xedeff2,
      metalness: 0.05,
      roughness: 0.22,
    })
  );

  const badgePlaque = track(
    new THREE.MeshStandardMaterial({
      map: textures.v12BadgeAlbedo,
      metalness: 0.65,
      roughness: 0.3,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );

  // Flywheel & Clutch
  const flywheelSteel = track(
    new THREE.MeshPhysicalMaterial({
      color: 0x7a828f,
      metalness: 0.92,
      roughness: 0.26,
      anisotropy: 0.75,
      envMapIntensity: 1.2,
    })
  );

  const clutchCover = track(
    new THREE.MeshPhysicalMaterial({
      color: 0x2a2e38,
      metalness: 0.78,
      roughness: 0.36,
      clearcoat: 0.2,
    })
  );

  // Showcase Dyno Cradle Stand
  const cradleAnodized = track(
    new THREE.MeshStandardMaterial({
      color: 0x1e2128,
      metalness: 0.72,
      roughness: 0.42,
    })
  );

  // 12 Independent Combustion Chamber Glow & Spark Materials
  const combustionMats: THREE.MeshBasicMaterial[] = [];
  const sparkMats: THREE.MeshBasicMaterial[] = [];
  for (let i = 0; i < 12; i++) {
    combustionMats.push(
      track(
        new THREE.MeshBasicMaterial({
          color: 0xff6a1a,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        })
      )
    );
    sparkMats.push(
      track(
        new THREE.MeshBasicMaterial({
          color: 0xfff7dc,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      )
    );
  }

  // Studio Turntable Plinth & Contact Shadow
  const floorPlinth = track(
    new THREE.MeshStandardMaterial({
      color: 0x15171d,
      map: textures.floorAlbedo,
      roughnessMap: textures.floorRoughness,
      metalness: 0.18,
      roughness: 0.68,
      envMapIntensity: 0.75,
    })
  );

  const floorRimAccent = track(
    new THREE.MeshStandardMaterial({
      color: 0x454a56,
      metalness: 0.85,
      roughness: 0.32,
    })
  );

  const contactShadow = track(
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      alphaMap: textures.contactShadowAlpha,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );

  const configureValveCoverMat = (mat: THREE.MeshPhysicalMaterial, preset: FinishPreset) => {
    mat.color.setHex(preset.valveCoverColor);
    if (preset.valveCoverMode === 'crinkle') {
      mat.map = null;
      mat.bumpMap = textures.crinkleBump;
      mat.bumpScale = 0.022;
      mat.roughnessMap = textures.crinkleRoughness;
      mat.metalness = 0.24;
      mat.roughness = 0.66;
      mat.clearcoat = 0.22;
      mat.clearcoatRoughness = 0.48;
      mat.anisotropy = 0;
    } else if (preset.valveCoverMode === 'carbon') {
      mat.color.setHex(0xffffff);
      mat.map = textures.carbonAlbedo;
      mat.bumpMap = textures.carbonBump;
      mat.bumpScale = 0.012;
      mat.roughnessMap = textures.carbonRoughness;
      mat.metalness = 0.14;
      mat.roughness = 0.22;
      mat.clearcoat = 1.0;
      mat.clearcoatRoughness = 0.07;
      mat.anisotropy = 0;
    } else {
      // Raw CNC billet aluminum
      mat.map = null;
      mat.bumpMap = textures.brushedMetalBump;
      mat.bumpScale = 0.008;
      mat.roughnessMap = textures.brushedMetalRoughness;
      mat.metalness = 0.94;
      mat.roughness = 0.22;
      mat.clearcoat = 0.15;
      mat.clearcoatRoughness = 0.2;
      mat.anisotropy = 0.85;
    }
    mat.needsUpdate = true;
  };

  const configurePlenumMat = (mat: THREE.MeshPhysicalMaterial, preset: FinishPreset) => {
    if (preset.plenumMode === 'cast-silver') {
      mat.color.setHex(preset.plenumTint);
      mat.map = null;
      mat.bumpMap = textures.castAlumBump;
      mat.bumpScale = 0.012;
      mat.roughnessMap = null;
      mat.metalness = 0.88;
      mat.roughness = 0.28;
      mat.clearcoat = 0.2;
      mat.clearcoatRoughness = 0.25;
    } else {
      mat.color.setHex(0xffffff);
      mat.map = textures.carbonAlbedo;
      mat.bumpMap = textures.carbonBump;
      mat.bumpScale = 0.012;
      mat.roughnessMap = textures.carbonRoughness;
      mat.metalness = 0.14;
      mat.roughness = preset.plenumMode === 'carbon-gloss' ? 0.22 : 0.42;
      mat.clearcoat = preset.plenumMode === 'carbon-gloss' ? 1.0 : 0.25;
      mat.clearcoatRoughness = preset.plenumMode === 'carbon-gloss' ? 0.08 : 0.38;
    }
    mat.needsUpdate = true;
  };

  const applyViewMode = (mode: ViewMode) => {
    currentMode = mode;

    // Reset all exterior housing materials to solid baseline first
    configureValveCoverMat(valveCoverSolid, currentFinish);
    configureValveCoverMat(valveCoverCutaway, currentFinish);
    configurePlenumMat(plenumSolid, currentFinish);
    configurePlenumMat(plenumCutaway, currentFinish);

    const resetSolid = (m: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial) => {
      m.transparent = false;
      m.opacity = 1;
      m.depthWrite = true;
      if ('transmission' in m) {
        m.transmission = 0;
      }
      m.needsUpdate = true;
    };

    resetSolid(valveCoverSolid);
    resetSolid(valveCoverCutaway);
    resetSolid(plenumSolid);
    resetSolid(plenumCutaway);
    resetSolid(blockSolid);
    resetSolid(blockCutaway);
    resetSolid(headSolid);
    resetSolid(headCutaway);
    resetSolid(drySump);

    blockSolid.color.setHex(currentFinish.blockTint);
    blockCutaway.color.setHex(currentFinish.blockTint);
    headSolid.color.setHex(0xcfd5dd);
    headCutaway.color.setHex(0xcfd5dd);
    drySump.color.setHex(0x3b4049);

    const makeArchitecturalGlass = (
      m: THREE.MeshPhysicalMaterial,
      tintHex: number,
      opacity: number
    ) => {
      m.map = null;
      m.bumpMap = null;
      m.roughnessMap = null;
      m.color.setHex(tintHex);
      m.metalness = 0.1;
      m.roughness = 0.12;
      m.clearcoat = 1.0;
      m.clearcoatRoughness = 0.06;
      m.transparent = true;
      m.opacity = opacity;
      m.depthWrite = false;
      // Avoid multi-pass transmission cost on software WebGL
      m.transmission = isSoftwareGl ? 0 : 0.25;
      m.needsUpdate = true;
    };

    const makeTranslucentStandard = (m: THREE.MeshStandardMaterial, tintHex: number, opacity: number) => {
      m.color.setHex(tintHex);
      m.transparent = true;
      m.opacity = opacity;
      m.depthWrite = false;
      m.roughness = 0.2;
      m.metalness = 0.3;
      m.needsUpdate = true;
    };

    if (mode === 'cutaway') {
      // Bank A (hero right bank facing 3/4 camera) becomes crystal-clear cutaway glass
      // while Bank B retains its full luxury studio configurator finish!
      makeArchitecturalGlass(valveCoverCutaway, 0xc8daf0, 0.14);
      makeArchitecturalGlass(plenumCutaway, 0xc8daf0, 0.16);
      makeArchitecturalGlass(headCutaway, 0xa8c2e0, 0.15);
      makeArchitecturalGlass(blockCutaway, 0x9ab4d4, 0.14);
    } else if (mode === 'xray') {
      // Full engineering X-Ray blueprint glass shell across both banks & sump
      makeArchitecturalGlass(valveCoverSolid, 0x7aa4d6, 0.12);
      makeArchitecturalGlass(valveCoverCutaway, 0x7aa4d6, 0.12);
      makeArchitecturalGlass(plenumSolid, 0x6f98cc, 0.12);
      makeArchitecturalGlass(plenumCutaway, 0x6f98cc, 0.12);
      makeArchitecturalGlass(headCutaway, 0x7ea6d8, 0.14);
      makeArchitecturalGlass(blockCutaway, 0x7ea6d8, 0.13);
      makeTranslucentStandard(headSolid, 0x7ea6d8, 0.14);
      makeTranslucentStandard(blockSolid, 0x7ea6d8, 0.13);
      makeTranslucentStandard(drySump, 0x5d7ca6, 0.15);
    }

    refreshEmissives();
  };

  const applyFinish = (finishId: FinishId) => {
    const preset = FINISH_PRESETS.find((f) => f.id === finishId) ?? FINISH_PRESETS[0];
    currentFinish = preset;
    fuelRail.color.setHex(preset.railColor);
    camSprocket.color.setHex(preset.camGearColor);
    exhaustHeader.color.setHex(preset.headerTint);
    exhaustHeader.iridescence = preset.headerIridescence;
    applyViewMode(currentMode);
  };

  const matLookup: Record<string, THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial> = {
    valveCoverSolid,
    valveCoverCutaway,
    plenumSolid,
    plenumCutaway,
    blockSolid,
    blockCutaway,
    headSolid,
    headCutaway,
    drySump,
    crankshaftSteel,
    pistonAluminum,
    conrodTitanium,
    boreLiner,
    camshaftSteel,
    valveTitanium,
    valveSpring,
    intakeRunner,
    fuelRail,
    throttleBody,
    exhaustHeader,
    exhaustFlange,
    camSprocket,
    timingBelt,
    flywheelSteel,
    clutchCover,
  };

  const refreshEmissives = () => {
    // Clear all component emissives first
    for (const m of Object.values(matLookup)) {
      m.emissive.setHex(0x000000);
      m.emissiveIntensity = 0;
    }

    // Re-apply exhaust thermal glow
    exhaustHeader.emissive.copy(currentHeatEmissive);
    exhaustHeader.emissiveIntensity = currentHeatIntensity;

    // Subtle hover highlight
    if (currentHovered && currentHovered !== currentSelected) {
      for (const key of COMPONENT_MATERIAL_KEYS[currentHovered]) {
        const m = matLookup[key as string];
        if (m) {
          m.emissive.setHex(0x3a5b88);
          m.emissiveIntensity = 0.32;
        }
      }
    }

    // Crisp selection highlight
    if (currentSelected) {
      for (const key of COMPONENT_MATERIAL_KEYS[currentSelected]) {
        const m = matLookup[key as string];
        if (m) {
          m.emissive.setHex(0xd94b2b);
          m.emissiveIntensity = 0.42;
        }
      }
    }
  };

  const updateExhaustHeat = (rpm: number, isThermalLab: boolean) => {
    // Thermal glow begins visibly past 5,800 RPM (earlier in Thermal Lab mode)
    const threshold = isThermalLab ? 3600 : 5800;
    const norm = Math.max(0, Math.min(1, (rpm - threshold) / (9500 - threshold)));
    const heat = Math.pow(norm, 1.85);
    if (heat > 0.005) {
      // Shift from deep cherry red to bright molten amber-orange
      currentHeatEmissive.setRGB(
        0.95 * heat,
        0.18 * heat + 0.24 * heat * heat,
        0.02 * heat * heat
      );
      currentHeatIntensity = heat * (isThermalLab ? 1.85 : 1.15);
    } else {
      currentHeatEmissive.setHex(0x000000);
      currentHeatIntensity = 0;
    }
    if (currentSelected !== 'exhaustHeaders' && currentHovered !== 'exhaustHeaders') {
      exhaustHeader.emissive.copy(currentHeatEmissive);
      exhaustHeader.emissiveIntensity = currentHeatIntensity;
    }
  };

  const setHighlight = (selected: ComponentId | null, hovered: ComponentId | null) => {
    if (selected === currentSelected && hovered === currentHovered) return;
    currentSelected = selected;
    currentHovered = hovered;
    refreshEmissives();
  };

  return {
    valveCoverSolid,
    valveCoverCutaway,
    plenumSolid,
    plenumCutaway,
    blockSolid,
    blockCutaway,
    headSolid,
    headCutaway,
    drySump,
    crankshaftSteel,
    pistonAluminum,
    pistonRingDark,
    conrodTitanium,
    boreLiner,
    camshaftSteel,
    valveTitanium,
    valveSpring,
    intakeRunner,
    fuelRail,
    throttleBody,
    butterflyBrass,
    exhaustHeader,
    exhaustFlange,
    camSprocket,
    timingBelt,
    fastenerChrome,
    coilPackDark,
    sparkCeramic,
    badgePlaque,
    flywheelSteel,
    clutchCover,
    cradleAnodized,
    combustionMats,
    sparkMats,
    floorPlinth,
    floorRimAccent,
    contactShadow,
    applyFinish,
    applyViewMode,
    updateExhaustHeat,
    setHighlight,
    dispose: () => {
      for (const m of allMaterials) m.dispose();
    },
  };
}
