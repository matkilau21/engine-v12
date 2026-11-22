import React, { useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Eye,
  Flame,
  Gauge,
  Layers,
  Palette,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  StepForward,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import {
  CAMERA_PRESETS,
  CameraPresetId,
  COMPONENT_SPECS,
  ComponentId,
  ENGINE_SPECS,
  EngineTelemetry,
  FINISH_PRESETS,
  FinishId,
  LIGHTING_PRESETS,
  LightingId,
  StrokePhase,
  ViewMode,
} from '../engine/types';

type DockTab = 'drive' | 'inspect' | 'atelier' | 'camera';

interface ViewportHUDProps {
  telemetry: EngineTelemetry;
  isPlaying: boolean;
  targetRpm: number;
  timeScale: number;
  explodeAmount: number;
  viewMode: ViewMode;
  finishId: FinishId;
  lightingId: LightingId;
  activeCamera: CameraPresetId;
  showCombustion: boolean;
  autoRotate: boolean;
  audioEnabled: boolean;
  selectedComponent: ComponentId | null;
  hoveredComponent: ComponentId | null;
  hudCollapsed: boolean;
  onToggleHudCollapsed: () => void;
  onTogglePlay: () => void;
  onStepCrank: () => void;
  onChangeRpm: (rpm: number) => void;
  onRevBlip: () => void;
  onChangeTimeScale: (scale: number) => void;
  onChangeExplode: (val: number) => void;
  onChangeViewMode: (mode: ViewMode) => void;
  onChangeFinish: (id: FinishId) => void;
  onChangeLighting: (id: LightingId) => void;
  onSelectCamera: (id: CameraPresetId) => void;
  onToggleCombustion: () => void;
  onToggleAutoRotate: () => void;
  onToggleAudio: () => void;
  onClearSelection: () => void;
}

const PHASE_STYLES: Record<StrokePhase, { bg: string; label: string }> = {
  power: { bg: '#d94b2b', label: 'PWR' },
  exhaust: { bg: '#a34828', label: 'EXH' },
  intake: { bg: '#2b7bb9', label: 'INT' },
  compression: { bg: '#5a639c', label: 'CMP' },
};

const RPM_PRESETS = [
  { label: 'Idle', rpm: 950 },
  { label: 'Cruise', rpm: 3200 },
  { label: 'Peak HP', rpm: 8500 },
  { label: 'Redline', rpm: 9250 },
];

const TIME_SCALES = [
  { label: 'Real 1×', value: 1.0 },
  { label: 'Inspect 0.08×', value: 0.08 },
  { label: 'Slow 0.015×', value: 0.015 },
];

export const ViewportHUD: React.FC<ViewportHUDProps> = ({
  telemetry,
  isPlaying,
  targetRpm,
  timeScale,
  explodeAmount,
  viewMode,
  finishId,
  lightingId,
  activeCamera,
  showCombustion,
  autoRotate,
  audioEnabled,
  selectedComponent,
  hoveredComponent,
  hudCollapsed,
  onToggleHudCollapsed,
  onTogglePlay,
  onStepCrank,
  onChangeRpm,
  onRevBlip,
  onChangeTimeScale,
  onChangeExplode,
  onChangeViewMode,
  onChangeFinish,
  onChangeLighting,
  onSelectCamera,
  onToggleCombustion,
  onToggleAutoRotate,
  onToggleAudio,
  onClearSelection,
}) => {
  const [activeTab, setActiveTab] = useState<DockTab>('drive');

  const isLight = LIGHTING_PRESETS.find((l) => l.id === lightingId)?.isLightTheme ?? false;

  // Theme-paired solid/semi-opaque surfaces (zero backdrop-filter over WebGL!)
  const textPrimary = isLight ? 'text-[#111318]' : 'text-[#f3f4f6]';
  const textSecondary = isLight ? 'text-[#4b5260]' : 'text-[#9aa1ae]';
  const textMuted = isLight ? 'text-[#687080]' : 'text-[#737b8a]';
  const dockBg = isLight
    ? 'bg-[#f6f7f9]/95 border-[#111318]/12 text-[#111318]'
    : 'bg-[#101217]/94 border-white/10 text-[#f3f4f6]';
  const subSurface = isLight ? 'bg-[#e9ecf1]' : 'bg-[#191c23]';
  const btnIdle = isLight
    ? 'bg-[#eaedf2] text-[#2a303b] hover:bg-[#dfe3eb] border-transparent'
    : 'bg-[#1b1f27] text-[#c7cdd8] hover:bg-[#252a35] border-white/6';
  const btnActive = isLight
    ? 'bg-[#14171f] text-white border-[#14171f]'
    : 'bg-[#f2f4f7] text-[#0e1015] border-[#f2f4f7]';

  const rpmFraction = Math.min(1, telemetry.rpm / ENGINE_SPECS.maxRpm);
  const isNearRedline = telemetry.rpm >= 8200;
  const activeSpec = selectedComponent ? COMPONENT_SPECS[selectedComponent] : null;
  const hoverSpec = hoveredComponent ? COMPONENT_SPECS[hoveredComponent] : null;

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between p-4 sm:p-6">
      {/* TOP BAR: Minimal unboxed brand (top-left) & quiet live tabular telemetry (top-right) */}
      <header className="flex items-start justify-between gap-6">
        {/* Top-Left: Clean wordmark + quiet unboxed mechanical metadata */}
        <div className="pointer-events-auto select-none">
          <h1
            className={`font-display text-2xl sm:text-3xl font-semibold tracking-wide leading-none ${textPrimary}`}
          >
            Atelier V12
          </h1>
          <div className={`mt-1.5 flex items-center gap-2 text-xs font-medium ${textSecondary}`}>
            <span>6.5L NA</span>
            <span aria-hidden="true">·</span>
            <span>60° V12</span>
            <span aria-hidden="true">·</span>
            <span>48V DOHC</span>
            <span aria-hidden="true" className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">9,250 RPM Redline</span>
          </div>
          {hoverSpec && !activeSpec && (
            <div className={`mt-2 text-xs ${textMuted}`}>
              Click to inspect: <span className={textPrimary}>{hoverSpec.name}</span>
            </div>
          )}
        </div>

        {/* Top-Right: Unboxed live tabular mechanical telemetry */}
        <div className="pointer-events-none flex flex-col items-end text-right">
          <div className="flex items-baseline gap-2">
            <span
              className={`font-mono-num text-2xl sm:text-3xl font-semibold tracking-tight leading-none ${
                isNearRedline ? 'text-[#d93829]' : textPrimary
              }`}
            >
              {telemetry.rpm.toLocaleString()}
            </span>
            <span className={`text-xs font-medium ${textMuted}`}>RPM</span>
          </div>

          {/* Crisp 2px tachometer bar */}
          <div
            className={`mt-1.5 h-[2px] w-36 sm:w-44 overflow-hidden ${
              isLight ? 'bg-[#111318]/12' : 'bg-white/12'
            }`}
          >
            <div
              className="h-full transition-[width] duration-75"
              style={{
                width: `${rpmFraction * 100}%`,
                backgroundColor: isNearRedline ? '#d93829' : isLight ? '#181c24' : '#e5e7eb',
              }}
            />
          </div>

          <div
            className={`mt-1.5 flex items-center gap-2.5 text-xs font-mono-num ${textSecondary}`}
          >
            <span>{telemetry.horsepower} HP</span>
            <span aria-hidden="true">·</span>
            <span>{telemetry.torqueNm} Nm</span>
            <span aria-hidden="true" className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">{telemetry.crankAngleDeg}° CA</span>
            <span aria-hidden="true" className="hidden md:inline">·</span>
            <span className="hidden md:inline">Cyl #{telemetry.firingCylinder}</span>
          </div>
        </div>
      </header>

      {/* BOTTOM REGION: Optional Selected Component Bar + Unified Collapsible Control Dock */}
      <div className="flex flex-col items-center">
        {/* Selected Component Engineering Spec Strip (only shown when user clicks a 3D part) */}
        {activeSpec && !hudCollapsed && (
          <div
            className={`pointer-events-auto mb-2.5 w-full max-w-[920px] rounded-xl border px-4 py-3 shadow-lg transition-opacity duration-150 ${dockBg}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                  <span className="font-display text-lg font-semibold tracking-wide">
                    {activeSpec.name}
                  </span>
                  <span className={`text-xs ${textMuted}`}>·</span>
                  <span className={`text-xs ${textSecondary}`}>{activeSpec.subsystem}</span>
                </div>
                <p className={`mt-1 text-xs leading-relaxed ${textSecondary}`}>
                  {activeSpec.summary}
                </p>
                <div
                  className={`mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono-num ${textMuted}`}
                >
                  <span>Material: <strong className={textPrimary}>{activeSpec.material}</strong></span>
                  <span>Mass: <strong className={textPrimary}>{activeSpec.mass}</strong></span>
                  <span>Tolerance: <strong className={textPrimary}>{activeSpec.tolerance}</strong></span>
                </div>
              </div>
              <button
                type="button"
                onClick={onClearSelection}
                aria-label="Close component details"
                className={`shrink-0 rounded-lg p-1.5 transition-colors ${btnIdle}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Collapsible Drawer Handle */}
        <div className="pointer-events-auto flex flex-col items-center w-full max-w-[920px]">
          <button
            type="button"
            onClick={onToggleHudCollapsed}
            className={`flex items-center gap-1.5 rounded-t-lg border border-b-0 px-3.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${dockBg}`}
            title="Toggle controls (H)"
          >
            {hudCollapsed ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                <span>Show Controls</span>
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                <span>Hide Controls</span>
              </>
            )}
          </button>

          {/* Unified Horizontal Bottom Control Dock */}
          <div
            className={`w-full overflow-hidden rounded-xl border shadow-2xl transition-all duration-200 ${dockBg} ${
              hudCollapsed
                ? 'max-h-0 opacity-0 border-transparent pointer-events-none translate-y-4'
                : 'max-h-[260px] opacity-100 translate-y-0'
            }`}
          >
            {/* Dock Tab Row + Quick Action Bar */}
            <div
              className={`flex flex-wrap items-center justify-between gap-2 border-b px-3.5 py-2 ${
                isLight ? 'border-[#111318]/10' : 'border-white/8'
              }`}
            >
              {/* Primary Navigation Tabs */}
              <div className={`flex items-center gap-1 rounded-lg p-0.5 ${subSurface}`}>
                {(
                  [
                    { id: 'drive', label: 'Drive', icon: Gauge },
                    { id: 'inspect', label: 'Inspect', icon: Layers },
                    { id: 'atelier', label: 'Atelier', icon: Palette },
                    { id: 'camera', label: 'Camera', icon: Camera },
                  ] as const
                ).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      activeTab === id ? btnActive : `${textSecondary} hover:${textPrimary}`
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              {/* Persistent Quick Engineering Actions */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onTogglePlay}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${btnIdle}`}
                  title="Play / Pause (Space)"
                >
                  {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  <span>{isPlaying ? 'Pause' : 'Run'}</span>
                </button>

                <button
                  type="button"
                  onClick={onRevBlip}
                  className="flex items-center gap-1.5 rounded-lg bg-[#d93829] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#bf2d20] transition-colors whitespace-nowrap shrink-0"
                  title="Throttle blip to 9,150 RPM (R)"
                >
                  <Zap className="h-3.5 w-3.5" />
                  <span>Rev Blip</span>
                </button>

                <button
                  type="button"
                  onClick={onToggleAudio}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    audioEnabled ? btnActive : btnIdle
                  }`}
                  title="Toggle synthesized V12 exhaust audio"
                >
                  {audioEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">{audioEnabled ? 'Sound On' : 'Sound'}</span>
                </button>
              </div>
            </div>

            {/* Active Tab Body */}
            <div className="px-4 py-3">
              {/* TAB 1: DRIVE & KINEMATICS */}
              {activeTab === 'drive' && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-4">
                    {/* RPM Slider */}
                    <div className="flex min-w-[200px] flex-1 items-center gap-3">
                      <span className={`text-xs font-medium whitespace-nowrap ${textSecondary}`}>
                        Throttle
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={ENGINE_SPECS.maxRpm}
                        step={50}
                        value={targetRpm}
                        onChange={(e) => onChangeRpm(Number(e.target.value))}
                        aria-label="Target engine RPM"
                        className={`atelier-slider flex-1 ${isLight ? 'light-theme' : ''}`}
                      />
                      <span className="font-mono-num w-16 text-right text-xs font-medium">
                        {targetRpm.toLocaleString()}
                      </span>
                    </div>

                    {/* RPM Presets */}
                    <div className="flex items-center gap-1">
                      {RPM_PRESETS.map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => onChangeRpm(p.rpm)}
                          className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                            Math.abs(targetRpm - p.rpm) < 120 ? btnActive : btnIdle
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                      {!isPlaying && (
                        <button
                          type="button"
                          onClick={onStepCrank}
                          className={`flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${btnIdle}`}
                          title="Advance crankshaft by 30 degrees"
                        >
                          <StepForward className="h-3 w-3" />
                          <span>+30°</span>
                        </button>
                      )}
                    </div>

                    {/* Kinematics Time Scale */}
                    <div className={`flex items-center gap-1 rounded-lg p-0.5 ${subSurface}`}>
                      {TIME_SCALES.map((s) => (
                        <button
                          key={s.label}
                          type="button"
                          onClick={() => onChangeTimeScale(s.value)}
                          className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                            Math.abs(timeScale - s.value) < 0.005 ? btnActive : textSecondary
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Live 12-Cylinder Firing Order Matrix (1-12-5-8-3-10-6-7-2-11-4-9) */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className={`font-medium ${textMuted}`}>Firing Order</span>
                      <div className="flex items-center gap-1">
                        {ENGINE_SPECS.firingOrder.map((cylNum) => {
                          const cyl = telemetry.cylinders.find((c) => c.cylinderNumber === cylNum);
                          const phase = cyl?.phase ?? 'intake';
                          const isFiringNow = telemetry.firingCylinder === cylNum;
                          const st = PHASE_STYLES[phase];
                          return (
                            <div
                              key={cylNum}
                              className="flex flex-col items-center"
                              title={`Cylinder ${cylNum} (Bank ${cyl?.bank}) — ${phase.toUpperCase()}`}
                            >
                              <div
                                className="flex h-5 w-6 items-center justify-center rounded text-[10px] font-mono-num font-semibold text-white transition-transform duration-75"
                                style={{
                                  backgroundColor: st.bg,
                                  opacity: isFiringNow ? 1 : phase === 'power' ? 0.85 : 0.48,
                                  transform: isFiringNow ? 'scale(1.08)' : 'scale(1)',
                                }}
                              >
                                {cylNum}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className={`hidden md:flex items-center gap-3 text-[11px] font-mono-num ${textMuted}`}>
                      <span>Exhaust {telemetry.exhaustTempC}°C</span>
                      <span aria-hidden="true">·</span>
                      <span>Oil {telemetry.oilPressureBar.toFixed(1)} bar</span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: INSPECT (Cutaway, X-Ray, Exploded Slider, Combustion, Turntable) */}
              {activeTab === 'inspect' && (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  {/* View Mode Selector */}
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium whitespace-nowrap ${textSecondary}`}>
                      Housing
                    </span>
                    <div className={`flex items-center gap-1 rounded-lg p-0.5 ${subSurface}`}>
                      {(
                        [
                          { id: 'assembled', label: 'Assembled' },
                          { id: 'cutaway', label: 'Bank A Cutaway' },
                          { id: 'xray', label: 'X-Ray Shell' },
                        ] as { id: ViewMode; label: string }[]
                      ).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => onChangeViewMode(m.id)}
                          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                            viewMode === m.id ? btnActive : textSecondary
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Continuous Exploded Assembly Slider */}
                  <div className="flex min-w-[210px] flex-1 items-center gap-3">
                    <span className={`text-xs font-medium whitespace-nowrap ${textSecondary}`}>
                      Exploded
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(explodeAmount * 100)}
                      onChange={(e) => onChangeExplode(Number(e.target.value) / 100)}
                      aria-label="Exploded view separation percentage"
                      className={`atelier-slider flex-1 ${isLight ? 'light-theme' : ''}`}
                    />
                    <span className="font-mono-num w-10 text-right text-xs font-medium">
                      {Math.round(explodeAmount * 100)}%
                    </span>
                  </div>

                  {/* Combustion & Turntable Toggles */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={onToggleCombustion}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        showCombustion ? btnActive : btnIdle
                      }`}
                    >
                      <Flame className="h-3.5 w-3.5" />
                      <span>Combustion</span>
                    </button>
                    <button
                      type="button"
                      onClick={onToggleAutoRotate}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        autoRotate ? btnActive : btnIdle
                      }`}
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                      <span>Turntable</span>
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 3: ATELIER CONFIGURATOR (Finishes & Lighting Studio) */}
              {activeTab === 'atelier' && (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  {/* Bespoke Finish Presets */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-xs font-medium whitespace-nowrap ${textSecondary}`}>
                      Trim
                    </span>
                    {FINISH_PRESETS.map((preset) => {
                      const active = finishId === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => onChangeFinish(preset.id)}
                          className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                            active ? btnActive : btnIdle
                          }`}
                          title={preset.subtitle}
                        >
                          <span
                            className="inline-block h-3.5 w-3.5 rounded-full border border-white/25"
                            style={{
                              background: `linear-gradient(135deg, ${preset.swatch} 55%, ${preset.accentSwatch} 55%)`,
                            }}
                          />
                          <span>{preset.name}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Studio Lighting Rig */}
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium whitespace-nowrap ${textSecondary}`}>
                      Studio
                    </span>
                    <div className={`flex items-center gap-1 rounded-lg p-0.5 ${subSurface}`}>
                      {LIGHTING_PRESETS.map((l) => (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => onChangeLighting(l.id)}
                          className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                            lightingId === l.id ? btnActive : textSecondary
                          }`}
                        >
                          {l.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: CAMERA CHOREOGRAPHY */}
              {activeTab === 'camera' && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {CAMERA_PRESETS.map((cam, idx) => (
                      <button
                        key={cam.id}
                        type="button"
                        onClick={() => onSelectCamera(cam.id)}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                          activeCamera === cam.id ? btnActive : btnIdle
                        }`}
                      >
                        <span className="font-mono-num text-[10px] opacity-60">{idx + 1}</span>
                        <span>{cam.label}</span>
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectCamera('hero')}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${btnIdle}`}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Reset View</span>
                    </button>
                    <span className={`hidden lg:flex items-center gap-1 text-[11px] ${textMuted}`}>
                      <Eye className="h-3.5 w-3.5" />
                      <span>Click any engine component to inspect specs</span>
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
