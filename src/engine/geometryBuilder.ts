import * as THREE from 'three';
import { CYLINDER_CONFIGS, V12_GEO } from './kinematics';
import { EngineMaterialLibrary } from './materials';
import { ComponentId } from './types';

export interface ValveNode {
  stemGroup: THREE.Group;
  springMesh: THREE.Mesh;
  baseY: number;
}

export interface CylinderDynamicRig {
  index: number; // 0..11
  pistonGroup: THREE.Group;
  conrodGroup: THREE.Group;
  intakeValves: [ValveNode, ValveNode];
  exhaustValves: [ValveNode, ValveNode];
  combustionMesh: THREE.Mesh;
  sparkMesh: THREE.Mesh;
}

export interface ExplodableAssembly {
  group: THREE.Group;
  basePosition: THREE.Vector3;
  explodeOffset: THREE.Vector3;
}

export interface V12AssemblyRig {
  engineRoot: THREE.Group;
  crankshaftGroup: THREE.Group;
  flywheelSpinGroup: THREE.Group;
  frontCrankPulley: THREE.Group;
  camshaftSpinGroups: THREE.Group[]; // 4 cams: A-int, A-exh, B-int, B-exh
  camSprocketSpinGroups: THREE.Group[]; // 4 front sprockets
  idlerSpinGroups: THREE.Group[];
  throttleButterflies: THREE.Mesh[];
  cylinderRigs: CylinderDynamicRig[];
  explodables: ExplodableAssembly[];
  selectableMeshes: THREE.Object3D[];
  dispose: () => void;
}

/**
 * Helper to tag all descendant meshes with a ComponentId for raycasting inspection
 * and shadow settings.
 */
function tagAssembly(
  root: THREE.Object3D,
  componentId: ComponentId,
  selectableOut: THREE.Object3D[],
  castShadow = true,
  receiveShadow = true
) {
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      mesh.userData.componentId = componentId;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      selectableOut.push(mesh);
    }
  });
}

/**
 * Creates a teardrop/knife-edge crankshaft counterweight via ExtrudeGeometry.
 */
function createCounterweightGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  // Fan counterweight opposite crankpin (which sits at +Y) -> counterweight bulges toward -Y
  shape.moveTo(-0.22, 0.22);
  shape.quadraticCurveTo(0, 0.56, 0.22, 0.22);
  shape.lineTo(0.46, -0.34);
  shape.absarc(0, -0.14, 0.68, -0.32, -Math.PI + 0.32, true);
  shape.lineTo(-0.22, 0.22);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.16,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.022,
    bevelSegments: 2,
    curveSegments: 20,
  });
  geo.translate(0, 0, -0.08);
  return geo;
}

/**
 * Creates a machined H-beam connecting rod geometry centered with big-end at (0,0,0)
 * and small-end wrist pin eye at (0, CONROD_LENGTH, 0).
 */
function createConrodGeometry(): THREE.ExtrudeGeometry {
  const L = V12_GEO.CONROD_LENGTH;
  const shape = new THREE.Shape();
  // Outer silhouette of connecting rod
  shape.moveTo(-0.26, -0.18);
  shape.absarc(0, 0, 0.29, Math.PI + 0.55, -0.55, false);
  shape.lineTo(0.11, 0.32);
  shape.lineTo(0.082, L - 0.16);
  shape.absarc(0, L, 0.145, -0.45, Math.PI + 0.45, false);
  shape.lineTo(-0.082, L - 0.16);
  shape.lineTo(-0.11, 0.32);
  shape.closePath();

  // Big-end bore hole
  const bigHole = new THREE.Path();
  bigHole.absarc(0, 0, 0.185, 0, Math.PI * 2, true);
  shape.holes.push(bigHole);

  // Small-end wrist pin hole
  const smallHole = new THREE.Path();
  smallHole.absarc(0, L, 0.082, 0, Math.PI * 2, true);
  shape.holes.push(smallHole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.11,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.014,
    bevelSegments: 2,
    curveSegments: 16,
  });
  geo.translate(0, 0, -0.055);
  return geo;
}

/**
 * Creates a sculpted forged aluminum piston profile via LatheGeometry.
 * Local origin Y=0 is the wrist pin axis.
 */
function createPistonGeometry(): THREE.LatheGeometry {
  const r = V12_GEO.BORE_RADIUS * 0.965;
  const hCrown = V12_GEO.PISTON_CROWN_H;
  const hSkirt = V12_GEO.PISTON_SKIRT_H;
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(r * 0.84, -hSkirt),
    new THREE.Vector2(r, -hSkirt),
    new THREE.Vector2(r, 0.06),
    // Ring lands (3 machined grooves)
    new THREE.Vector2(r * 0.92, 0.08),
    new THREE.Vector2(r * 0.92, 0.11),
    new THREE.Vector2(r, 0.12),
    new THREE.Vector2(r, 0.155),
    new THREE.Vector2(r * 0.92, 0.165),
    new THREE.Vector2(r * 0.92, 0.195),
    new THREE.Vector2(r, 0.205),
    new THREE.Vector2(r, 0.24),
    new THREE.Vector2(r * 0.92, 0.25),
    new THREE.Vector2(r * 0.92, 0.275),
    new THREE.Vector2(r, 0.285),
    // Chamfered high-compression crown dome
    new THREE.Vector2(r * 0.95, hCrown),
    new THREE.Vector2(r * 0.64, hCrown + 0.045),
    new THREE.Vector2(r * 0.32, hCrown + 0.052),
    new THREE.Vector2(0, hCrown + 0.042),
  ];
  return new THREE.LatheGeometry(pts, 28);
}

/**
 * Creates an authentic egg-shaped camshaft lobe via ExtrudeGeometry.
 * Nose points along +Y so rotation directly controls valve actuation phase.
 */
function createCamLobeGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const baseR = 0.095;
  const noseLift = 0.085;
  const segs = 28;
  for (let i = 0; i <= segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    // Smooth lobe lift concentrated around angle = PI/2 (+Y nose)
    const angDiff = Math.atan2(Math.sin(t - Math.PI / 2), Math.cos(t - Math.PI / 2));
    const lift = Math.abs(angDiff) < 0.95 ? noseLift * Math.pow(Math.cos((angDiff / 0.95) * (Math.PI / 2)), 2) : 0;
    const rad = baseR + lift;
    const x = Math.cos(t) * rad;
    const y = Math.sin(t) * rad;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.085,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 2,
  });
  geo.translate(0, 0, -0.0425);
  return geo;
}

/**
 * Creates a progressive helical valve spring via TubeGeometry.
 */
function createHelicalSpringGeometry(): THREE.TubeGeometry {
  const pts: THREE.Vector3[] = [];
  const turns = 5.5;
  const height = 0.36;
  const radius = 0.068;
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const a = u * turns * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, u * height, Math.sin(a) * radius));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.TubeGeometry(curve, 64, 0.012, 6, false);
}

/**
 * Creates a tulip intake/exhaust valve (head + stem) via LatheGeometry.
 * Tip is at Y = +0.58 (cam side), valve disc is at Y = 0 (combustion face).
 */
function createValveGeometry(headRadius: number): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(headRadius, 0.015),
    new THREE.Vector2(headRadius * 0.96, 0.038),
    new THREE.Vector2(headRadius * 0.34, 0.085),
    new THREE.Vector2(0.022, 0.14),
    new THREE.Vector2(0.022, 0.62),
    new THREE.Vector2(0.048, 0.62),
    new THREE.Vector2(0.048, 0.65),
    new THREE.Vector2(0, 0.65),
  ];
  return new THREE.LatheGeometry(pts, 18);
}

/**
 * Creates a contoured DOHC valve cover profile extruded along the length of the bank.
 */
