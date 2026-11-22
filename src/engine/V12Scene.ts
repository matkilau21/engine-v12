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
  ArMode,
  ArPlacementPhase,
  ArScaleMode,
  ArStatus,
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
  onArStatusChange: (status: ArStatus) => void;
  onRpmSync?: (rpm: number) => void;
}

export interface V12SceneState {
  isPlaying: boolean;
  targetRpm: number;
  timeScale: number;
  explodeAmount: number;
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
const _planeHitPoint = new THREE.Vector3();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _reticlePos = new THREE.Vector3();
const _reticleQuat = new THREE.Quaternion();
const _reticleScale = new THREE.Vector3();
const _xrCamWorldPos = new THREE.Vector3();

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
  private arExtraMats: THREE.Material[] = [];

  // Scene hierarchy groups
  private studioPlinthGroup: THREE.Group;
  private arEngineAnchor: THREE.Group;
  private arContactShadow: THREE.Mesh;
  private reticleGroup: THREE.Group;
  private reticleInnerRing: THREE.Mesh;
  private arPreviewGrid: THREE.Group;

  // Lights
  private keyLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private rimLight: THREE.DirectionalLight;
  private softboxes: THREE.RectAreaLight[] = [];

  // Engine Simulation State
  private state: V12SceneState = {
    isPlaying: true,
    targetRpm: 1200,
    timeScale: 0.08,
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

  // WebXR & AR Placement State
  private arStatus: ArStatus = {
    webxrSupported: false,
    mode: 'studio',
    phase: 'idle',
    scaleMode: 'tabletop',
    errorMessage: null,
  };
  private xrSession: XRSession | null = null;
  private xrController: THREE.XRTargetRaySpace;
  private hitTestSource: XRHitTestSource | null = null;
  private hitTestSourceRequested = false;
  private arSpawnScaleCurrent = 1.0;
  private arSpawnScaleTarget = 1.0;
  private previewScanTimer = 0;
  private reticlePulsePhase = 0;

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
  private handleXrSelectBound: () => void;

  constructor(container: HTMLElement, callbacks: V12SceneCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.isSoftwareGl = detectSoftwareWebGL();

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    // 1. WebGLRenderer with alpha: true & WebXR enabled for transparent AR camera passthrough
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.xr.enabled = true;
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

    // 3. Camera & OrbitControls
    this.camera = new THREE.PerspectiveCamera(38, width / height, 0.05, 120);
    const heroCam = CAMERA_PRESETS[0];
    this.camera.position.set(...heroCam.position);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(...heroCam.target);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = 24;
    this.controls.maxPolarAngle = Math.PI * 0.488;
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 0.65;
    this.controls.addEventListener('start', () => {
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

    // 5. Procedural Textures, PBR Materials & Full V12 Engine Geometry inside AR Anchor
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.textures = createProceduralTextures(maxAniso);
    this.materials = createEngineMaterials(this.textures, this.isSoftwareGl);
    this.rig = buildV12Engine(this.materials);

    this.arEngineAnchor = new THREE.Group();
    this.arEngineAnchor.add(this.rig.engineRoot);

    // Dedicated AR contact shadow attached to engine anchor (moves & scales with spawned engine!)
    const arShadowGeo = new THREE.PlaneGeometry(8.8, 11.2);
    arShadowGeo.rotateX(-Math.PI / 2);
    this.studioGeos.push(arShadowGeo);
    this.arContactShadow = new THREE.Mesh(arShadowGeo, this.materials.contactShadow);
    this.arContactShadow.position.y = 0.025;
    this.arEngineAnchor.add(this.arContactShadow);

    this.scene.add(this.arEngineAnchor);

    // 6. Grounded Studio Turntable Plinth
    this.studioPlinthGroup = new THREE.Group();
    this.buildStudioPlinth();
    this.scene.add(this.studioPlinthGroup);

    // 7. WebXR Surface Detection Reticle & AR Preview Surface Plane Grid
    const { group: reticle, innerRing } = this.buildSurfaceReticle();
    this.reticleGroup = reticle;
    this.reticleInnerRing = innerRing;
    this.reticleGroup.visible = false;
    this.scene.add(this.reticleGroup);

    this.arPreviewGrid = this.buildArPreviewSurfaceGrid();
    this.arPreviewGrid.visible = false;
    this.scene.add(this.arPreviewGrid);

    // 8. WebXR Controller for screen-tap / controller-trigger select spawning
    this.xrController = this.renderer.xr.getController(0);
    this.handleXrSelectBound = this.onXrSelect.bind(this);
    this.xrController.addEventListener('select', this.handleXrSelectBound);
    this.scene.add(this.xrController);

    // 9. Probe WebXR immersive-ar capability asynchronously
    void this.probeWebXRSupport();

    // 10. Apply initial poses & pre-warm shaders
    this.updateKinematics(0);
    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // 11. Bind events
    this.handleResizeBound = this.onResize.bind(this);
    this.handlePointerMoveBound = this.onPointerMove.bind(this);
    this.handlePointerDownBound = this.onPointerDown.bind(this);
    this.handlePointerUpBound = this.onPointerUp.bind(this);
    this.handleContextLostBound = (e: Event) => {
      e.preventDefault();
      this.stopLoop();
    };
    this.handleContextRestoredBound = () => {
      if (!this.isDisposed && !this.xrSession) this.startLoop();
    };

    window.addEventListener('resize', this.handleResizeBound);
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMoveBound);
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDownBound);
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUpBound);
    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLostBound);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestoredBound);

    // 12. Start standard render loop
    this.lastTimeMs = performance.now();
    this.startLoop();
  }

  private buildStudioPlinth(): void {
    const floorGeo = new THREE.CircleGeometry(36, 64);
    floorGeo.rotateX(-Math.PI / 2);
    this.studioGeos.push(floorGeo);
    const floor = new THREE.Mesh(floorGeo, this.materials.floorPlinth);
    floor.position.y = -0.10;
    floor.receiveShadow = true;
    this.studioPlinthGroup.add(floor);

    const plinthGeo = new THREE.CylinderGeometry(6.9, 7.15, 0.12, 72);
    this.studioGeos.push(plinthGeo);
    const plinth = new THREE.Mesh(plinthGeo, this.materials.floorPlinth);
    plinth.position.y = -0.06;
    plinth.receiveShadow = true;
    this.studioPlinthGroup.add(plinth);

    const rimGeo = new THREE.TorusGeometry(6.94, 0.035, 10, 96);
    rimGeo.rotateX(Math.PI / 2);
    this.studioGeos.push(rimGeo);
    const rim = new THREE.Mesh(rimGeo, this.materials.floorRimAccent);
    rim.position.y = 0.0;
    this.studioPlinthGroup.add(rim);
  }

  /**
   * Precision automotive AR surface detection reticle lying flat on the detected plane.
   * Built at 1.0 unit nominal diameter; scaled to 0.24 m in native WebXR or 1.45 units in preview.
   */
  private buildSurfaceReticle(): { group: THREE.Group; innerRing: THREE.Mesh } {
    const group = new THREE.Group();

    const outerMat = new THREE.MeshBasicMaterial({
      color: 0xf4f6f9,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const accentMat = new THREE.MeshBasicMaterial({
      color: 0xd93829,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.arExtraMats.push(outerMat, accentMat, fillMat);

    // Outer calibrated ring
    const outerRingGeo = new THREE.RingGeometry(0.42, 0.46, 48);
    outerRingGeo.rotateX(-Math.PI / 2);
    this.studioGeos.push(outerRingGeo);
    const outerRing = new THREE.Mesh(outerRingGeo, outerMat);
    outerRing.position.y = 0.01;
    group.add(outerRing);

    // Subtle translucent plane target disc
    const fillGeo = new THREE.CircleGeometry(0.41, 48);
    fillGeo.rotateX(-Math.PI / 2);
    this.studioGeos.push(fillGeo);
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.position.y = 0.008;
    group.add(fill);

    // Inner crimson target ring
    const innerRingGeo = new THREE.RingGeometry(0.16, 0.195, 36);
    innerRingGeo.rotateX(-Math.PI / 2);
    this.studioGeos.push(innerRingGeo);
    const innerRing = new THREE.Mesh(innerRingGeo, accentMat);
    innerRing.position.y = 0.012;
    group.add(innerRing);

    // Center dot
    const dotGeo = new THREE.CircleGeometry(0.032, 18);
    dotGeo.rotateX(-Math.PI / 2);
    this.studioGeos.push(dotGeo);
    const dot = new THREE.Mesh(dotGeo, outerMat);
    dot.position.y = 0.014;
    group.add(dot);

    // 4 machined compass ticks around outer ring
    const tickGeo = new THREE.PlaneGeometry(0.032, 0.14);
    tickGeo.rotateX(-Math.PI / 2);
    this.studioGeos.push(tickGeo);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const tick = new THREE.Mesh(tickGeo, i === 0 ? accentMat : outerMat);
      tick.position.set(Math.sin(a) * 0.54, 0.013, Math.cos(a) * 0.54);
      tick.rotation.y = a;
      group.add(tick);
    }

    return { group, innerRing };
  }

  /**
   * Subtle spatial plane-detection grid shown during desktop/preview AR surface scanning.
   */
  private buildArPreviewSurfaceGrid(): THREE.Group {
    const group = new THREE.Group();
    const grid = new THREE.GridHelper(18, 24, 0xd93829, 0x4b5568);
    const gridMats = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const m of gridMats) {
      m.transparent = true;
      m.opacity = 0.28;
      m.depthWrite = false;
      this.arExtraMats.push(m);
    }
    grid.position.y = 0.012;
    this.studioGeos.push(grid.geometry);
    group.add(grid);
    return group;
  }

  private emitArStatus(): void {
    this.callbacks.onArStatusChange({ ...this.arStatus });
  }

  private async probeWebXRSupport(): Promise<void> {
    try {
      const xr = navigator.xr;
      if (xr && typeof xr.isSessionSupported === 'function') {
        const supported = await xr.isSessionSupported('immersive-ar');
        if (!this.isDisposed) {
          this.arStatus.webxrSupported = supported;
          this.emitArStatus();
        }
      }
    } catch {
      // WebXR blocked or unavailable in this browser context
    }
  }

  // =========================================================================
  // WEBXR IMMERSIVE-AR & SURFACE PLACEMENT API
  // =========================================================================

  /**
   * Launches a real WebXR `immersive-ar` hit-test session on supported devices,
   * or falls back cleanly to interactive Surface Placement Preview mode on desktop browsers.
   */
  public async startArExperience(domOverlayRoot?: HTMLElement | null): Promise<void> {
    this.arStatus.errorMessage = null;

    if (this.arStatus.webxrSupported && navigator.xr) {
      try {
        await this.enterNativeWebXR(domOverlayRoot ?? null);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to start WebXR AR session.';
        // Fallback gracefully to interactive AR Surface Placement mode while informing user
        this.arStatus.errorMessage = `${msg} Switched to AR Surface Preview.`;
        this.enterArPreviewMode();
        return;
      }
    }

    this.enterArPreviewMode();
  }

  private async enterNativeWebXR(domOverlayRoot: HTMLElement | null): Promise<void> {
    const xr = navigator.xr;
    if (!xr) throw new Error('WebXR API unavailable.');

    const baseInit: XRSessionInit = {
      requiredFeatures: ['hit-test'],
      optionalFeatures: domOverlayRoot ? ['dom-overlay', 'local-floor'] : ['local-floor'],
    };
    if (domOverlayRoot) {
      baseInit.domOverlay = { root: domOverlayRoot };
    }

    let session: XRSession;
    try {
      session = await xr.requestSession('immersive-ar', baseInit);
    } catch {
      // Retry without dom-overlay in case browser rejects optional overlay root
      session = await xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['local-floor'],
      });
    }

    this.xrSession = session;
    this.hitTestSource = null;
    this.hitTestSourceRequested = false;

    // Stop non-XR loop before attaching WebXR session
    this.stopLoop();

    // Hide studio backdrop & plinth for real camera passthrough
    document.documentElement.classList.add('xr-active');
    this.renderer.setClearColor(0x000000, 0);
    this.scene.background = null;
    this.scene.fog = null;
    this.studioPlinthGroup.visible = false;
    this.arPreviewGrid.visible = false;
    this.controls.enabled = false;
    this.camAnimating = false;

    // Hide engine until user detects a flat surface and taps screen!
    this.arEngineAnchor.visible = false;
    this.arSpawnScaleCurrent = 0.001;
    this.arSpawnScaleTarget = this.getTargetArScale('webxr');

    // Prepare reticle for matrix-driven WebXR hit-test poses
    this.reticleGroup.matrixAutoUpdate = false;
    this.reticleGroup.visible = false;

    this.arStatus.mode = 'webxr';
    this.arStatus.phase = 'scanning';
    this.arStatus.errorMessage = null;
    this.emitArStatus();

    session.addEventListener('end', () => {
      this.onNativeWebXREnd();
    });

    this.renderer.xr.setReferenceSpaceType('local');
    await this.renderer.xr.setSession(session);

    this.lastTimeMs = performance.now();
    this.renderer.setAnimationLoop((timestamp: number, frame?: XRFrame) => {
      this.onXRAnimationFrame(timestamp, frame);
    });
  }

  private onNativeWebXREnd(): void {
    this.renderer.setAnimationLoop(null);
    if (this.hitTestSource) {
      try {
        this.hitTestSource.cancel();
      } catch {
        // ignore if already ended
      }
      this.hitTestSource = null;
    }
    this.hitTestSourceRequested = false;
    this.xrSession = null;

    this.restoreStudioMode();
    if (!this.isDisposed) {
      this.startLoop();
    }
  }

  private onXRAnimationFrame(timestamp: number, frame?: XRFrame): void {
    if (this.isDisposed) return;

    const dt = Math.min(0.05, Math.max(0.001, (timestamp - this.lastTimeMs) / 1000));
    this.lastTimeMs = timestamp;

    // WebXR Real-World Surface Plane Hit-Testing
    if (frame && this.arStatus.phase !== 'placed') {
      const referenceSpace = this.renderer.xr.getReferenceSpace();
      const session = this.renderer.xr.getSession();

      if (session && !this.hitTestSourceRequested) {
        this.hitTestSourceRequested = true;
        session
          .requestReferenceSpace('viewer')
          .then((viewerSpace) => {
            if (typeof session.requestHitTestSource === 'function') {
              return session.requestHitTestSource({ space: viewerSpace });
            }
            return undefined;
          })
          .then((source) => {
            if (source && !this.isDisposed && this.xrSession === session) {
              this.hitTestSource = source;
            }
          })
          .catch(() => {
            // Hit-test source failed to initialize
          });
      }

      if (this.hitTestSource && referenceSpace) {
        const hitTestResults = frame.getHitTestResults(this.hitTestSource);
        if (hitTestResults.length > 0) {
          const pose = hitTestResults[0].getPose(referenceSpace);
          if (pose) {
            // Decompose real-world surface pose and apply calibrated 0.24 m reticle scale
            this.reticleGroup.matrix.fromArray(pose.transform.matrix);
            this.reticleGroup.matrix.decompose(_reticlePos, _reticleQuat, _reticleScale);
            _reticleScale.setScalar(0.24);
            this.reticleGroup.matrix.compose(_reticlePos, _reticleQuat, _reticleScale);
            this.reticleGroup.visible = true;

            if (this.arStatus.phase !== 'surface-detected') {
              this.arStatus.phase = 'surface-detected';
              this.emitArStatus();
            }
          }
        } else {
          this.reticleGroup.visible = false;
          if (this.arStatus.phase !== 'scanning') {
            this.arStatus.phase = 'scanning';
            this.emitArStatus();
          }
        }
      }
    }

    // Animate reticle alignment ring subtly while surface detected
    if (this.reticleGroup.visible) {
      this.reticlePulsePhase += dt * 2.2;
      const s = 1 + Math.sin(this.reticlePulsePhase) * 0.06;
      this.reticleInnerRing.scale.set(s, 1, s);
    }

    // Step engine kinematics & smooth spawn scale-up (skip OrbitControls during XR)
    this.stepSimulation(dt, true);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Native WebXR screen-tap / trigger select event: spawns the V12 at the detected surface reticle.
   */
  private onXrSelect(): void {
    if (this.arStatus.mode !== 'webxr') return;
    if (this.arStatus.phase !== 'surface-detected' || !this.reticleGroup.visible) return;

    this.spawnEngineAtReticle();
  }

  /**
   * Interactive AR Surface Placement mode for desktop/non-WebXR browsers so users can
   * test surface plane detection, live reticle tracking, and tap/click-to-spawn anywhere.
   */
  public enterArPreviewMode(): void {
    if (this.xrSession) return;

    this.arStatus.mode = 'preview';
    this.arStatus.phase = 'scanning';
    this.previewScanTimer = 0.45; // brief realistic surface scan lock-on

    // Clear selection & hide engine until user clicks detected surface!
    this.selectComponent(null);
    this.arEngineAnchor.visible = false;
    this.arSpawnScaleCurrent = 0.001;
    this.arSpawnScaleTarget = this.getTargetArScale('preview');

    // Show detected plane grid and position reticle cleanly on plane
    this.arPreviewGrid.visible = true;
    this.reticleGroup.matrixAutoUpdate = true;
    this.reticleGroup.position.set(0, 0.01, 0);
    this.reticleGroup.rotation.set(0, 0, 0);
    this.reticleGroup.scale.setScalar(1.45);
    this.reticleGroup.visible = false;

    // Tilt camera slightly toward floor plane so user can scan and pick spawn location
    _targetCamPos.set(6.8, 6.2, 8.2);
    _targetControlsLook.set(0, 0.4, 0);
    this.camAnimating = true;

    this.emitArStatus();
  }

  private getTargetArScale(mode: ArMode): number {
    if (mode === 'webxr') {
      // 1 Three.js unit = 0.1 meters (100 mm).
      // 'full' = 0.10 (true 1:1 6.5L V12 ~72 cm length), 'tabletop' = 0.052 (~38 cm desk scale).
      return this.arStatus.scaleMode === 'full' ? 0.10 : 0.052;
    }
    if (mode === 'preview') {
      return this.arStatus.scaleMode === 'full' ? 1.0 : 0.72;
    }
    return 1.0;
  }

  private spawnEngineAtReticle(): void {
    if (this.arStatus.mode === 'webxr') {
      this.reticleGroup.matrix.decompose(_reticlePos, _reticleQuat, _reticleScale);
      this.arEngineAnchor.position.copy(_reticlePos);

      // Face engine gracefully toward the user's XR camera at a heroic 35° angle
      const xrCam = this.renderer.xr.getCamera();
      xrCam.getWorldPosition(_xrCamWorldPos);
      const dx = _xrCamWorldPos.x - _reticlePos.x;
      const dz = _xrCamWorldPos.z - _reticlePos.z;
      this.arEngineAnchor.rotation.set(0, Math.atan2(dx, dz) - 0.62, 0);
    } else {
      // Preview AR surface spawn at exact clicked plane point
      this.arEngineAnchor.position.set(this.reticleGroup.position.x, 0, this.reticleGroup.position.z);
      const dx = this.camera.position.x - this.reticleGroup.position.x;
      const dz = this.camera.position.z - this.reticleGroup.position.z;
      this.arEngineAnchor.rotation.set(0, Math.atan2(dx, dz) - 0.62, 0);

      // Gently frame the spawned engine on its new spot
      _targetControlsLook.set(
        this.arEngineAnchor.position.x,
        1.85 * this.getTargetArScale('preview'),
        this.arEngineAnchor.position.z
      );
      _targetCamPos.set(
        this.arEngineAnchor.position.x + 6.4,
        4.4,
        this.arEngineAnchor.position.z + 6.8
      );
      this.camAnimating = true;
    }

    this.arSpawnScaleCurrent = 0.005;
    this.arSpawnScaleTarget = this.getTargetArScale(this.arStatus.mode);
    this.arEngineAnchor.scale.setScalar(this.arSpawnScaleCurrent);
    this.arEngineAnchor.visible = true;
    this.reticleGroup.visible = false;
    this.arPreviewGrid.visible = false;

    this.arStatus.phase = 'placed';
    this.emitArStatus();
  }

  public repositionArEngine(): void {
    if (this.arStatus.mode === 'studio') return;
    this.selectComponent(null);
    this.arEngineAnchor.visible = false;
    this.arSpawnScaleCurrent = 0.001;

    if (this.arStatus.mode === 'webxr') {
      this.arStatus.phase = 'scanning';
      this.reticleGroup.visible = false;
    } else {
      this.arPreviewGrid.visible = true;
      this.reticleGroup.visible = true;
      this.arStatus.phase = 'surface-detected';
    }
    this.emitArStatus();
  }

  public setArScaleMode(scaleMode: ArScaleMode): void {
    this.arStatus.scaleMode = scaleMode;
    if (this.arStatus.mode !== 'studio') {
      this.arSpawnScaleTarget = this.getTargetArScale(this.arStatus.mode);
    }
    this.emitArStatus();
  }

  public exitArMode(): void {
    if (this.xrSession) {
      void this.xrSession.end();
      return;
    }
    if (this.arStatus.mode === 'preview') {
      this.restoreStudioMode();
    }
  }

  private restoreStudioMode(): void {
    document.documentElement.classList.remove('xr-active');
    const preset = LIGHTING_PRESETS.find((l) => l.id === this.state.lightingId) ?? LIGHTING_PRESETS[0];
    this.renderer.setClearColor(preset.bgHex, 1);
    this.scene.background = new THREE.Color(preset.bgHex);
    this.scene.fog = new THREE.FogExp2(preset.fogHex, 0.022);
    this.studioPlinthGroup.visible = true;
    this.arPreviewGrid.visible = false;
    this.reticleGroup.visible = false;
    this.reticleGroup.matrixAutoUpdate = true;

    this.arEngineAnchor.visible = true;
    this.arEngineAnchor.position.set(0, 0, 0);
    this.arEngineAnchor.rotation.set(0, 0, 0);
    this.arEngineAnchor.scale.setScalar(1);
    this.arSpawnScaleCurrent = 1;
    this.arSpawnScaleTarget = 1;

    this.controls.enabled = true;
    this.setCameraPreset('hero');

    this.arStatus.mode = 'studio';
    this.arStatus.phase = 'idle';
    this.arStatus.errorMessage = null;
    this.emitArStatus();
  }

  // =========================================================================
  // PUBLIC ENGINE CONTROL API
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
    this.blipTimer = 1.35;
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

    if (this.arStatus.mode !== 'webxr') {
      _bgColorTarget.set(preset.bgHex);
      this.scene.background = _bgColorTarget.clone();
      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.color.set(preset.fogHex);
      }
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
    if (this.arStatus.mode === 'webxr') return;
    const preset = CAMERA_PRESETS.find((c) => c.id === presetId) ?? CAMERA_PRESETS[0];
    const ax = this.arEngineAnchor.position.x;
    const az = this.arEngineAnchor.position.z;
    _targetCamPos.set(preset.position[0] + ax, preset.position[1], preset.position[2] + az);
    _targetControlsLook.set(preset.target[0] + ax, preset.target[1], preset.target[2] + az);
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
  // NON-XR RENDER LOOP & SOFTWARE WEBGL PACING
  // =========================================================================

  private startLoop(): void {
    this.lastTimeMs = performance.now();
    const tick = () => {
      if (this.isDisposed || this.xrSession) return;
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTimeMs) / 1000));
      this.lastTimeMs = now;

      this.stepSimulation(dt, false);
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
      if (this.isDisposed || this.xrSession) {
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

  private stepSimulation(dt: number, inWebXR: boolean): void {
    // 0. AR Preview initial surface scan lock-on + reticle breathing
    if (this.arStatus.mode === 'preview' && this.arStatus.phase === 'scanning') {
      this.previewScanTimer -= dt;
      if (this.previewScanTimer <= 0) {
        this.reticleGroup.visible = true;
        this.arStatus.phase = 'surface-detected';
        this.emitArStatus();
      }
    }
    if (!inWebXR && this.reticleGroup.visible) {
      this.reticlePulsePhase += dt * 2.2;
      const s = 1 + Math.sin(this.reticlePulsePhase) * 0.06;
      this.reticleInnerRing.scale.set(s, 1, s);
    }

    // 0b. Smoothly damp AR engine spawn scale-in and scale-mode switches
    if (this.arEngineAnchor.visible && Math.abs(this.arSpawnScaleCurrent - this.arSpawnScaleTarget) > 0.0002) {
      this.arSpawnScaleCurrent = THREE.MathUtils.damp(
        this.arSpawnScaleCurrent,
        this.arSpawnScaleTarget,
        7.5,
        dt
      );
      this.arEngineAnchor.scale.setScalar(this.arSpawnScaleCurrent);
    }

    // 1. Inertial RPM spool & rev-blip envelope
    let desiredRpm = this.state.targetRpm;
    if (this.blipTimer > 0) {
      this.blipTimer = Math.max(0, this.blipTimer - dt);
      desiredRpm = this.blipTimer > 0.72 ? this.blipPeakRpm : this.state.targetRpm;
    }
    const rpmLambda = desiredRpm > this.currentRpm ? 8.5 : 3.2;
    this.currentRpm = THREE.MathUtils.damp(this.currentRpm, desiredRpm, rpmLambda, dt);
    if (Math.abs(this.currentRpm - desiredRpm) < 1) this.currentRpm = desiredRpm;

    // 2. Advance crankshaft angle when running
    if (this.state.isPlaying && this.currentRpm > 0.5) {
      const omegaReal = (this.currentRpm / 60) * Math.PI * 2;
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

    // 4. Smoothly damped camera preset choreography (non-XR only)
    if (!inWebXR) {
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
    }

    // 5. Update all mechanical kinematics & combustion visuals
    this.updateKinematics(dt);

    // 6. Throttled React HUD telemetry push (~20 Hz)
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

    this.rig.crankshaftGroup.rotation.z = cr;
    this.rig.flywheelSpinGroup.rotation.z = cr;
    this.rig.frontCrankPulley.rotation.z = cr;

    for (let i = 0; i < this.rig.camshaftSpinGroups.length; i++) {
      this.rig.camshaftSpinGroups[i].rotation.z = halfCr;
    }
    for (let i = 0; i < this.rig.camSprocketSpinGroups.length; i++) {
      this.rig.camSprocketSpinGroups[i].rotation.z = halfCr;
    }
    for (let i = 0; i < this.rig.idlerSpinGroups.length; i++) {
      this.rig.idlerSpinGroups[i].rotation.z = -cr * 1.45;
    }

    const throttleNorm = Math.max(0, Math.min(1, (this.currentRpm - 700) / 8400));
    const butterflyAngle = 0.10 + throttleNorm * 1.42;
    for (let i = 0; i < this.rig.throttleButterflies.length; i++) {
      this.rig.throttleButterflies[i].rotation.x = butterflyAngle;
    }

    this.materials.updateExhaustHeat(
      this.state.isPlaying ? this.currentRpm : 0,
      this.state.lightingId === 'thermal'
    );

    const showComb = this.state.showCombustion;
    const combVisibilityBoost = this.state.viewMode !== 'assembled' || this.currentExplode > 0.15 ? 1.0 : 0.0;

    for (let i = 0; i < 12; i++) {
      const cfg = CYLINDER_CONFIGS[i];
      const rig = this.rig.cylinderRigs[i];
      const kin = solveCylinderKinematics(cfg, cr, _kinScratch);

      rig.pistonGroup.position.set(kin.wristX, kin.wristY, cfg.zPos);
      rig.conrodGroup.position.set(kin.pinX, kin.pinY, cfg.zPos);
      rig.conrodGroup.rotation.z = kin.conrodAngleZ;

      const intDisp = -kin.intakeLift * V12_GEO.VALVE_MAX_LIFT;
      const intSpringScale = 1 - kin.intakeLift * 0.34;
      for (let v = 0; v < 2; v++) {
        const node = rig.intakeValves[v];
        node.stemGroup.position.y = node.baseY + intDisp;
        node.springMesh.scale.y = intSpringScale;
      }

      const exhDisp = -kin.exhaustLift * V12_GEO.VALVE_MAX_LIFT;
      const exhSpringScale = 1 - kin.exhaustLift * 0.34;
      for (let v = 0; v < 2; v++) {
        const node = rig.exhaustValves[v];
        node.stemGroup.position.y = node.baseY + exhDisp;
        node.springMesh.scale.y = exhSpringScale;
      }

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
  // INTERACTIVE RAYCASTING, AR SURFACE RETICLE TRACKING & CLICK-TO-SPAWN
  // =========================================================================

  private updatePointerNdc(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    _pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    _pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private pickComponent(event: PointerEvent): ComponentId | null {
    if (!this.arEngineAnchor.visible) return null;
    this.updatePointerNdc(event);
    this.raycaster.setFromCamera(_pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects(this.rig.selectableMeshes, false);
    if (hits.length > 0) {
      const compId = hits[0].object.userData.componentId as ComponentId | undefined;
      return compId ?? null;
    }
    return null;
  }

  private updatePreviewReticleFromPointer(event: PointerEvent): boolean {
    this.updatePointerNdc(event);
    this.raycaster.setFromCamera(_pointerNdc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(_groundPlane, _planeHitPoint);
    if (!hit) return false;

    // Keep reticle within the 16-unit architectural surface zone
    const maxR = 7.5;
    const len = Math.hypot(_planeHitPoint.x, _planeHitPoint.z);
    if (len > maxR) {
      _planeHitPoint.x = (_planeHitPoint.x / len) * maxR;
      _planeHitPoint.z = (_planeHitPoint.z / len) * maxR;
    }
    this.reticleGroup.position.set(_planeHitPoint.x, 0.01, _planeHitPoint.z);
    this.reticleGroup.visible = true;
    if (this.arStatus.phase !== 'surface-detected') {
      this.arStatus.phase = 'surface-detected';
      this.emitArStatus();
    }
    return true;
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.arStatus.mode === 'webxr') return;

    // In AR Preview placement mode, track the detected horizontal plane with the reticle
    if (this.arStatus.mode === 'preview' && this.arStatus.phase !== 'placed') {
      const hit = this.updatePreviewReticleFromPointer(event);
      this.renderer.domElement.style.cursor = hit ? 'crosshair' : 'grab';
      return;
    }

    const now = performance.now();
    if (now - this.lastHoverCheck < 55) return;
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
    if (dx * dx + dy * dy > 25) return; // Ignore camera orbit drags

    // In AR Preview mode, clicking on the detected surface spawns the V12 right at the reticle!
    if (this.arStatus.mode === 'preview' && this.arStatus.phase !== 'placed') {
      if (this.updatePreviewReticleFromPointer(event) || this.reticleGroup.visible) {
        this.spawnEngineAtReticle();
      }
      return;
    }

    // In WebXR DOM-overlay fallback taps directly on canvas, also allow spawning
    if (this.arStatus.mode === 'webxr' && this.arStatus.phase === 'surface-detected' && this.reticleGroup.visible) {
      this.spawnEngineAtReticle();
      return;
    }

    const hit = this.pickComponent(event);
    if (hit === this.selectedComponent) {
      this.selectComponent(null);
    } else {
      this.selectComponent(hit);
    }
  }

  private onResize(): void {
    if (this.isDisposed || this.xrSession) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public dispose(): void {
    this.isDisposed = true;
    this.stopLoop();
    this.renderer.setAnimationLoop(null);
    if (this.xrSession) {
      void this.xrSession.end();
      this.xrSession = null;
    }
    if (this.hitTestSource) {
      try {
        this.hitTestSource.cancel();
      } catch {
        // ignore
      }
      this.hitTestSource = null;
    }
    this.xrController.removeEventListener('select', this.handleXrSelectBound);

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
    for (const m of this.arExtraMats) m.dispose();
    this.pmremEnv?.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
