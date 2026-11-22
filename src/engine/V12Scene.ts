import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { buildV12Engine, V12AssemblyRig } from './geometryBuilder';
import {
  computeEngineOutput,
  createEmptyCylinderTelemetry,
  CYLINDER_CONFIGS,
  CylinderKinematicsResult,
  solveCylinderKinematics,
  V12_GEO,
} from './kinematics';
import { createEngineMaterials, EngineMaterialLibrary } from './materials';
import { createProceduralTextures, ProceduralTextureSet } from './textures';
import {
  CAMERA_PRESETS,
  CameraPresetId,
  ComponentId,
  EngineTelemetry,
  FinishId,
  LIGHTING_PRESETS,
  LightingId,
  ViewMode,
} from './types';

export interface V12SceneCallbacks {
  onTelemetry: (telemetry: EngineTelemetry) => void;
  onSelectComponent: (componentId: ComponentId | null) => void;
  onHoverComponent: (componentId: ComponentId | null) => void;
  onRpmSync?: (rpm: number) => void;
}

export interface V12SceneState {
  isPlaying: boolean;
  targetRpm: number;
  timeScale: number; // 1.0 = real speed (capped visually for smoothness), 0.1 = slow-mo, 0.02 = ultra-slow
  explodeAmount: number; // 0..1
  viewMode: ViewMode;
  finishId: FinishId;
  lightingId: LightingId;
  showCombustion: boolean;
  autoRotate: boolean;
}