function createValveCoverGeometry(length: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  // Cross-section in bank-local XY (width ~1.48, height ~0.58 with twin-cam humps)
  shape.moveTo(-0.74, 0);
  shape.lineTo(-0.74, 0.16);
  shape.quadraticCurveTo(-0.72, 0.48, -0.44, 0.50);
  shape.lineTo(-0.22, 0.50);
  shape.quadraticCurveTo(-0.14, 0.36, 0, 0.36); // central spark-plug valley
  shape.quadraticCurveTo(0.14, 0.36, 0.22, 0.50);
  shape.lineTo(0.44, 0.50);
  shape.quadraticCurveTo(0.72, 0.48, 0.74, 0.16);
  shape.lineTo(0.74, 0);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: length,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.05,
    bevelSegments: 3,
    curveSegments: 16,
  });
  geo.translate(0, 0, -length / 2);
  return geo;
}

/**
 * Creates a tapered, sculpted carbon-fiber intake plenum chamber.
 */
function createPlenumGeometry(length: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  // Aerodynamic teardrop-oval cross-section
  shape.moveTo(-0.46, 0);
  shape.quadraticCurveTo(-0.56, 0.38, -0.32, 0.64);
  shape.quadraticCurveTo(0, 0.78, 0.32, 0.64);
  shape.quadraticCurveTo(0.56, 0.38, 0.46, 0);
  shape.quadraticCurveTo(0, -0.10, -0.46, 0);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: length,
    bevelEnabled: true,
    bevelThickness: 0.14,
    bevelSize: 0.09,
    bevelSegments: 4,
    curveSegments: 18,
  });
  geo.translate(0, 0, -length / 2);
  return geo;
}

/**
 * Creates a spoked motorsport camshaft sprocket wheel.
 */
function createSpokedSprocketGroup(
  outerR: number,
  thickness: number,
  gearMat: THREE.Material,
  hubMat: THREE.Material,
  boltMat: THREE.Material,
  geosToDispose: THREE.BufferGeometry[]
): THREE.Group {
  const g = new THREE.Group();
  const trackG = <T extends THREE.BufferGeometry>(geo: T): T => {
    geosToDispose.push(geo);
    return geo;
  };

  // Outer toothed rim
  const rimShape = new THREE.Shape();
  const teeth = 36;
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const rad = i % 2 === 0 ? outerR : outerR - 0.032;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (i === 0) rimShape.moveTo(x, y);
    else rimShape.lineTo(x, y);
  }
  rimShape.closePath();
  const innerCut = new THREE.Path();
  innerCut.absarc(0, 0, outerR * 0.76, 0, Math.PI * 2, true);
  rimShape.holes.push(innerCut);

  const rimGeo = trackG(
    new THREE.ExtrudeGeometry(rimShape, {
      depth: thickness,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.01,
      bevelSegments: 1,
    })
  );
  rimGeo.translate(0, 0, -thickness / 2);
  g.add(new THREE.Mesh(rimGeo, gearMat));

  // Center hub
  const hubGeo = trackG(new THREE.CylinderGeometry(outerR * 0.34, outerR * 0.34, thickness * 1.25, 20));
  hubGeo.rotateX(Math.PI / 2);
  g.add(new THREE.Mesh(hubGeo, hubMat));

  // 5 machined lightweight spokes
  const spokeGeo = trackG(new THREE.BoxGeometry(outerR * 0.12, outerR * 0.62, thickness * 0.72));
  for (let s = 0; s < 5; s++) {
    const a = (s / 5) * Math.PI * 2;
    const sp = new THREE.Mesh(spokeGeo, gearMat);
    sp.position.set(Math.cos(a) * outerR * 0.5, Math.sin(a) * outerR * 0.5, 0);
    sp.rotation.z = a - Math.PI / 2;
    g.add(sp);
  }

  // 5 phase-adjuster bolts around hub
  const boltGeo = trackG(new THREE.CylinderGeometry(0.022, 0.022, thickness * 1.45, 6));
  boltGeo.rotateX(Math.PI / 2);
  for (let b = 0; b < 5; b++) {
    const a = (b / 5) * Math.PI * 2 + 0.3;
    const bolt = new THREE.Mesh(boltGeo, boltMat);
    bolt.position.set(Math.cos(a) * outerR * 0.22, Math.sin(a) * outerR * 0.22, 0);
    g.add(bolt);
  }

  return g;
}

/**
 * Builds the entire museum-grade 6.5L 60° V12 engine assembly with accurate kinematics hooks,
 * cutaway-ready Bank A shells, equal-length 6-into-1 Inconel headers, and exploded-view vectors.
 */
