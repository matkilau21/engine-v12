import { useCallback, useEffect, useRef, useState } from 'react';
import { ViewportHUD } from './components/ViewportHUD';
import { V12AudioSynth } from './engine/audioSynth';
import { createEmptyCylinderTelemetry } from './engine/kinematics';
import {
  ArScaleMode,
  ArStatus,
  CAMERA_PRESETS,
  CameraPresetId,
  ComponentId,
  EngineTelemetry,
  FinishId,
  LightingId,
  ViewMode,
} from './engine/types';
import { V12SceneController } from './engine/V12Scene';

const INITIAL_TELEMETRY: EngineTelemetry = {
  rpm: 1200,
  targetRpm: 1200,
  crankAngleDeg: 0,
  horsepower: 112,
  torqueNm: 486,
  firingCylinder: 1,
  exhaustTempC: 365,
  oilPressureBar: 2.8,
  cylinders: createEmptyCylinderTelemetry(),
};

const INITIAL_AR_STATUS: ArStatus = {
  webxrSupported: false,
  mode: 'studio',
  phase: 'idle',
  scaleMode: 'tabletop',
  errorMessage: null,
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const hudOverlayRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<V12SceneController | null>(null);
  const audioRef = useRef<V12AudioSynth | null>(null);
  const isPlayingRef = useRef(true);

  const [webglError, setWebglError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<EngineTelemetry>(INITIAL_TELEMETRY);
  const [arStatus, setArStatus] = useState<ArStatus>(INITIAL_AR_STATUS);
  const [isPlaying, setIsPlaying] = useState(true);
  const [targetRpm, setTargetRpm] = useState(1200);
  const [timeScale, setTimeScale] = useState(0.08);
  const [explodeAmount, setExplodeAmount] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('assembled');
  const [finishId, setFinishId] = useState<FinishId>('rosso');
  const [lightingId, setLightingId] = useState<LightingId>('atelier');
  const [activeCamera, setActiveCamera] = useState<CameraPresetId>('hero');
  const [showCombustion, setShowCombustion] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [selectedComponent, setSelectedComponent] = useState<ComponentId | null>(null);
  const [hoveredComponent, setHoveredComponent] = useState<ComponentId | null>(null);
  const [hudCollapsed, setHudCollapsed] = useState(false);

  // Mount Three.js WebGL/WebXR scene once in dedicated isolated canvas container
  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const audio = new V12AudioSynth();
    audioRef.current = audio;

    try {
      const controller = new V12SceneController(mount, {
        onTelemetry: (next) => {
          setTelemetry({
            ...next,
            cylinders: next.cylinders.map((c) => ({ ...c })),
          });
        },
        onSelectComponent: (id) => setSelectedComponent(id),
        onHoverComponent: (id) => setHoveredComponent(id),
        onArStatusChange: (status) => setArStatus(status),
        onRpmSync: (liveRpm) => {
          audio.update(liveRpm, isPlayingRef.current);
        },
      });
      sceneRef.current = controller;
    } catch (err) {
      setWebglError(err instanceof Error ? err.message : 'WebGL initialization failed.');
    }

    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
      audioRef.current?.dispose();
      audioRef.current = null;
    };
  }, []);

  const handleTogglePlay = useCallback(() => {
    setIsPlaying((prev) => {
      const next = !prev;
      isPlayingRef.current = next;
      sceneRef.current?.setPlaying(next);
      return next;
    });
  }, []);

  const handleStepCrank = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    sceneRef.current?.stepCrankAngleDeg(30);
  }, []);

  const handleChangeRpm = useCallback((rpm: number) => {
    setTargetRpm(rpm);
    sceneRef.current?.setTargetRpm(rpm);
    if (rpm > 0 && !isPlayingRef.current) {
      isPlayingRef.current = true;
      setIsPlaying(true);
      sceneRef.current?.setPlaying(true);
    }
  }, []);

  const handleRevBlip = useCallback(() => {
    isPlayingRef.current = true;
    setIsPlaying(true);
    sceneRef.current?.triggerRevBlip();
  }, []);

  const handleChangeTimeScale = useCallback((scale: number) => {
    setTimeScale(scale);
    sceneRef.current?.setTimeScale(scale);
  }, []);

  const handleChangeExplode = useCallback((val: number) => {
    setExplodeAmount(val);
    sceneRef.current?.setExplodeAmount(val);
  }, []);

  const handleChangeViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    sceneRef.current?.setViewMode(mode);
  }, []);

  const handleChangeFinish = useCallback((id: FinishId) => {
    setFinishId(id);
    sceneRef.current?.setFinish(id);
  }, []);

  const handleChangeLighting = useCallback((id: LightingId) => {
    setLightingId(id);
    sceneRef.current?.setLighting(id);
  }, []);

  const handleSelectCamera = useCallback((id: CameraPresetId) => {
    setActiveCamera(id);
    sceneRef.current?.setCameraPreset(id);
  }, []);

  const handleToggleCombustion = useCallback(() => {
    setShowCombustion((prev) => {
      const next = !prev;
      sceneRef.current?.setShowCombustion(next);
      return next;
    });
  }, []);

  const handleToggleAutoRotate = useCallback(() => {
    setAutoRotate((prev) => {
      const next = !prev;
      sceneRef.current?.setAutoRotate(next);
      return next;
    });
  }, []);

  const handleToggleAudio = useCallback(() => {
    if (!audioRef.current) return;
    const enabled = audioRef.current.toggle();
    setAudioEnabled(enabled);
  }, []);

  const handleClearSelection = useCallback(() => {
    sceneRef.current?.selectComponent(null);
  }, []);

  const handleStartAr = useCallback(() => {
    void sceneRef.current?.startArExperience(hudOverlayRef.current);
  }, []);

  const handleExitAr = useCallback(() => {
    sceneRef.current?.exitArMode();
  }, []);

  const handleRepositionAr = useCallback(() => {
    sceneRef.current?.repositionArEngine();
  }, []);

  const handleChangeArScale = useCallback((scaleMode: ArScaleMode) => {
    sceneRef.current?.setArScaleMode(scaleMode);
  }, []);

  // Keyboard shortcuts for engineering inspection
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.key === 'r' || e.key === 'R') {
        handleRevBlip();
      } else if (e.key === 'h' || e.key === 'H') {
        setHudCollapsed((prev) => !prev);
      } else if (e.key === 'e' || e.key === 'E') {
        setExplodeAmount((prev) => {
          const next = prev > 0.35 ? 0 : 0.85;
          sceneRef.current?.setExplodeAmount(next);
          return next;
        });
      } else if (e.key === 'c' || e.key === 'C') {
        setViewMode((prev) => {
          const order: ViewMode[] = ['assembled', 'cutaway', 'xray'];
          const next = order[(order.indexOf(prev) + 1) % order.length];
          sceneRef.current?.setViewMode(next);
          return next;
        });
      } else if (e.key >= '1' && e.key <= '6') {
        const idx = Number(e.key) - 1;
        const preset = CAMERA_PRESETS[idx];
        if (preset) handleSelectCamera(preset.id);
      } else if (e.key === 'Escape') {
        handleClearSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleClearSelection, handleRevBlip, handleSelectCamera, handleTogglePlay]);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-transparent">
      {/* Dedicated WebGL/WebXR Mount Container */}
      <div
        ref={canvasMountRef}
        className="h-full w-full"
        aria-label="Interactive 3D & WebXR V12 Engine Showcase Viewport"
      />

      {/* Graceful fallback if WebGL is unavailable */}
      {webglError && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#0b0c10] p-6 text-center text-[#f2f3f5]">
          <div className="max-w-md rounded-xl border border-white/10 bg-[#12141a] p-6">
            <h2 className="font-display text-2xl font-semibold">WebGL Viewport Unavailable</h2>
            <p className="mt-2 text-sm text-[#9aa1ae]">{webglError}</p>
          </div>
        </div>
      )}

      {/* Semantic HUD Overlay (also attached as WebXR dom-overlay root) */}
      {!webglError && (
        <ViewportHUD
          hudOverlayRef={hudOverlayRef}
          telemetry={telemetry}
          arStatus={arStatus}
          isPlaying={isPlaying}
          targetRpm={targetRpm}
          timeScale={timeScale}
          explodeAmount={explodeAmount}
          viewMode={viewMode}
          finishId={finishId}
          lightingId={lightingId}
          activeCamera={activeCamera}
          showCombustion={showCombustion}
          autoRotate={autoRotate}
          audioEnabled={audioEnabled}
          selectedComponent={selectedComponent}
          hoveredComponent={hoveredComponent}
          hudCollapsed={hudCollapsed}
          onToggleHudCollapsed={() => setHudCollapsed((prev) => !prev)}
          onTogglePlay={handleTogglePlay}
          onStepCrank={handleStepCrank}
          onChangeRpm={handleChangeRpm}
          onRevBlip={handleRevBlip}
          onChangeTimeScale={handleChangeTimeScale}
          onChangeExplode={handleChangeExplode}
          onChangeViewMode={handleChangeViewMode}
          onChangeFinish={handleChangeFinish}
          onChangeLighting={handleChangeLighting}
          onSelectCamera={handleSelectCamera}
          onToggleCombustion={handleToggleCombustion}
          onToggleAutoRotate={handleToggleAutoRotate}
          onToggleAudio={handleToggleAudio}
          onClearSelection={handleClearSelection}
          onStartAr={handleStartAr}
          onExitAr={handleExitAr}
          onRepositionAr={handleRepositionAr}
          onChangeArScale={handleChangeArScale}
        />
      )}
    </main>
  );
}
