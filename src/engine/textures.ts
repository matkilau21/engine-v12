import * as THREE from 'three';

export interface ProceduralTextureSet {
  carbonAlbedo: THREE.CanvasTexture;
  carbonBump: THREE.CanvasTexture;
  carbonRoughness: THREE.CanvasTexture;
  crinkleBump: THREE.CanvasTexture;
  crinkleRoughness: THREE.CanvasTexture;
  castAlumBump: THREE.CanvasTexture;
  brushedMetalBump: THREE.CanvasTexture;
  brushedMetalRoughness: THREE.CanvasTexture;
  headerHeatAlbedo: THREE.CanvasTexture;
  floorAlbedo: THREE.CanvasTexture;
  floorRoughness: THREE.CanvasTexture;
  contactShadowAlpha: THREE.CanvasTexture;
  v12BadgeAlbedo: THREE.CanvasTexture;
  dispose: () => void;
}

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

function configureTexture(
  canvas: HTMLCanvasElement,
  {
    srgb = false,
    repeatX = 1,
    repeatY = 1,
    maxAnisotropy = 4,
    wrap = THREE.RepeatWrapping,
  }: {
    srgb?: boolean;
    repeatX?: number;
    repeatY?: number;
    maxAnisotropy?: number;
    wrap?: THREE.Wrapping;
  } = {}
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = wrap;
  tex.wrapT = wrap;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = maxAnisotropy;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates all 100% procedural PBR surface maps (carbon weave, crinkle paint,
 * sand-cast aluminum, anisotropic brushed titanium, thermal exhaust bluing,
 * studio turntable floor, contact shadow, and V12 cam-cover plaque).
 */
export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureSet {
  const allTextures: THREE.CanvasTexture[] = [];
  const track = (t: THREE.CanvasTexture) => {
    allTextures.push(t);
    return t;
  };

  // 1. 2x2 Twill Carbon Fiber (Albedo, Bump, Roughness)
  const [cAlbCanvas, cAlb] = makeCanvas(256, 256);
  const [cBmpCanvas, cBmp] = makeCanvas(256, 256);
  const [cRghCanvas, cRgh] = makeCanvas(256, 256);
  const cell = 16; // 16px per tow, 16x16 grid = 4 full 2x2 twill repeats
  for (let gy = 0; gy < 16; gy++) {
    for (let gx = 0; gx < 16; gx++) {
      // 2x2 twill pattern: diagonal shift of 1 per row
      const phase = (gx + gy) % 4;
      const isWarp = phase < 2;
      const x0 = gx * cell;
      const y0 = gy * cell;

      // Albedo weave gradient
      const gAlb = isWarp
        ? cAlb.createLinearGradient(x0, y0, x0 + cell, y0)
        : cAlb.createLinearGradient(x0, y0, x0, y0 + cell);
      if (isWarp) {
        gAlb.addColorStop(0, '#181a1f');
        gAlb.addColorStop(0.45, '#3b404a');
        gAlb.addColorStop(0.55, '#474d59');
        gAlb.addColorStop(1, '#14161a');
      } else {
        gAlb.addColorStop(0, '#101216');
        gAlb.addColorStop(0.48, '#282c34');
        gAlb.addColorStop(0.55, '#30353f');
        gAlb.addColorStop(1, '#0d0f12');
      }
      cAlb.fillStyle = gAlb;
      cAlb.fillRect(x0, y0, cell, cell);

      // Subtle micro-filament lines
      cAlb.fillStyle = 'rgba(255,255,255,0.035)';
      if (isWarp) {
        cAlb.fillRect(x0, y0 + 4, cell, 1);
        cAlb.fillRect(x0, y0 + 10, cell, 1);
      } else {
        cAlb.fillRect(x0 + 4, y0, 1, cell);
        cAlb.fillRect(x0 + 10, y0, 1, cell);
      }

      // Bump height
      const gBmp = isWarp
        ? cBmp.createLinearGradient(x0, y0, x0 + cell, y0)
        : cBmp.createLinearGradient(x0, y0, x0, y0 + cell);
      gBmp.addColorStop(0, '#404040');
      gBmp.addColorStop(0.5, isWarp ? '#f0f0f0' : '#c8c8c8');
      gBmp.addColorStop(1, '#383838');
      cBmp.fillStyle = gBmp;
      cBmp.fillRect(x0, y0, cell, cell);

      // Roughness variation between warp & weft
      cRgh.fillStyle = isWarp ? '#424242' : '#646464';
      cRgh.fillRect(x0, y0, cell, cell);
    }
  }
  const carbonAlbedo = track(configureTexture(cAlbCanvas, { srgb: true, repeatX: 5, repeatY: 5, maxAnisotropy }));
  const carbonBump = track(configureTexture(cBmpCanvas, { repeatX: 5, repeatY: 5, maxAnisotropy }));
  const carbonRoughness = track(configureTexture(cRghCanvas, { repeatX: 5, repeatY: 5, maxAnisotropy }));

  // 2. Ferrari/Italian Crinkle Paint Micro-Grain (Bump & Roughness)
  const [crkBmpCanvas, crkBmp] = makeCanvas(256, 256);
  const [crkRghCanvas, crkRgh] = makeCanvas(256, 256);
  const imgBmp = crkBmp.createImageData(256, 256);
  const imgRgh = crkRgh.createImageData(256, 256);
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < 256 * 256; i++) {
    const n1 = rand();
    const n2 = rand();
    // Crinkle speckle has crisp ridges and micro-valleys
    const h = Math.floor((n1 * 0.65 + n2 * 0.35) * 255);
    const r = Math.floor(135 + (1 - n1) * 75);
    const idx = i * 4;
    imgBmp.data[idx] = h;
    imgBmp.data[idx + 1] = h;
    imgBmp.data[idx + 2] = h;
    imgBmp.data[idx + 3] = 255;

    imgRgh.data[idx] = r;
    imgRgh.data[idx + 1] = r;
    imgRgh.data[idx + 2] = r;
    imgRgh.data[idx + 3] = 255;
  }
  crkBmp.putImageData(imgBmp, 0, 0);
  crkRgh.putImageData(imgRgh, 0, 0);
  const crinkleBump = track(configureTexture(crkBmpCanvas, { repeatX: 8, repeatY: 8, maxAnisotropy }));
  const crinkleRoughness = track(configureTexture(crkRghCanvas, { repeatX: 8, repeatY: 8, maxAnisotropy }));

  // 3. Sand-Cast Aluminum Grain (Block & Heads)
  const [castCanvas, castCtx] = makeCanvas(256, 256);
  const castImg = castCtx.createImageData(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const idx = (y * 256 + x) * 4;
      const base = 128 + (rand() - 0.5) * 70 + Math.sin(x * 0.14) * Math.cos(y * 0.14) * 14;
      const v = Math.max(0, Math.min(255, Math.floor(base)));
      castImg.data[idx] = v;
      castImg.data[idx + 1] = v;
      castImg.data[idx + 2] = v;
      castImg.data[idx + 3] = 255;
    }
  }
  castCtx.putImageData(castImg, 0, 0);
  const castAlumBump = track(configureTexture(castCanvas, { repeatX: 6, repeatY: 6, maxAnisotropy }));

  // 4. Anisotropic Brushed Billet Metal (Crank, Rods, Rails, Pulleys)
  const [brBmpCanvas, brBmp] = makeCanvas(256, 256);
  const [brRghCanvas, brRgh] = makeCanvas(256, 256);
  brBmp.fillStyle = '#808080';
  brBmp.fillRect(0, 0, 256, 256);
  brRgh.fillStyle = '#484848';
  brRgh.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y++) {
    const streak = Math.floor(110 + rand() * 42);
    brBmp.fillStyle = `rgb(${streak},${streak},${streak})`;
    brBmp.fillRect(0, y, 256, 1);
    const rStreak = Math.floor(46 + rand() * 44);
    brRgh.fillStyle = `rgb(${rStreak},${rStreak},${rStreak})`;
    brRgh.fillRect(0, y, 256, 1);
  }
  const brushedMetalBump = track(configureTexture(brBmpCanvas, { repeatX: 2, repeatY: 3, maxAnisotropy }));
  const brushedMetalRoughness = track(configureTexture(brRghCanvas, { repeatX: 2, repeatY: 3, maxAnisotropy }));

  // 5. Heat-Cycled Inconel / Titanium Exhaust Gradient (along UV u = tube length)
  const [heatCanvas, heatCtx] = makeCanvas(512, 128);
  const hGrad = heatCtx.createLinearGradient(0, 0, 512, 0);
  hGrad.addColorStop(0.0, '#c8b89d'); // port flange straw
  hGrad.addColorStop(0.14, '#b88e60'); // hot amber straw
  hGrad.addColorStop(0.28, '#8d6c7e'); // violet heat band
  hGrad.addColorStop(0.42, '#7d8ba8'); // subtle titanium blue
  hGrad.addColorStop(0.62, '#b9a892'); // mid runner golden bronze
  hGrad.addColorStop(0.84, '#9b836b'); // collector burnish
  hGrad.addColorStop(1.0, '#7e7369'); // collector exit
  heatCtx.fillStyle = hGrad;
  heatCtx.fillRect(0, 0, 512, 128);
  // Add subtle TIG weld rings every ~110px
  for (let wx = 64; wx < 500; wx += 112) {
    const wg = heatCtx.createLinearGradient(wx - 10, 0, wx + 10, 0);
    wg.addColorStop(0, 'rgba(60, 48, 82, 0)');
    wg.addColorStop(0.35, 'rgba(92, 68, 125, 0.34)');
    wg.addColorStop(0.5, 'rgba(218, 198, 165, 0.38)');
    wg.addColorStop(0.65, 'rgba(130, 92, 52, 0.30)');
    wg.addColorStop(1, 'rgba(60, 48, 82, 0)');
    heatCtx.fillStyle = wg;
    heatCtx.fillRect(wx - 10, 0, 20, 128);
  }
  const headerHeatAlbedo = track(
    configureTexture(heatCanvas, { srgb: true, repeatX: 1, repeatY: 1, maxAnisotropy, wrap: THREE.ClampToEdgeWrapping })
  );

  // 6. Studio Architectural Plinth Floor Texture (radial brushed + calibrated degree ticks)
  const [flAlbCanvas, flAlb] = makeCanvas(1024, 1024);
  const [flRghCanvas, flRgh] = makeCanvas(1024, 1024);
  const cx = 512;
  const cy = 512;
  const bgRad = flAlb.createRadialGradient(cx, cy, 40, cx, cy, 512);
  bgRad.addColorStop(0, '#c8ccd2');
  bgRad.addColorStop(0.55, '#aeb3bc');
  bgRad.addColorStop(1, '#8c919b');
  flAlb.fillStyle = bgRad;
  flAlb.fillRect(0, 0, 1024, 1024);

  // Subtle concentric machining rings
  flAlb.strokeStyle = 'rgba(255,255,255,0.06)';
  flAlb.lineWidth = 1.5;
  for (const r of [180, 310, 430, 485]) {
    flAlb.beginPath();
    flAlb.arc(cx, cy, r, 0, Math.PI * 2);
    flAlb.stroke();
  }
  // Calibrated turntable azimuth ticks around outer ring
  flAlb.strokeStyle = 'rgba(255,255,255,0.16)';
  for (let deg = 0; deg < 360; deg += 5) {
    const rad = (deg * Math.PI) / 180;
    const major = deg % 30 === 0;
    const r0 = major ? 448 : 464;
    const r1 = 480;
    flAlb.lineWidth = major ? 2 : 1;
    flAlb.beginPath();
    flAlb.moveTo(cx + Math.cos(rad) * r0, cy + Math.sin(rad) * r0);
    flAlb.lineTo(cx + Math.cos(rad) * r1, cy + Math.sin(rad) * r1);
    flAlb.stroke();
  }

  // Roughness floor map (satin center, slightly more matte outer)
  const rghRad = flRgh.createRadialGradient(cx, cy, 20, cx, cy, 512);
  rghRad.addColorStop(0, '#787878');
  rghRad.addColorStop(0.65, '#a8a8a8');
  rghRad.addColorStop(1, '#d8d8d8');
  flRgh.fillStyle = rghRad;
  flRgh.fillRect(0, 0, 1024, 1024);

  const floorAlbedo = track(configureTexture(flAlbCanvas, { srgb: true, maxAnisotropy, wrap: THREE.ClampToEdgeWrapping }));
  const floorRoughness = track(configureTexture(flRghCanvas, { maxAnisotropy, wrap: THREE.ClampToEdgeWrapping }));

  // 7. Soft Contact Shadow Alpha Map
  const [shCanvas, shCtx] = makeCanvas(512, 512);
  shCtx.clearRect(0, 0, 512, 512);
  shCtx.save();
  shCtx.translate(256, 256);
  shCtx.scale(0.82, 1.18); // elongated along engine Z axis
  const shGrad = shCtx.createRadialGradient(0, 0, 18, 0, 0, 210);
  shGrad.addColorStop(0, 'rgba(0,0,0,0.88)');
  shGrad.addColorStop(0.45, 'rgba(0,0,0,0.52)');
  shGrad.addColorStop(0.78, 'rgba(0,0,0,0.16)');
  shGrad.addColorStop(1, 'rgba(0,0,0,0)');
  shCtx.fillStyle = shGrad;
  shCtx.fillRect(-256, -256, 512, 512);
  shCtx.restore();
  const contactShadowAlpha = track(
    configureTexture(shCanvas, { srgb: true, maxAnisotropy, wrap: THREE.ClampToEdgeWrapping })
  );

  // 8. Embossed "V12 · 6.5L DOHC" Plaque Texture for Valve Covers
  const [bdgCanvas, bdg] = makeCanvas(512, 128);
  bdg.fillStyle = '#14161b';
  bdg.fillRect(0, 0, 512, 128);
  // Machined metallic bevel border
  bdg.strokeStyle = '#d4d8e0';
  bdg.lineWidth = 5;
  bdg.strokeRect(8, 8, 496, 112);
  // Crisp horizontal ribs
  bdg.fillStyle = '#242830';
  for (let y = 20; y < 108; y += 8) {
    bdg.fillRect(18, y, 476, 2);
  }
  // Center nameplate lettering
  bdg.fillStyle = '#eceff4';
  bdg.font = '700 58px "Barlow Condensed", sans-serif';
  bdg.textAlign = 'center';
  bdg.textBaseline = 'middle';
  bdg.fillText('ATELIER  V12  ·  6.5L', 256, 66);
  const v12BadgeAlbedo = track(
    configureTexture(bdgCanvas, { srgb: true, maxAnisotropy, wrap: THREE.ClampToEdgeWrapping })
  );

  return {
    carbonAlbedo,
    carbonBump,
    carbonRoughness,
    crinkleBump,
    crinkleRoughness,
    castAlumBump,
    brushedMetalBump,
    brushedMetalRoughness,
    headerHeatAlbedo,
    floorAlbedo,
    floorRoughness,
    contactShadowAlpha,
    v12BadgeAlbedo,
    dispose: () => {
      for (const t of allTextures) t.dispose();
    },
  };
}