export function buildV12Engine(materials: EngineMaterialLibrary): V12AssemblyRig {
  const geometries: THREE.BufferGeometry[] = [];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };

  const selectableMeshes: THREE.Object3D[] = [];
  const explodables: ExplodableAssembly[] = [];

  const registerExplodable = (group: THREE.Group, offset: [number, number, number]) => {
    explodables.push({
      group,
      basePosition: group.position.clone(),
      explodeOffset: new THREE.Vector3(offset[0], offset[1], offset[2]),
    });
  };

  const engineRoot = new THREE.Group();
  engineRoot.position.set(0, 1.92, 0); // Crank centerline elevated cleanly on showcase dyno cradle

  const halfV = V12_GEO.BANK_ANGLE_RAD;
  const sinV = Math.sin(halfV); // 0.5
  const cosV = Math.cos(halfV); // 0.8660254
  const bankLen = 7.05;

  // Shared reusable geometries
  const hexBoltGeo = trackGeo(new THREE.CylinderGeometry(0.032, 0.032, 0.055, 6));
  const smallBoltGeo = trackGeo(new THREE.CylinderGeometry(0.024, 0.024, 0.045, 6));

  // =========================================================================
  // 1. SHOWCASE DYNO CRADLE STAND (Grounds the V12 cleanly onto the plinth y=0)
  // =========================================================================
  const cradleGroup = new THREE.Group();
  const basePlateGeo = trackGeo(new THREE.BoxGeometry(2.65, 0.12, 6.2));
  const basePlate = new THREE.Mesh(basePlateGeo, materials.cradleAnodized);
  basePlate.position.set(0, -1.86, 0); // sits flush at world y = 0.06
  basePlate.castShadow = true;
  basePlate.receiveShadow = true;
  cradleGroup.add(basePlate);

  // 4 sculpted CNC billet A-frame uprights bolting into lower block side bosses
  const legGeo = trackGeo(new THREE.BoxGeometry(0.18, 1.52, 0.34));
  const gussetGeo = trackGeo(new THREE.BoxGeometry(0.12, 0.92, 0.22));
  const legPositions: [number, number][] = [
    [-1.08, 2.35],
    [1.08, 2.35],
    [-1.08, -2.35],
    [1.08, -2.35],
  ];
  for (const [lx, lz] of legPositions) {
    const leg = new THREE.Mesh(legGeo, materials.cradleAnodized);
    leg.position.set(lx * 0.92, -1.12, lz);
    leg.rotation.z = lx > 0 ? 0.14 : -0.14;
    leg.castShadow = true;
    leg.receiveShadow = true;
    cradleGroup.add(leg);

    const gusset = new THREE.Mesh(gussetGeo, materials.fastenerChrome);
    gusset.position.set(lx * 0.78, -1.34, lz);
    gusset.rotation.z = lx > 0 ? -0.35 : 0.35;
    cradleGroup.add(gusset);
  }
  // Cross tie bars
  const tieBarGeo = trackGeo(new THREE.CylinderGeometry(0.055, 0.055, 2.1, 14));
  tieBarGeo.rotateZ(Math.PI / 2);
  for (const tz of [2.35, -2.35]) {
    const tie = new THREE.Mesh(tieBarGeo, materials.fastenerChrome);
    tie.position.set(0, -1.52, tz);
    cradleGroup.add(tie);
  }
  engineRoot.add(cradleGroup);

  // =========================================================================
  // 2. DRY-SUMP OIL PAN (Explodes straight downward)
  // =========================================================================
  const drySumpGroup = new THREE.Group();
  const sumpMainGeo = trackGeo(new THREE.BoxGeometry(1.82, 0.44, 6.9));
  const sumpMain = new THREE.Mesh(sumpMainGeo, materials.drySump);
  sumpMain.position.set(0, -0.96, 0);
  drySumpGroup.add(sumpMain);

  const sumpFlangeGeo = trackGeo(new THREE.BoxGeometry(2.14, 0.10, 7.18));
  const sumpFlange = new THREE.Mesh(sumpFlangeGeo, materials.drySump);
  sumpFlange.position.set(0, -0.72, 0);
  drySumpGroup.add(sumpFlange);

  // 9 longitudinal cooling fins underneath dry sump
  const finGeo = trackGeo(new THREE.BoxGeometry(0.055, 0.12, 6.72));
  for (let f = -4; f <= 4; f++) {
    const fin = new THREE.Mesh(finGeo, materials.drySump);
    fin.position.set(f * 0.19, -1.21, 0);
    drySumpGroup.add(fin);
  }

  // Side dry-sump scavenge fittings
  const fittingGeo = trackGeo(new THREE.CylinderGeometry(0.09, 0.09, 0.24, 12));
  fittingGeo.rotateZ(Math.PI / 2);
  for (const fz of [1.8, 0.0, -1.8]) {
    const fit = new THREE.Mesh(fittingGeo, materials.fuelRail);
    fit.position.set(1.02, -0.98, fz);
    drySumpGroup.add(fit);
  }

  // Instanced sump perimeter bolts
  const sumpBoltInst = new THREE.InstancedMesh(smallBoltGeo, materials.fastenerChrome, 24);
  const dummy = new THREE.Object3D();
  let bIdx = 0;
  for (let i = 0; i < 12; i++) {
    const bz = -3.3 + (i / 11) * 6.6;
    dummy.position.set(0.98, -0.78, bz);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    sumpBoltInst.setMatrixAt(bIdx++, dummy.matrix);
    dummy.position.set(-0.98, -0.78, bz);
    dummy.updateMatrix();
    sumpBoltInst.setMatrixAt(bIdx++, dummy.matrix);
  }
  sumpBoltInst.computeBoundingSphere();
  drySumpGroup.add(sumpBoltInst);

  tagAssembly(drySumpGroup, 'drySump', selectableMeshes);
  registerExplodable(drySumpGroup, [0, -1.55, 0]);
  engineRoot.add(drySumpGroup);

  // =========================================================================
  // 3. 60° V12 ENGINE BLOCK, MAIN WEBS & 12 HONED BORE LINERS
  // =========================================================================
  const blockGroup = new THREE.Group();

  // Lower crankcase skirt & 7 main bearing saddles (always structural aluminum, becomes X-Ray glass in xray)
  const webShape = new THREE.Shape();
  webShape.moveTo(-0.96, -0.66);
  webShape.lineTo(0.96, -0.66);
  webShape.lineTo(1.18, 0.34);
  webShape.lineTo(0.55, 0.86);
  webShape.lineTo(-0.55, 0.86);
  webShape.lineTo(-1.18, 0.34);
  webShape.closePath();
  const crankHole = new THREE.Path();
  crankHole.absarc(0, 0, 0.29, 0, Math.PI * 2, true);
  webShape.holes.push(crankHole);

  const webGeo = trackGeo(
    new THREE.ExtrudeGeometry(webShape, {
      depth: 0.22,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.02,
      bevelSegments: 1,
    })
  );
  webGeo.translate(0, 0, -0.11);

  const mainWebZ = [3.42, 2.28, 1.14, 0, -1.14, -2.28, -3.42];
  for (const wz of mainWebZ) {
    const web = new THREE.Mesh(webGeo, materials.blockSolid);
    web.position.set(0, 0, wz);
    blockGroup.add(web);
  }

  // Crankcase outer lower walls (Left solid, Right cutaway-aware)
  const skirtWallGeo = trackGeo(new THREE.BoxGeometry(0.14, 0.96, 7.02));
  const skirtB = new THREE.Mesh(skirtWallGeo, materials.blockSolid);
  skirtB.position.set(-0.98, -0.18, 0);
  blockGroup.add(skirtB);

  const skirtA = new THREE.Mesh(skirtWallGeo, materials.blockCutaway);
  skirtA.position.set(0.98, -0.18, 0);
  skirtA.renderOrder = 2;
  blockGroup.add(skirtA);

  // Cylinder Bank Housings (Bank A uses blockCutaway so cutaway exposes pistons & combustion!)
  const buildBankJacket = (bankSign: 1 | -1, mat: THREE.Material) => {
    const bGroup = new THREE.Group();
    bGroup.rotation.z = -bankSign * halfV;

    // Outer deck plates & side water jacket walls (hollow inside so bores & pistons are crystal clear!)
    const sideWallGeo = trackGeo(new THREE.BoxGeometry(0.14, 1.48, bankLen));
    const outerWall = new THREE.Mesh(sideWallGeo, mat);
    outerWall.position.set(bankSign * 0.56, 1.48, 0);
    outerWall.renderOrder = bankSign > 0 ? 3 : 1;
    bGroup.add(outerWall);

    const innerWall = new THREE.Mesh(sideWallGeo, mat);
    innerWall.position.set(-bankSign * 0.56, 1.48, 0);
    innerWall.renderOrder = bankSign > 0 ? 3 : 1;
    bGroup.add(innerWall);

    // Front & rear block end bulkheads
    const endWallGeo = trackGeo(new THREE.BoxGeometry(1.24, 1.48, 0.22));
    for (const ez of [bankLen / 2 - 0.11, -bankLen / 2 + 0.11]) {
      const ew = new THREE.Mesh(endWallGeo, mat);
      ew.position.set(0, 1.48, ez);
      ew.renderOrder = bankSign > 0 ? 3 : 1;
      bGroup.add(ew);
    }

    // Sculpted external horizontal stiffening ribs along outer block flank
    const ribGeo = trackGeo(new THREE.BoxGeometry(0.08, 0.08, bankLen - 0.24));
    for (const ry of [1.05, 1.42, 1.79, 2.08]) {
      const rib = new THREE.Mesh(ribGeo, mat);
      rib.position.set(bankSign * 0.65, ry, 0);
      bGroup.add(rib);
    }

    // Core freeze plugs on outer block side
    const plugGeo = trackGeo(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 18));
    plugGeo.rotateZ(Math.PI / 2);
    for (const pz of [2.28, 0, -2.28]) {
      const plug = new THREE.Mesh(plugGeo, materials.butterflyBrass);
      plug.position.set(bankSign * 0.65, 1.56, pz);
      bGroup.add(plug);
    }

    // Deck flange lip with bore holes? We create inter-bore deck bridges + perimeter deck rails
    const deckRailGeo = trackGeo(new THREE.BoxGeometry(0.24, 0.14, bankLen));
    for (const dx of [-0.52, 0.52]) {
      const dr = new THREE.Mesh(deckRailGeo, mat);
      dr.position.set(dx, V12_GEO.DECK_DIST - 0.07, 0);
      bGroup.add(dr);
    }

    return bGroup;
  };

  blockGroup.add(buildBankJacket(1, materials.blockCutaway));
  blockGroup.add(buildBankJacket(-1, materials.blockSolid));

  // 12 Honed Cylinder Bore Liners (Bank A uses partial cutaway C-section sleeves so pistons stay visible!)
  const fullLinerGeo = trackGeo(
    new THREE.CylinderGeometry(V12_GEO.BORE_RADIUS + 0.03, V12_GEO.BORE_RADIUS + 0.03, 1.42, 24, 1, true)
  );
  // Bank A cutaway sleeve shows back 220° of bore so front pistons shine clearly in Cutaway mode
  const cutawayLinerGeo = trackGeo(
    new THREE.CylinderGeometry(
      V12_GEO.BORE_RADIUS + 0.03,
      V12_GEO.BORE_RADIUS + 0.03,
      1.42,
      20,
      1,
      true,
      Math.PI * 0.62,
      Math.PI * 1.18
    )
  );

  for (const cfg of CYLINDER_CONFIGS) {
    const liner = new THREE.Mesh(
      cfg.bank === 'A' ? cutawayLinerGeo : fullLinerGeo,
      materials.boreLiner
    );
    const sMid = 1.52;
    liner.position.set(cfg.bankSign * sinV * sMid, cosV * sMid, cfg.zPos);
    liner.rotation.z = -cfg.bankSign * halfV;
    blockGroup.add(liner);
  }

  tagAssembly(blockGroup, 'engineBlock', selectableMeshes);
  engineRoot.add(blockGroup);

  // =========================================================================
  // 4. FORGED 6-THROW CRANKSHAFT (Rotates at 1x engine speed)
  // =========================================================================
  const crankExplodeGroup = new THREE.Group();
  const crankshaftGroup = new THREE.Group();
  crankExplodeGroup.add(crankshaftGroup);

  const mainJournalGeo = trackGeo(new THREE.CylinderGeometry(0.24, 0.24, 0.44, 24));
  mainJournalGeo.rotateX(Math.PI / 2);

  for (const mz of mainWebZ) {
    const mj = new THREE.Mesh(mainJournalGeo, materials.crankshaftSteel);
    mj.position.set(0, 0, mz);
    crankshaftGroup.add(mj);
  }

  // Front crank snout & rear flange
  const snoutGeo = trackGeo(new THREE.CylinderGeometry(0.17, 0.19, 0.96, 20));
  snoutGeo.rotateX(Math.PI / 2);
  const snout = new THREE.Mesh(snoutGeo, materials.crankshaftSteel);
  snout.position.set(0, 0, 3.88);
  crankshaftGroup.add(snout);

  const rearFlangeGeo = trackGeo(new THREE.CylinderGeometry(0.42, 0.34, 0.28, 24));
  rearFlangeGeo.rotateX(Math.PI / 2);
  const rearFlange = new THREE.Mesh(rearFlangeGeo, materials.crankshaftSteel);
  rearFlange.position.set(0, 0, -3.72);
  crankshaftGroup.add(rearFlange);

  // 6 Crankpins + 12 Sculpted Counterweight Webs
  const crankpinGeo = trackGeo(new THREE.CylinderGeometry(0.185, 0.185, 0.56, 22));
  crankpinGeo.rotateX(Math.PI / 2);
  const cwGeo = trackGeo(createCounterweightGeometry());

  for (let p = 0; p < 6; p++) {
    const pz = V12_GEO.PIN_Z[p];
    const throwRad = (V12_GEO.THROW_DEG[p] * Math.PI) / 180;
    const pinGroup = new THREE.Group();
    pinGroup.position.set(0, 0, pz);
    // Align throw angle with kinematics convention: at crankRad=0, worldPinAngle = -halfV + throwRad
    pinGroup.rotation.z = -halfV + throwRad;

    const pin = new THREE.Mesh(crankpinGeo, materials.crankshaftSteel);
    pin.position.set(0, V12_GEO.CRANK_RADIUS, 0);
    pinGroup.add(pin);

    // Pair of knife-edged counterweights flanking each shared crankpin
    for (const cwOffset of [-0.36, 0.36]) {
      const cw = new THREE.Mesh(cwGeo, materials.crankshaftSteel);
      cw.position.set(0, 0, cwOffset);
      pinGroup.add(cw);
    }
    crankshaftGroup.add(pinGroup);
  }

  tagAssembly(crankExplodeGroup, 'crankshaft', selectableMeshes);
  registerExplodable(crankExplodeGroup, [0, -0.72, 0]);
  engineRoot.add(crankExplodeGroup);

  // =========================================================================
  // 5. 12 FORGED PISTONS, TITANIUM H-RODS & COMBUSTION VOLUMES
  // =========================================================================
  const pistonsExplodeGroup = new THREE.Group();
  const pistonGeo = trackGeo(createPistonGeometry());
  const ringGeo = trackGeo(new THREE.TorusGeometry(V12_GEO.BORE_RADIUS * 0.96, 0.013, 8, 28));
  ringGeo.rotateX(Math.PI / 2);
  const wristPinGeo = trackGeo(new THREE.CylinderGeometry(0.08, 0.08, V12_GEO.BORE_RADIUS * 1.65, 16));
  wristPinGeo.rotateX(Math.PI / 2);
  const conrodGeo = trackGeo(createConrodGeometry());
  const rodCapBoltGeo = trackGeo(new THREE.CylinderGeometry(0.025, 0.025, 0.24, 8));
  const combustionGeo = trackGeo(new THREE.CylinderGeometry(V12_GEO.BORE_RADIUS * 0.9, V12_GEO.BORE_RADIUS * 0.9, 1.0, 20));
  const sparkGeo = trackGeo(new THREE.SphereGeometry(0.11, 12, 10));

  const cylinderRigs: CylinderDynamicRig[] = [];

  for (const cfg of CYLINDER_CONFIGS) {
    // Piston assembly
    const pistonGroup = new THREE.Group();
    pistonGroup.rotation.z = -cfg.bankSign * halfV;

    const pistonMesh = new THREE.Mesh(pistonGeo, materials.pistonAluminum);
    pistonGroup.add(pistonMesh);

    // 3 piston rings
    for (const ry of [0.095, 0.18, 0.262]) {
      const ring = new THREE.Mesh(ringGeo, materials.pistonRingDark);
      ring.position.y = ry;
      pistonGroup.add(ring);
    }

    // Wrist pin
    const wPin = new THREE.Mesh(wristPinGeo, materials.crankshaftSteel);
    pistonGroup.add(wPin);

    pistonsExplodeGroup.add(pistonGroup);

    // Connecting rod assembly
    const conrodGroup = new THREE.Group();
    const rodMesh = new THREE.Mesh(conrodGeo, materials.conrodTitanium);
    conrodGroup.add(rodMesh);

    // Big-end cap bolts
    for (const bx of [-0.24, 0.24]) {
      const bolt = new THREE.Mesh(rodCapBoltGeo, materials.fastenerChrome);
      bolt.position.set(bx, -0.06, 0);
      conrodGroup.add(bolt);
    }
    pistonsExplodeGroup.add(conrodGroup);

    // Combustion chamber glow mesh (tracks clearance volume dynamically)
    const combMesh = new THREE.Mesh(combustionGeo, materials.combustionMats[cfg.index]);
    combMesh.rotation.z = -cfg.bankSign * halfV;
    combMesh.renderOrder = 4;
    combMesh.castShadow = false;
    combMesh.receiveShadow = false;
    engineRoot.add(combMesh);

    // Spark plug ignition arc flash right below pent-roof chamber
    const sparkMesh = new THREE.Mesh(sparkGeo, materials.sparkMats[cfg.index]);
    const sparkS = V12_GEO.DECK_DIST - 0.05;
    sparkMesh.position.set(cfg.bankSign * sinV * sparkS, cosV * sparkS, cfg.zPos);
    sparkMesh.renderOrder = 5;
    sparkMesh.castShadow = false;
    sparkMesh.receiveShadow = false;
    engineRoot.add(sparkMesh);

    cylinderRigs.push({
      index: cfg.index,
      pistonGroup,
      conrodGroup,
      intakeValves: null as unknown as [ValveNode, ValveNode],
      exhaustValves: null as unknown as [ValveNode, ValveNode],
      combustionMesh: combMesh,
      sparkMesh,
    });
  }

  tagAssembly(pistonsExplodeGroup, 'pistons', selectableMeshes);
  // Pistons stay synced with crank in assembled, lift subtly upward on explode so internals float cleanly
  registerExplodable(pistonsExplodeGroup, [0, 0.12, 0]);
  engineRoot.add(pistonsExplodeGroup);

  // =========================================================================
  // 6. CYLINDER HEADS, 48-VALVE DOHC VALVETRAIN & SCULPTED VALVE COVERS
  // =========================================================================
  const camshaftSpinGroups: THREE.Group[] = [];
  const camLobeGeo = trackGeo(createCamLobeGeometry());
  const intakeValveGeo = trackGeo(createValveGeometry(0.145));
  const exhaustValveGeo = trackGeo(createValveGeometry(0.125));
  const springGeo = trackGeo(createHelicalSpringGeometry());
  const valveCoverGeo = trackGeo(createValveCoverGeometry(bankLen + 0.08));
  const coilBodyGeo = trackGeo(new THREE.CylinderGeometry(0.085, 0.075, 0.42, 12));
  const sparkPlugGeo = trackGeo(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 10));
  const headBaseGeo = trackGeo(new THREE.BoxGeometry(1.42, 0.78, bankLen));
  const badgeGeo = trackGeo(new THREE.PlaneGeometry(3.2, 0.42));

  const buildBankUpperAssembly = (bank: 'A' | 'B') => {
    const bankSign: 1 | -1 = bank === 'A' ? 1 : -1;
    const isCutaway = bank === 'A';
    const bankCyls = CYLINDER_CONFIGS.filter((c) => c.bank === bank);

    // Explode direction perpendicular to V-bank axis
    const exX = bankSign * sinV;
    const exY = cosV;

    // 6A. CYLINDER HEAD
    const headGroup = new THREE.Group();
    headGroup.rotation.z = -bankSign * halfV;
    headGroup.position.set(bankSign * sinV * V12_GEO.DECK_DIST, cosV * V12_GEO.DECK_DIST, 0);

    // Side & top head structure (leaving center chamber clear for cutaway visibility)
    if (isCutaway) {
      // Sculpted hollow cutaway head shell so valves & springs are razor-sharp inside
      const headShell = new THREE.Mesh(headBaseGeo, materials.headCutaway);
      headShell.position.set(0, 0.40, 0);
      headShell.renderOrder = 3;
      headGroup.add(headShell);
    } else {
      const headBlock = new THREE.Mesh(headBaseGeo, materials.headSolid);
      headBlock.position.set(0, 0.40, 0);
      headGroup.add(headBlock);
    }

    // Exhaust & Intake port boss castings along head flanks
    const portBossGeo = trackGeo(new THREE.CylinderGeometry(0.18, 0.21, 0.22, 16));
    portBossGeo.rotateZ(Math.PI / 2);
    for (const cfg of bankCyls) {
      const exhBoss = new THREE.Mesh(portBossGeo, isCutaway ? materials.headCutaway : materials.headSolid);
      exhBoss.position.set(bankSign * 0.72, 0.34, cfg.zPos);
      headGroup.add(exhBoss);

      const intBoss = new THREE.Mesh(portBossGeo, isCutaway ? materials.headCutaway : materials.headSolid);
      intBoss.position.set(-bankSign * 0.72, 0.48, cfg.zPos);
      headGroup.add(intBoss);
    }

    // 6 Central Ignition Coils & Spark Plugs
    for (const cfg of bankCyls) {
      const sparkIns = new THREE.Mesh(sparkPlugGeo, materials.sparkCeramic);
      sparkIns.position.set(0, 0.32, cfg.zPos);
      headGroup.add(sparkIns);

      const coil = new THREE.Mesh(coilBodyGeo, materials.coilPackDark);
      coil.position.set(0, 0.82, cfg.zPos);
      headGroup.add(coil);
    }

    tagAssembly(headGroup, 'cylinderHeads', selectableMeshes);
    registerExplodable(headGroup, [exX * 0.95, exY * 0.95, 0]);
    engineRoot.add(headGroup);

    // 6B. DOHC VALVETRAIN (2 Camshafts + 24 Valves + 24 Helical Springs per bank!)
    const valvetrainGroup = new THREE.Group();
    valvetrainGroup.rotation.z = -bankSign * halfV;
    valvetrainGroup.position.set(bankSign * sinV * V12_GEO.DECK_DIST, cosV * V12_GEO.DECK_DIST, 0);

    // Intake cam sits toward V-valley (-bankSign * 0.40), Exhaust cam toward outside (+bankSign * 0.40)
    const intCamX = -bankSign * 0.40;
    const exhCamX = bankSign * 0.40;
    const camY = 0.96;

    const camShaftBarGeo = trackGeo(new THREE.CylinderGeometry(0.085, 0.085, bankLen + 0.35, 18));
    camShaftBarGeo.rotateX(Math.PI / 2);

    const intakeCamSpin = new THREE.Group();
    intakeCamSpin.position.set(intCamX, camY, 0);
    intakeCamSpin.add(new THREE.Mesh(camShaftBarGeo, materials.camshaftSteel));

    const exhaustCamSpin = new THREE.Group();
    exhaustCamSpin.position.set(exhCamX, camY, 0);
    exhaustCamSpin.add(new THREE.Mesh(camShaftBarGeo, materials.camshaftSteel));

    const camBearingCapGeo = trackGeo(new THREE.BoxGeometry(0.28, 0.16, 0.14));
    for (const mz of mainWebZ) {
      const capI = new THREE.Mesh(camBearingCapGeo, materials.headSolid);
      capI.position.set(intCamX, camY + 0.04, mz);
      valvetrainGroup.add(capI);
      const capE = new THREE.Mesh(camBearingCapGeo, materials.headSolid);
      capE.position.set(exhCamX, camY + 0.04, mz);
      valvetrainGroup.add(capE);
    }

    // Build 4 valves + 4 cam lobes per cylinder (exact phase alignment!)
    for (const cfg of bankCyls) {
      const rig = cylinderRigs[cfg.index];
      const intakeNodes: ValveNode[] = [];
      const exhaustNodes: ValveNode[] = [];

      // Peak intake lift occurs at cycleDeg ≈ 458° -> cam angle = (firing + 458) / 2
      // Peak exhaust lift occurs at cycleDeg ≈ 267° -> cam angle = (firing + 267) / 2
      // Lobe nose points downward (-Y = +PI) when pushing valve open!
      const intPeakCamRad = ((cfg.firingAngleDeg + 458) * 0.5 * Math.PI) / 180;
      const exhPeakCamRad = ((cfg.firingAngleDeg + 267) * 0.5 * Math.PI) / 180;

      for (const zOff of [-0.17, 0.17]) {
        const vz = cfg.zPos + zOff;

        // Intake cam lobe
        const iLobe = new THREE.Mesh(camLobeGeo, materials.camshaftSteel);
        iLobe.position.set(0, 0, vz);
        // When cam spins by +crankRad/2, lobe nose hits -Y at crankRad = firing + 458°
        iLobe.rotation.z = Math.PI - intPeakCamRad;
        intakeCamSpin.add(iLobe);

        // Exhaust cam lobe
        const eLobe = new THREE.Mesh(camLobeGeo, materials.camshaftSteel);
        eLobe.position.set(0, 0, vz);
        eLobe.rotation.z = Math.PI - exhPeakCamRad;
        exhaustCamSpin.add(eLobe);

        // Intake valve + helical spring (angled 14° inward pent-roof)
        const iMount = new THREE.Group();
        iMount.position.set(intCamX * 0.68, 0.12, vz);
        iMount.rotation.z = bankSign * 0.24;

        const iStem = new THREE.Group();
        iStem.add(new THREE.Mesh(intakeValveGeo, materials.valveTitanium));
        iMount.add(iStem);

        const iSpring = new THREE.Mesh(springGeo, materials.valveSpring);
        iSpring.position.y = 0.24;
        iMount.add(iSpring);
        valvetrainGroup.add(iMount);
        intakeNodes.push({ stemGroup: iStem, springMesh: iSpring, baseY: 0 });

        // Exhaust valve + helical spring (angled 14° outward pent-roof)
        const eMount = new THREE.Group();
        eMount.position.set(exhCamX * 0.68, 0.12, vz);
        eMount.rotation.z = -bankSign * 0.24;

        const eStem = new THREE.Group();
        eStem.add(new THREE.Mesh(exhaustValveGeo, materials.valveTitanium));
        eMount.add(eStem);

        const eSpring = new THREE.Mesh(springGeo, materials.valveSpring);
        eSpring.position.y = 0.24;
        eMount.add(eSpring);
        valvetrainGroup.add(eMount);
        exhaustNodes.push({ stemGroup: eStem, springMesh: eSpring, baseY: 0 });
      }

      rig.intakeValves = [intakeNodes[0], intakeNodes[1]];
      rig.exhaustValves = [exhaustNodes[0], exhaustNodes[1]];
    }

    valvetrainGroup.add(intakeCamSpin);
    valvetrainGroup.add(exhaustCamSpin);
    camshaftSpinGroups.push(intakeCamSpin, exhaustCamSpin);

    tagAssembly(valvetrainGroup, 'valvetrain', selectableMeshes);
    registerExplodable(valvetrainGroup, [exX * 1.65, exY * 1.65, 0]);
    engineRoot.add(valvetrainGroup);

    // 6C. SCULPTED VALVE COVER (Bank A is cutaway-capable!)
    const coverGroup = new THREE.Group();
    coverGroup.rotation.z = -bankSign * halfV;
    const coverBaseDist = V12_GEO.DECK_DIST + 0.78;
    coverGroup.position.set(bankSign * sinV * coverBaseDist, cosV * coverBaseDist, 0);

    const coverMat = isCutaway ? materials.valveCoverCutaway : materials.valveCoverSolid;
    const coverMesh = new THREE.Mesh(valveCoverGeo, coverMat);
    coverMesh.renderOrder = isCutaway ? 4 : 1;
    coverGroup.add(coverMesh);

    // Embossed Atelier V12 nameplate plaque on outer cam hump
    const plaque = new THREE.Mesh(badgeGeo, materials.badgePlaque);
    plaque.position.set(bankSign * 0.34, 0.565, 0);
    plaque.rotation.x = -Math.PI / 2;
    plaque.rotation.z = bankSign > 0 ? -Math.PI / 2 : Math.PI / 2;
    coverGroup.add(plaque);

    // Billet CNC oil filler cap on front of Bank A cover
    if (bank === 'A') {
      const capGeo = trackGeo(new THREE.CylinderGeometry(0.18, 0.19, 0.14, 16));
      const oilCap = new THREE.Mesh(capGeo, materials.fastenerChrome);
      oilCap.position.set(0.34, 0.58, 2.75);
      coverGroup.add(oilCap);
    }

    // Instanced flange perimeter hex bolts (20 per valve cover)
    const vcBolts = new THREE.InstancedMesh(hexBoltGeo, materials.fastenerChrome, 20);
    let bi = 0;
    for (let i = 0; i < 10; i++) {
      const bz = -3.25 + (i / 9) * 6.5;
      dummy.position.set(0.71, 0.14, bz);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      vcBolts.setMatrixAt(bi++, dummy.matrix);
      dummy.position.set(-0.71, 0.14, bz);
      dummy.updateMatrix();
      vcBolts.setMatrixAt(bi++, dummy.matrix);
    }
    vcBolts.computeBoundingSphere();
    coverGroup.add(vcBolts);

    tagAssembly(coverGroup, 'valveCovers', selectableMeshes);
    registerExplodable(coverGroup, [exX * 2.55, exY * 2.55, 0]);
    engineRoot.add(coverGroup);
  };

  buildBankUpperAssembly('A');
  buildBankUpperAssembly('B');

  // =========================================================================
  // 7. DUAL CARBON INDUCTION PLENUMS, 12 VELOCITY STACKS, THROTTLES & FUEL RAILS
  // =========================================================================
  const intakeGroup = new THREE.Group();
  const plenumGeo = trackGeo(createPlenumGeometry(6.55));
  const throttleHousingGeo = trackGeo(new THREE.CylinderGeometry(0.36, 0.40, 0.54, 24, 1, true));
  throttleHousingGeo.rotateX(Math.PI / 2);
  const throttleRingGeo = trackGeo(new THREE.TorusGeometry(0.38, 0.045, 12, 24));
  const butterflyGeo = trackGeo(new THREE.CylinderGeometry(0.34, 0.34, 0.025, 22));
  butterflyGeo.rotateX(Math.PI / 2);
  const butterflyShaftGeo = trackGeo(new THREE.CylinderGeometry(0.025, 0.025, 0.78, 10));
  butterflyShaftGeo.rotateZ(Math.PI / 2);
  const railGeo = trackGeo(new THREE.CylinderGeometry(0.075, 0.075, 6.72, 14));
  railGeo.rotateX(Math.PI / 2);
  const injectorGeo = trackGeo(new THREE.CylinderGeometry(0.042, 0.032, 0.32, 10));
  const runnerFlangeGeo = trackGeo(new THREE.BoxGeometry(0.14, 0.32, 0.34));
  const velocityTrumpetGeo = trackGeo(new THREE.CylinderGeometry(0.17, 0.12, 0.22, 18, 1, true));

  const throttleButterflies: THREE.Mesh[] = [];

  for (const bank of ['A', 'B'] as const) {
    const bankSign = bank === 'A' ? 1 : -1;
    const px = bankSign * 0.62;
    const py = 3.92;

    // Carbon plenum body (Bank A cutaway-aware so velocity trumpets shine inside!)
    const pMat = bank === 'A' ? materials.plenumCutaway : materials.plenumSolid;
    const plenum = new THREE.Mesh(plenumGeo, pMat);
    plenum.position.set(px, py, 0.06);
    plenum.rotation.z = -bankSign * 0.14;
    plenum.renderOrder = bank === 'A' ? 5 : 1;
    intakeGroup.add(plenum);

    // Front CNC Throttle Body + Rotating Butterfly Plate
    const tbGroup = new THREE.Group();
    tbGroup.position.set(px * 0.96, py + 0.28, 3.68);
    tbGroup.add(new THREE.Mesh(throttleHousingGeo, materials.throttleBody));

    const lip = new THREE.Mesh(throttleRingGeo, materials.fastenerChrome);
    lip.position.z = 0.27;
    tbGroup.add(lip);

    const butterfly = new THREE.Mesh(butterflyGeo, materials.butterflyBrass);
    butterfly.add(new THREE.Mesh(butterflyShaftGeo, materials.crankshaftSteel));
    throttleButterflies.push(butterfly);
    tbGroup.add(butterfly);
    intakeGroup.add(tbGroup);

    // Anodized Billet Fuel Rail along inner V-valley
    const rail = new THREE.Mesh(railGeo, materials.fuelRail);
    rail.position.set(bankSign * 0.88, 3.12, 0);
    intakeGroup.add(rail);

    // 6 Swept Individual Intake Runners + Velocity Trumpets + Fuel Injectors
    const bankCyls = CYLINDER_CONFIGS.filter((c) => c.bank === bank);
    for (const cfg of bankCyls) {
      // Head intake port world coords (inner side of cylinder head)
      const headS = V12_GEO.DECK_DIST + 0.48;
      const portX = bankSign * (sinV * headS - cosV * 0.66);
      const portY = cosV * headS + sinV * 0.66;

      // Cross-over curved runner sweeping from opposite/paired plenum down into port
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(px, py + 0.18, cfg.zPos),
        new THREE.Vector3(px * 0.65, py - 0.26, cfg.zPos),
        new THREE.Vector3(portX * 0.86, portY + 0.22, cfg.zPos),
        new THREE.Vector3(portX, portY, cfg.zPos),
      ]);
      const runnerGeo = trackGeo(new THREE.TubeGeometry(curve, 18, 0.125, 14, false));
      intakeGroup.add(new THREE.Mesh(runnerGeo, materials.intakeRunner));

      // Billet intake port flange
      const flange = new THREE.Mesh(runnerFlangeGeo, materials.intakeRunner);
      flange.position.set(portX, portY, cfg.zPos);
      flange.rotation.z = -bankSign * halfV;
      intakeGroup.add(flange);

      // Flared CNC velocity trumpet inside plenum
      const trumpet = new THREE.Mesh(velocityTrumpetGeo, materials.butterflyBrass);
      trumpet.position.set(px, py + 0.28, cfg.zPos);
      intakeGroup.add(trumpet);

      // Fuel injector angling from fuel rail to intake port
      const inj = new THREE.Mesh(injectorGeo, materials.coilPackDark);
      inj.position.set(bankSign * 0.84, 2.94, cfg.zPos);
      inj.rotation.z = bankSign * 0.42;
      intakeGroup.add(inj);
    }
  }

  // Rear & Front Helmholtz balance crossover pipes linking both carbon plenums
  const balanceGeo = trackGeo(new THREE.CylinderGeometry(0.14, 0.14, 1.18, 16));
  balanceGeo.rotateZ(Math.PI / 2);
  for (const bz of [2.5, -2.5]) {
    const bal = new THREE.Mesh(balanceGeo, materials.intakeRunner);
    bal.position.set(0, 4.24, bz);
    intakeGroup.add(bal);
  }

  tagAssembly(intakeGroup, 'intakePlenums', selectableMeshes);
  registerExplodable(intakeGroup, [0, 2.35, 0]);
  engineRoot.add(intakeGroup);

  // =========================================================================
  // 8. 6-INTO-1 EQUAL-LENGTH INCONEL EXHAUST HEADERS (Hero Sculptural Pipes!)
  // =========================================================================
  const buildExhaustBank = (bank: 'A' | 'B') => {
    const bankSign: 1 | -1 = bank === 'A' ? 1 : -1;
    const exhGroup = new THREE.Group();
    const bankCyls = CYLINDER_CONFIGS.filter((c) => c.bank === bank);

    // Exhaust flange rail bolting onto outer cylinder head flank
    const portFlangeGeo = trackGeo(new THREE.BoxGeometry(0.11, 0.36, 0.44));

    // Collector target at outer-lower rear
    const collectorX = bankSign * 2.52;
    const collectorY = 0.26;
    const collectorZ = -2.35;

    for (let i = 0; i < 6; i++) {
      const cfg = bankCyls[i];
      // Exact outer exhaust port world coords
      const headS = V12_GEO.DECK_DIST + 0.34;
      const portX = bankSign * (sinV * headS + cosV * 0.72);
      const portY = cosV * headS - sinV * 0.72;

      const fl = new THREE.Mesh(portFlangeGeo, materials.exhaustFlange);
      fl.position.set(portX, portY, cfg.zPos);
      fl.rotation.z = -bankSign * halfV;
      exhGroup.add(fl);

      // Equal-length sculptural spaghetti sweep:
      // Front cylinders sweep tighter and lower; rear cylinders arc gracefully outward & up
      // so all 6 primaries converge into a hex-arranged 6-into-1 merge bundle!
      const ringAngle = (i / 6) * Math.PI * 2 + 0.25;
      const bundleR = 0.165;
      const endX = collectorX + Math.cos(ringAngle) * bundleR;
      const endY = collectorY + Math.sin(ringAngle) * bundleR;

      const bulgeOut = 2.62 + (i % 2) * 0.24 + (i >= 3 ? (i - 2) * 0.14 : 0);
      const archY = portY - 0.24 + (i >= 3 ? 0.34 * (i - 2) * 0.38 : -0.18 * (2 - i) * 0.28);
      const midZ = cfg.zPos * 0.48 + collectorZ * 0.52 + (i < 3 ? 0.42 : -0.12);

      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(portX, portY, cfg.zPos),
        new THREE.Vector3(portX + bankSign * 0.62, portY - 0.12, cfg.zPos - 0.12),
        new THREE.Vector3(bankSign * bulgeOut, archY, cfg.zPos - 0.65),
        new THREE.Vector3(bankSign * (bulgeOut - 0.12), collectorY + 0.44 + (i % 3) * 0.16, midZ),
        new THREE.Vector3(endX, endY, collectorZ + 0.38),
        new THREE.Vector3(endX * 0.99, endY, collectorZ),
      ]);

      const pipeGeo = trackGeo(new THREE.TubeGeometry(curve, 36, 0.115, 14, false));
      const pipeMesh = new THREE.Mesh(pipeGeo, materials.exhaustHeader);
      exhGroup.add(pipeMesh);
    }

    // 6-into-1 Tapered Merge Collector Cone + Tailpipe Stub
    const collectorConeGeo = trackGeo(new THREE.CylinderGeometry(0.29, 0.21, 0.92, 24));
    collectorConeGeo.rotateX(Math.PI / 2);
    const collector = new THREE.Mesh(collectorConeGeo, materials.exhaustHeader);
    collector.position.set(collectorX, collectorY, collectorZ - 0.42);
    exhGroup.add(collector);

    // Welded V-band clamp ring & exit pipe
    const vBandGeo = trackGeo(new THREE.TorusGeometry(0.225, 0.036, 10, 24));
    const vBand = new THREE.Mesh(vBandGeo, materials.fastenerChrome);
    vBand.position.set(collectorX, collectorY, collectorZ - 0.88);
    exhGroup.add(vBand);

    const exitPipeGeo = trackGeo(new THREE.CylinderGeometry(0.20, 0.20, 1.35, 22, 1, true));
    exitPipeGeo.rotateX(Math.PI / 2);
    const exitPipe = new THREE.Mesh(exitPipeGeo, materials.exhaustHeader);
    exitPipe.position.set(collectorX, collectorY, collectorZ - 1.54);
    exhGroup.add(exitPipe);

    tagAssembly(exhGroup, 'exhaustHeaders', selectableMeshes);
    registerExplodable(exhGroup, [bankSign * 2.15, -0.15, 0]);
    engineRoot.add(exhGroup);
  };

  buildExhaustBank('A');
  buildExhaustBank('B');

  // =========================================================================
  // 9. FRONT TIMING DRIVE (4 Cam Sprockets, Crank Harmonic Damper, Idlers, Belt)
  // =========================================================================
  const timingGroup = new THREE.Group();
  const frontZ = 3.84;

  // Crank Harmonic Damper Pulley
  const frontCrankPulley = createSpokedSprocketGroup(
    0.58,
    0.26,
    materials.flywheelSteel,
    materials.fastenerChrome,
    materials.fastenerChrome,
    geometries
  );
  frontCrankPulley.position.set(0, 0, frontZ + 0.14);
  timingGroup.add(frontCrankPulley);

  // 4 Spoked Anodized Cam Sprockets aligned exactly with the 4 camshaft axes!
  const camSprocketSpinGroups: THREE.Group[] = [];
  const camWorldCoords: [number, number][] = [];
  for (const bankSign of [1, -1] as const) {
    const baseDist = V12_GEO.DECK_DIST + 0.96;
    for (const localX of [-bankSign * 0.40, bankSign * 0.40]) {
      // Transform bank-local (localX, baseDist) to world XY:
      // rotZ = -bankSign * 30° -> x = localX*cos(30) + bankSign*baseDist*sin(30)
      //                           y = -bankSign*localX*sin(30) + baseDist*cos(30)
      const wx = localX * cosV + bankSign * baseDist * sinV;
      const wy = -bankSign * localX * sinV + baseDist * cosV;
      camWorldCoords.push([wx, wy]);

      const sprocket = createSpokedSprocketGroup(
        0.38,
        0.16,
        materials.camSprocket,
        materials.crankshaftSteel,
        materials.fastenerChrome,
        geometries
      );
      sprocket.position.set(wx, wy, frontZ);
      timingGroup.add(sprocket);
      camSprocketSpinGroups.push(sprocket);
    }
  }

  // Idler & Tensioner Pulleys guiding the belt cleanly into the V-valley
  const idlerSpinGroups: THREE.Group[] = [];
  const idlerPositions: [number, number, number][] = [
    [0, 1.38, 0.24], // Central V-valley tensioner
    [0.86, 0.92, 0.20], // Bank A guide idler
    [-0.86, 0.92, 0.20], // Bank B guide idler
  ];
  for (const [ix, iy, ir] of idlerPositions) {
    const idl = createSpokedSprocketGroup(
      ir,
      0.16,
      materials.fastenerChrome,
      materials.cradleAnodized,
      materials.fastenerChrome,
      geometries
    );
    idl.position.set(ix, iy, frontZ);
    timingGroup.add(idl);
    idlerSpinGroups.push(idl);
  }

  // Continuous closed Kevlar Timing Belt Loop wrapping crank -> Bank A cams -> valley idler -> Bank B cams -> crank
  const beltPts: THREE.Vector3[] = [
    new THREE.Vector3(0, -0.58, frontZ),
    new THREE.Vector3(0.56, -0.10, frontZ),
    new THREE.Vector3(1.10, 0.92, frontZ),
    new THREE.Vector3(camWorldCoords[1][0] + 0.36, camWorldCoords[1][1] + 0.04, frontZ),
    new THREE.Vector3(camWorldCoords[1][0] + 0.06, camWorldCoords[1][1] + 0.39, frontZ),
    new THREE.Vector3(camWorldCoords[0][0] - 0.14, camWorldCoords[0][1] + 0.36, frontZ),
    new THREE.Vector3(0.24, 1.48, frontZ),
    new THREE.Vector3(0, 1.14, frontZ),
    new THREE.Vector3(-0.24, 1.48, frontZ),
    new THREE.Vector3(camWorldCoords[2][0] + 0.14, camWorldCoords[2][1] + 0.36, frontZ),
    new THREE.Vector3(camWorldCoords[3][0] - 0.06, camWorldCoords[3][1] + 0.39, frontZ),
    new THREE.Vector3(camWorldCoords[3][0] - 0.36, camWorldCoords[3][1] + 0.04, frontZ),
    new THREE.Vector3(-1.10, 0.92, frontZ),
    new THREE.Vector3(-0.56, -0.10, frontZ),
  ];
  const beltCurve = new THREE.CatmullRomCurve3(beltPts, true, 'catmullrom', 0.22);
  const beltGeo = trackGeo(new THREE.TubeGeometry(beltCurve, 128, 0.052, 8, true));
  // Flatten belt slightly into a ribbon strap along Z
  beltGeo.scale(1, 1, 1.75);
  // Recenter Z after scaling
  beltGeo.translate(0, 0, frontZ * (1 - 1.75));
  const beltMesh = new THREE.Mesh(beltGeo, materials.timingBelt);
  timingGroup.add(beltMesh);

  // Compact side accessory alternator housing (lower front-left)
  const altGroup = new THREE.Group();
  altGroup.position.set(-1.38, -0.12, 3.16);
  const altBodyGeo = trackGeo(new THREE.CylinderGeometry(0.42, 0.42, 0.68, 20));
  altBodyGeo.rotateX(Math.PI / 2);
  altGroup.add(new THREE.Mesh(altBodyGeo, materials.headSolid));
  const altPulley = createSpokedSprocketGroup(
    0.22,
    0.16,
    materials.fastenerChrome,
    materials.cradleAnodized,
    materials.fastenerChrome,
    geometries
  );
  altPulley.position.z = 0.68;
  altGroup.add(altPulley);
  idlerSpinGroups.push(altPulley);
  timingGroup.add(altGroup);

  tagAssembly(timingGroup, 'timingDrive', selectableMeshes);
  registerExplodable(timingGroup, [0, 0, 1.95]);
  engineRoot.add(timingGroup);

  // =========================================================================
  // 10. REAR LIGHTWEIGHT FLYWHEEL & CARBON CLUTCH PACK (Rotates at 1x crank)
  // =========================================================================
  const flywheelExplodeGroup = new THREE.Group();
  const flywheelSpinGroup = new THREE.Group();
  flywheelSpinGroup.position.set(0, 0, -4.02);
  flywheelExplodeGroup.add(flywheelSpinGroup);

  const fwDiscGeo = trackGeo(new THREE.CylinderGeometry(1.18, 1.18, 0.14, 36));
  fwDiscGeo.rotateX(Math.PI / 2);
  flywheelSpinGroup.add(new THREE.Mesh(fwDiscGeo, materials.flywheelSteel));

  // Starter ring gear outer teeth via InstancedMesh (72 teeth!)
  const toothGeo = trackGeo(new THREE.BoxGeometry(0.055, 0.11, 0.15));
  const ringTeethInst = new THREE.InstancedMesh(toothGeo, materials.crankshaftSteel, 72);
  for (let t = 0; t < 72; t++) {
    const a = (t / 72) * Math.PI * 2;
    dummy.position.set(Math.cos(a) * 1.21, Math.sin(a) * 1.21, 0);
    dummy.rotation.set(0, 0, a - Math.PI / 2);
    dummy.updateMatrix();
    ringTeethInst.setMatrixAt(t, dummy.matrix);
  }
  ringTeethInst.computeBoundingSphere();
  flywheelSpinGroup.add(ringTeethInst);

  // Carbon-carbon multi-plate clutch pressure cover
  const clutchRingGeo = trackGeo(new THREE.CylinderGeometry(0.86, 0.96, 0.30, 28));
  clutchRingGeo.rotateX(Math.PI / 2);
  const clutchMesh = new THREE.Mesh(clutchRingGeo, materials.clutchCover);
  clutchMesh.position.z = -0.22;
  flywheelSpinGroup.add(clutchMesh);

  // 12 radial diaphragm spring fingers
  const fingerGeo = trackGeo(new THREE.BoxGeometry(0.09, 0.42, 0.04));
  for (let f = 0; f < 12; f++) {
    const a = (f / 12) * Math.PI * 2;
    const finger = new THREE.Mesh(fingerGeo, materials.camSprocket);
    finger.position.set(Math.cos(a) * 0.42, Math.sin(a) * 0.42, -0.37);
    finger.rotation.z = a - Math.PI / 2;
    flywheelSpinGroup.add(finger);
  }

  // Center spline input hub
  const splineGeo = trackGeo(new THREE.CylinderGeometry(0.18, 0.18, 0.42, 16));
  splineGeo.rotateX(Math.PI / 2);
  const splineHub = new THREE.Mesh(splineGeo, materials.fastenerChrome);
  splineHub.position.z = -0.24;
  flywheelSpinGroup.add(splineHub);

  tagAssembly(flywheelExplodeGroup, 'flywheel', selectableMeshes);
  registerExplodable(flywheelExplodeGroup, [0, 0, -2.05]);
  engineRoot.add(flywheelExplodeGroup);

  return {
    engineRoot,
    crankshaftGroup,
    flywheelSpinGroup,
    frontCrankPulley,
    camshaftSpinGroups,
    camSprocketSpinGroups,
    idlerSpinGroups,
    throttleButterflies,
    cylinderRigs,
    explodables,
    selectableMeshes,
    dispose: () => {
      for (const g of geometries) g.dispose();
    },
  };
}