// Reusable zero-GC scratch objects outside animation loop
const _kinScratch: CylinderKinematicsResult = {
  pinX: 0,
  pinY: 0,
  pistonDist: 0,
  wristX: 0,
  wristY: 0,
  conrodAngleZ: 0,
  pistonNorm: 0,
  cycleDeg: 0,
  phase: 'power',
  intakeLift: 0,
  exhaustLift: 0,
  sparkIntensity: 0,
  combustionIntensity: 0,
};
const _pointerNdc = new THREE.Vector2();
const _targetCamPos = new THREE.Vector3();
const _targetControlsLook = new THREE.Vector3();
const _bgColorTarget = new THREE.Color();
const _floorColorTarget = new THREE.Color();
const _tmpColor = new THREE.Color();

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export class V12SceneController {
  private container: HTMLElement;
  private callbacks: V12SceneCallbacks;
  private isSoftwareGl: boolean;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private pmremEnv: THREE.Texture | null = null;

  private textures: ProceduralTextureSet;
  private materials: EngineMaterialLibrary;
  private rig: V12AssemblyRig;
  private studioGeos: THREE.BufferGeometry[] = [];

  // Lights
  private keyLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private rimLight: THREE.DirectionalLight;
  private softboxes: THREE.RectAreaLight[] = [];

  // State
  private state: V12SceneState = {
    isPlaying: true,
    targetRpm: 1200,
    timeScale: 0.08, // Default mechanical inspection cadence so valves & pistons read crisply
    explodeAmount: 0,
    viewMode: 'assembled',
    finishId: 'rosso',
    lightingId: 'atelier',
    showCombustion: true,
    autoRotate: false,
  };

  private currentRpm = 1200;
  private blipTimer = 0;
  private blipPeakRpm = 9100;
  private crankRad = 0;
  private currentExplode = 0;
  private selectedComponent: ComponentId | null = null;
  private hoveredComponent: ComponentId | null = null;

  // Camera transition state
  private camAnimating = false;

  // Raycasting
  private raycaster = new THREE.Raycaster();
  private lastHoverCheck = 0;
  private pointerDownPos = { x: 0, y: 0 };

  // Loop & lifecycle
  private frameId = 0;
  private isDisposed = false;
  private lastTimeMs = 0;
  private telemetryAccum = 0;
  private cylinderTelemetry = createEmptyCylinderTelemetry();

  // Bound handlers
  private handleResizeBound: () => void;
  private handlePointerMoveBound: (e: PointerEvent) => void;
  private handlePointerDownBound: (e: PointerEvent) => void;
  private handlePointerUpBound: (e: PointerEvent) => void;
  private handleContextLostBound: (e: Event) => void;
  private handleContextRestoredBound: () => void;

  constructor(container: HTMLElement, callbacks: V12SceneCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.isSoftwareGl = detectSoftwareWebGL();

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    // 1. Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    // 2. Scene + Fog + RoomEnvironment Studio Reflections
    this.scene = new THREE.Scene();
    const initLight = LIGHTING_PRESETS[0];
    this.scene.background = new THREE.Color(initLight.bgHex);
    this.scene.fog = new THREE.FogExp2(initLight.fogHex, 0.022);

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    const roomEnv = new RoomEnvironment();
    this.pmremEnv = pmremGenerator.fromScene(roomEnv, 0.04).texture;
    this.scene.environment = this.pmremEnv;
    roomEnv.dispose();
    pmremGenerator.dispose();

    // 3. Camera & Controls
    this.camera = new THREE.PerspectiveCamera(38, width / height, 0.15, 120);
    const heroCam = CAMERA_PRESETS[0];
    this.camera.position.set(...heroCam.position);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(...heroCam.target);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = 24;
    this.controls.maxPolarAngle = Math.PI * 0.488; // keep camera above studio plinth
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 0.65;
    this.controls.addEventListener('start', () => {
      // Never fight manual user camera drag
      this.camAnimating = false;
    });
    this.controls.update();

    // 4. Studio 3-Point Lighting + Area Softboxes
    this.keyLight = new THREE.DirectionalLight(initLight.keyColor, initLight.keyIntensity);
    this.keyLight.position.set(8.5, 13.5, 9.0);
    this.keyLight.castShadow = !this.isSoftwareGl;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.near = 2;
    this.keyLight.shadow.camera.far = 34;
    const d = 7.8;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.022;
    this.scene.add(this.keyLight);

    this.hemiLight = new THREE.HemisphereLight(
      initLight.fillSky,
      initLight.fillGround,
      initLight.fillIntensity
    );
    this.scene.add(this.hemiLight);

    this.rimLight = new THREE.DirectionalLight(initLight.rimColor, initLight.rimIntensity);
    this.rimLight.position.set(-9.0, 6.5, -8.5);
    this.scene.add(this.rimLight);

    // Elongated studio softboxes for crisp automotive specular highlights (skipped on software WebGL)
    if (!this.isSoftwareGl) {
      RectAreaLightUniformsLib.init();
      const topStrip = new THREE.RectAreaLight(0xffffff, initLight.softboxIntensity, 9.5, 2.2);
      topStrip.position.set(0, 9.5, 0.5);
      topStrip.lookAt(0, 2.4, 0);
      this.scene.add(topStrip);

      const sideStrip = new THREE.RectAreaLight(0xdce8ff, initLight.softboxIntensity * 0.62, 7.0, 1.8);
      sideStrip.position.set(8.2, 4.4, -2.5);
      sideStrip.lookAt(0, 2.3, 0);
      this.scene.add(sideStrip);

      this.softboxes.push(topStrip, sideStrip);
    }

    // 5. Procedural Textures, PBR Materials & Full V12 Engine Geometry
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.textures = createProceduralTextures(maxAniso);
    this.materials = createEngineMaterials(this.textures, this.isSoftwareGl);
    this.rig = buildV12Engine(this.materials);
    this.scene.add(this.rig.engineRoot);

    // 6. Grounded Studio Turntable Plinth & Contact Shadow
    this.buildStudioPlinth();

    // 7. Apply initial poses & pre-warm shaders (skip compile on software WebGL)
    this.updateKinematics(0);
    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // 8. Bind events
    this.handleResizeBound = this.onResize.bind(this);
    this.handlePointerMoveBound = this.onPointerMove.bind(this);
    this.handlePointerDownBound = this.onPointerDown.bind(this);
    this.handlePointerUpBound = this.onPointerUp.bind(this);
    this.handleContextLostBound = (e: Event) => {
      e.preventDefault();
      this.stopLoop();
    };
    this.handleContextRestoredBound = () => {
      if (!this.isDisposed) this.startLoop();
    };

    window.addEventListener('resize', this.handleResizeBound);
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMoveBound);
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDownBound);
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUpBound);
    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLostBound);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestoredBound);

    // 9. Start loop
    this.lastTimeMs = performance.now();
    this.startLoop();
  }

  private buildStudioPlinth(): void {
    // Seamless horizon floor plane slightly below plinth
    const floorGeo = new THREE.CircleGeometry(36, 64);
    floorGeo.rotateX(-Math.PI / 2);
    this.studioGeos.push(floorGeo);
    const floor = new THREE.Mesh(floorGeo, this.materials.floorPlinth);
    floor.position.y = -0.10;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Elevated brushed architectural turntable disc (sits flush at y = 0)
    const plinthGeo = new THREE.CylinderGeometry(6.9, 7.15, 0.12, 72);
    this.studioGeos.push(plinthGeo);
    const plinth = new THREE.Mesh(plinthGeo, this.materials.floorPlinth);
    plinth.position.y = -0.06;
    plinth.receiveShadow = true;
    this.scene.add(plinth);

    // Subtle machined bevel collar around turntable perimeter
    const rimGeo = new THREE.TorusGeometry(6.94, 0.035, 10, 96);
    rimGeo.rotateX(Math.PI / 2);
    this.studioGeos.push(rimGeo);
    const rim = new THREE.Mesh(rimGeo, this.materials.floorRimAccent);
    rim.position.y = 0.0;
    this.scene.add(rim);

    // Soft radial contact shadow plane grounded directly beneath engine & cradle (y = 0.025)
    const shadowPlaneGeo = new THREE.PlaneGeometry(8.8, 11.2);
    shadowPlaneGeo.rotateX(-Math.PI / 2);
    this.studioGeos.push(shadowPlaneGeo);
    const shadowPlane = new THREE.Mesh(shadowPlaneGeo, this.materials.contactShadow);
    shadowPlane.position.y = 0.025;
    this.scene.add(shadowPlane);
  }

  // =========================================================================
  // PUBLIC CONTROL API
  // =========================================================================

  public setPlaying(playing: boolean): void {
    this.state.isPlaying = playing;
  }

  public setTargetRpm(rpm: number): void {
    this.state.targetRpm = Math.max(0, Math.min(9500, rpm));
    this.blipTimer = 0;
  }

  public triggerRevBlip(): void {
    this.state.isPlaying = true;
    this.blipTimer = 1.35; // 1.35s authentic V12 inertial rev blip
    this.blipPeakRpm = 9150;
  }

  public setTimeScale(scale: number): void {
    this.state.timeScale = scale;
  }

  public setExplodeAmount(amount: number): void {
    this.state.explodeAmount = Math.max(0, Math.min(1, amount));
  }

  public setViewMode(mode: ViewMode): void {
    this.state.viewMode = mode;
    this.materials.applyViewMode(mode);
  }

  public setFinish(finishId: FinishId): void {
    this.state.finishId = finishId;
    this.materials.applyFinish(finishId);
  }

  public setLighting(lightingId: LightingId): void {
    this.state.lightingId = lightingId;
    const preset = LIGHTING_PRESETS.find((l) => l.id === lightingId) ?? LIGHTING_PRESETS[0];

    _bgColorTarget.set(preset.bgHex);
    this.scene.background = _bgColorTarget.clone();
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.set(preset.fogHex);
    }
    this.renderer.toneMappingExposure = preset.exposure;
    this.keyLight.color.setHex(preset.keyColor);
    this.keyLight.intensity = preset.keyIntensity;
    this.hemiLight.color.setHex(preset.fillSky);
    this.hemiLight.groundColor.setHex(preset.fillGround);
    this.hemiLight.intensity = preset.fillIntensity;
    this.rimLight.color.setHex(preset.rimColor);
    this.rimLight.intensity = preset.rimIntensity;

    if (this.softboxes[0]) this.softboxes[0].intensity = preset.softboxIntensity;
    if (this.softboxes[1]) this.softboxes[1].intensity = preset.softboxIntensity * 0.62;

    _floorColorTarget.setHex(preset.floorColor);
    this.materials.floorPlinth.color.copy(_floorColorTarget);
    this.materials.contactShadow.opacity = preset.isLightTheme ? 0.28 : 0.56;
  }

  public setShowCombustion(show: boolean): void {
    this.state.showCombustion = show;
  }

  public setAutoRotate(enabled: boolean): void {
    this.state.autoRotate = enabled;
    this.controls.autoRotate = !this.isSoftwareGl && enabled;
  }

  public setCameraPreset(presetId: CameraPresetId): void {
    const preset = CAMERA_PRESETS.find((c) => c.id === presetId) ?? CAMERA_PRESETS[0];
    _targetCamPos.set(...preset.position);
    _targetControlsLook.set(...preset.target);
    this.camAnimating = true;
  }

  public selectComponent(componentId: ComponentId | null): void {
    this.selectedComponent = componentId;
    this.materials.setHighlight(this.selectedComponent, this.hoveredComponent);
    this.callbacks.onSelectComponent(componentId);
  }

  public stepCrankAngleDeg(deltaDeg: number): void {
    this.state.isPlaying = false;
    this.crankRad += (deltaDeg * Math.PI) / 180;
  }

  // =========================================================================
  // RENDER LOOP & SOFTWARE WEBGL PACING
  // =========================================================================

  private startLoop(): void {
    this.lastTimeMs = performance.now();
    const tick = () => {
      if (this.isDisposed) return;
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTimeMs) / 1000));
      this.lastTimeMs = now;

      this.stepSimulation(dt);
      this.renderer.render(this.scene, this.camera);

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };
    this.frameId = requestAnimationFrame(tick);
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.isDisposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
      if (status === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private stopLoop(): void {
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
  }

  // =========================================================================
  // REAL-TIME KINEMATICS, DAMPING & TELEMETRY
  // =========================================================================

  private stepSimulation(dt: number): void {
    // 1. Inertial RPM spool & rev-blip envelope
    let desiredRpm = this.state.targetRpm;
    if (this.blipTimer > 0) {
      this.blipTimer = Math.max(0, this.blipTimer - dt);
      if (this.blipTimer > 0.72) {
        // Rapid motorsport throttle snap up to 9,150 RPM
        desiredRpm = this.blipPeakRpm;
      } else {
        // Overrun decay back to base target RPM
        desiredRpm = this.state.targetRpm;
      }
    }
    const rpmLambda = desiredRpm > this.currentRpm ? 8.5 : 3.2; // crisp snap up, natural engine-braking decel
    this.currentRpm = THREE.MathUtils.damp(this.currentRpm, desiredRpm, rpmLambda, dt);
    if (Math.abs(this.currentRpm - desiredRpm) < 1) this.currentRpm = desiredRpm;

    // 2. Advance crankshaft angle when running
    if (this.state.isPlaying && this.currentRpm > 0.5) {
      // Real angular velocity = (RPM / 60) * 2 * PI rad/s, scaled by inspection timeScale
      const omegaReal = (this.currentRpm / 60) * Math.PI * 2;
      // Cap effective visual spin at ~68 rad/s so aliasing never looks backwards at 9,500 RPM @ 1x
      const omegaVisual = Math.min(omegaReal * this.state.timeScale, 68);
      this.crankRad += omegaVisual * dt;
      if (this.crankRad > Math.PI * 4000) {
        this.crankRad -= Math.PI * 4000;
      }
    }

    // 3. Smoothly damped exploded-view separation
    this.currentExplode = THREE.MathUtils.damp(this.currentExplode, this.state.explodeAmount, 6.5, dt);
    for (let i = 0; i < this.rig.explodables.length; i++) {
      const exp = this.rig.explodables[i];
      exp.group.position.set(
        exp.basePosition.x + exp.explodeOffset.x * this.currentExplode,
        exp.basePosition.y + exp.explodeOffset.y * this.currentExplode,
        exp.basePosition.z + exp.explodeOffset.z * this.currentExplode
      );
    }

    // 4. Smoothly damped camera preset choreography
    if (this.camAnimating) {
      this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, _targetCamPos.x, 5.2, dt);
      this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, _targetCamPos.y, 5.2, dt);
      this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, _targetCamPos.z, 5.2, dt);
      this.controls.target.x = THREE.MathUtils.damp(this.controls.target.x, _targetControlsLook.x, 5.2, dt);
      this.controls.target.y = THREE.MathUtils.damp(this.controls.target.y, _targetControlsLook.y, 5.2, dt);
      this.controls.target.z = THREE.MathUtils.damp(this.controls.target.z, _targetControlsLook.z, 5.2, dt);

      if (
        this.camera.position.distanceToSquared(_targetCamPos) < 0.0008 &&
        this.controls.target.distanceToSquared(_targetControlsLook) < 0.0008
      ) {
        this.camera.position.copy(_targetCamPos);
        this.controls.target.copy(_targetControlsLook);
        this.camAnimating = false;
      }
    }

    this.controls.update();

    // 5. Update all mechanical kinematics & combustion visuals
    this.updateKinematics(dt);

    // 6. Throttled React HUD telemetry push (~20 Hz to keep React ultra-light)
    this.telemetryAccum += dt;
    if (this.telemetryAccum >= 0.05) {
      this.telemetryAccum = 0;
      const crankDeg720 = (((this.crankRad * 180) / Math.PI) % 720 + 720) % 720;
      const firingSlot = Math.floor(crankDeg720 / 60) % 12;
      const firingCyl = [1, 12, 5, 8, 3, 10, 6, 7, 2, 11, 4, 9][firingSlot];
      const output = computeEngineOutput(this.state.isPlaying ? this.currentRpm : 0);

      this.callbacks.onTelemetry({
        rpm: Math.round(this.currentRpm),
        targetRpm: this.state.targetRpm,
        crankAngleDeg: Math.round(crankDeg720),
        horsepower: output.horsepower,
        torqueNm: output.torqueNm,
        firingCylinder: firingCyl,
        exhaustTempC: output.exhaustTempC,
        oilPressureBar: output.oilPressureBar,
        cylinders: this.cylinderTelemetry,
      });
      this.callbacks.onRpmSync?.(this.currentRpm);
    }
  }

  private updateKinematics(_dt: number): void {
    const cr = this.crankRad;
    const halfCr = cr * 0.5;
    const sinV = Math.sin(V12_GEO.BANK_ANGLE_RAD);
    const cosV = Math.cos(V12_GEO.BANK_ANGLE_RAD);

    // Rotating crankshaft, rear flywheel, front crank damper
    this.rig.crankshaftGroup.rotation.z = cr;
    this.rig.flywheelSpinGroup.rotation.z = cr;
    this.rig.frontCrankPulley.rotation.z = cr;

    // 4 DOHC camshafts & 4 anodized cam sprockets spin at exact 0.5x crank speed
    for (let i = 0; i < this.rig.camshaftSpinGroups.length; i++) {
      this.rig.camshaftSpinGroups[i].rotation.z = halfCr;
    }
    for (let i = 0; i < this.rig.camSprocketSpinGroups.length; i++) {
      this.rig.camSprocketSpinGroups[i].rotation.z = halfCr;
    }
    for (let i = 0; i < this.rig.idlerSpinGroups.length; i++) {
      this.rig.idlerSpinGroups[i].rotation.z = -cr * 1.45;
    }

    // Drive-by-wire throttle butterfly plates open proportionally to RPM (6° idle -> 88° redline)
    const throttleNorm = Math.max(0, Math.min(1, (this.currentRpm - 700) / 8400));
    const butterflyAngle = 0.10 + throttleNorm * 1.42;
    for (let i = 0; i < this.rig.throttleButterflies.length; i++) {
      this.rig.throttleButterflies[i].rotation.x = butterflyAngle;
    }

    // Exhaust thermal glow
    this.materials.updateExhaustHeat(
      this.state.isPlaying ? this.currentRpm : 0,
      this.state.lightingId === 'thermal'
    );

    // 12-Cylinder exact slider-crank, 48-valve actuation & 4-stroke combustion glow
    const showComb = this.state.showCombustion;
    const combVisibilityBoost = this.state.viewMode !== 'assembled' || this.currentExplode > 0.15 ? 1.0 : 0.0;

    for (let i = 0; i < 12; i++) {
      const cfg = CYLINDER_CONFIGS[i];
      const rig = this.rig.cylinderRigs[i];
      const kin = solveCylinderKinematics(cfg, cr, _kinScratch);

      // Update piston along its cylinder bore axis
      rig.pistonGroup.position.set(kin.wristX, kin.wristY, cfg.zPos);

      // Update H-beam connecting rod from crankpin to wrist pin
      rig.conrodGroup.position.set(kin.pinX, kin.pinY, cfg.zPos);
      rig.conrodGroup.rotation.z = kin.conrodAngleZ;

      // Update 2 intake valves + helical spring compression
      const intDisp = -kin.intakeLift * V12_GEO.VALVE_MAX_LIFT;
      const intSpringScale = 1 - kin.intakeLift * 0.34;
      for (let v = 0; v < 2; v++) {
        const node = rig.intakeValves[v];
        node.stemGroup.position.y = node.baseY + intDisp;
        node.springMesh.scale.y = intSpringScale;
      }

      // Update 2 exhaust valves + helical spring compression
      const exhDisp = -kin.exhaustLift * V12_GEO.VALVE_MAX_LIFT;
      const exhSpringScale = 1 - kin.exhaustLift * 0.34;
      for (let v = 0; v < 2; v++) {
        const node = rig.exhaustValves[v];
        node.stemGroup.position.y = node.baseY + exhDisp;
        node.springMesh.scale.y = exhSpringScale;
      }

      // Update combustion chamber volumetric glow & spark flash
      const combMat = this.materials.combustionMats[i];
      const sparkMat = this.materials.sparkMats[i];

      if (showComb && combVisibilityBoost > 0.01) {
        const crownTopS = kin.pistonDist + V12_GEO.PISTON_CROWN_H;
        const chamberH = Math.max(0.08, V12_GEO.DECK_DIST - crownTopS);
        const midS = crownTopS + chamberH * 0.5;
        rig.combustionMesh.position.set(cfg.bankSign * sinV * midS, cosV * midS, cfg.zPos);
        rig.combustionMesh.scale.set(1, chamberH, 1);

        if (kin.phase === 'power') {
          const glow = kin.combustionIntensity;
          _tmpColor.setRGB(1.0, 0.36 + glow * 0.56, 0.05 + glow * 0.32);
          combMat.color.copy(_tmpColor);
          combMat.opacity = (0.12 + glow * 0.68) * combVisibilityBoost;
        } else if (kin.phase === 'exhaust') {
          const t = (kin.cycleDeg - 180) / 180;
          combMat.color.setRGB(0.95, 0.24, 0.08);
          combMat.opacity = (1 - t) * 0.30 * combVisibilityBoost;
        } else if (kin.phase === 'intake') {
          combMat.color.setRGB(0.24, 0.68, 1.0);
          combMat.opacity = (0.14 + kin.intakeLift * 0.16) * combVisibilityBoost;
        } else {
          // Compression
          const t = (kin.cycleDeg - 540) / 180;
          combMat.color.setRGB(0.45 + t * 0.45, 0.72, 1.0 - t * 0.4);
          combMat.opacity = (0.12 + t * 0.28) * combVisibilityBoost;
        }

        sparkMat.opacity = kin.sparkIntensity * 0.95 * combVisibilityBoost;
        const sparkScale = 0.7 + kin.sparkIntensity * 1.15;
        rig.sparkMesh.scale.setScalar(sparkScale);
        rig.combustionMesh.visible = combMat.opacity > 0.01;
        rig.sparkMesh.visible = sparkMat.opacity > 0.02;
      } else {
        rig.combustionMesh.visible = false;
        rig.sparkMesh.visible = false;
      }

      // Copy into zero-GC telemetry slot
      const slot = this.cylinderTelemetry[i];
      slot.cycleAngleDeg = kin.cycleDeg;
      slot.phase = kin.phase;
      slot.pistonNorm = kin.pistonNorm;
      slot.intakeLift = kin.intakeLift;
      slot.exhaustLift = kin.exhaustLift;
      slot.sparkIntensity = kin.sparkIntensity;
      slot.combustionIntensity = kin.combustionIntensity;
    }
  }

  // =========================================================================
  // INTERACTIVE RAYCASTING & POINTER EVENTS
  // =========================================================================

  private pickComponent(event: PointerEvent): ComponentId | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    _pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    _pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(_pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects(this.rig.selectableMeshes, false);
    if (hits.length > 0) {
      const compId = hits[0].object.userData.componentId as ComponentId | undefined;
      return compId ?? null;
    }
    return null;
  }

  private onPointerMove(event: PointerEvent): void {
    const now = performance.now();
    if (now - this.lastHoverCheck < 55) return; // throttled hover raycast
    this.lastHoverCheck = now;

    const hit = this.pickComponent(event);
    if (hit !== this.hoveredComponent) {
      this.hoveredComponent = hit;
      this.materials.setHighlight(this.selectedComponent, this.hoveredComponent);
      this.renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
      this.callbacks.onHoverComponent(hit);
    }
  }

  private onPointerDown(event: PointerEvent): void {
    this.pointerDownPos.x = event.clientX;
    this.pointerDownPos.y = event.clientY;
  }

  private onPointerUp(event: PointerEvent): void {
    const dx = event.clientX - this.pointerDownPos.x;
    const dy = event.clientY - this.pointerDownPos.y;
    // Ignore drags (OrbitControls rotations)
    if (dx * dx + dy * dy > 25) return;

    const hit = this.pickComponent(event);
    if (hit === this.selectedComponent) {
      this.selectComponent(null);
    } else {
      this.selectComponent(hit);
    }
  }

  private onResize(): void {
    if (this.isDisposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public dispose(): void {
    this.isDisposed = true;
    this.stopLoop();
    window.removeEventListener('resize', this.handleResizeBound);
    this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMoveBound);
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDownBound);
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUpBound);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLostBound);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.handleContextRestoredBound);

    this.controls.dispose();
    this.rig.dispose();
    this.materials.dispose();
    this.textures.dispose();
    for (const g of this.studioGeos) g.dispose();
    this.pmremEnv?.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
