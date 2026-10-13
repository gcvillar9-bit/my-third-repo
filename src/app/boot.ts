/**
 * Application boot. SCAFFOLD STUB: P1-A replaces it (engine, module discovery, loop,
 * URL state). It currently creates a WebGL2 renderer with log depth, renders a black
 * frame, mounts the UI stub and installs window.__universe under ?test=1.
 */
import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { CAMERA_FAR, CAMERA_NEAR } from '../core/contracts';
import { mountUi } from '../ui/index';
import { captureErrors, installTestApi, recordError } from './test-api';

export async function boot(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const test = params.get('test') === '1' || import.meta.env.DEV;
  if (test) captureErrors();

  const container = document.getElementById('app') ?? document.body;
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);

  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: test,
  });
  if (!gl) {
    container.textContent = 'Cosmos needs WebGL2, which this browser does not provide.';
    throw new Error('WebGL2 unavailable');
  }

  const renderer = new WebGLRenderer({ canvas, context: gl, antialias: false, logarithmicDepthBuffer: true });
  renderer.debug.onShaderError = (_gl, _program, vs, fs) => {
    recordError(`shader error: ${gl.getShaderInfoLog(vs) ?? ''} ${gl.getShaderInfoLog(fs) ?? ''}`.trim());
  };
  renderer.setClearColor(0x000000, 1);
  renderer.setPixelRatio(test ? 1 : Math.min(window.devicePixelRatio || 1, 2));

  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 1, CAMERA_NEAR, CAMERA_FAR);
  let frames = 0;
  const renderFrame = () => {
    renderer.render(scene, camera);
    frames++;
  };
  const resize = () => {
    const w = Math.max(1, container.clientWidth || window.innerWidth);
    const h = Math.max(1, container.clientHeight || window.innerHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!test) renderFrame();
  };

  let markBooted!: () => void;
  const booted = new Promise<void>((resolve) => (markBooted = resolve));
  if (test) installTestApi({ renderer, renderFrame, booted, frameCount: () => frames });

  window.addEventListener('resize', resize);
  resize();
  renderFrame();
  mountUi(document.getElementById('ui') ?? document.body);
  markBooted();
}
