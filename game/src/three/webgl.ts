// Opens the game's one WebGL 2 context. A browser that cannot makes a WebGLUnavailable, which boot shows as a notice, not a crash.

export class WebGLUnavailable extends Error {
  readonly reason: string | null;
  constructor(reason: string | null, options?: { cause?: unknown }) {
    super(`This browser could not create a WebGL 2 context${reason ? `: ${reason}` : ''}`, options);
    this.name = 'WebGLUnavailable';
    this.reason = reason;
  }
}

export type WebGLSurface = { canvas: HTMLCanvasElement; context: WebGL2RenderingContext };

// The attributes three asks for by itself, so handing it this context changes nothing it draws. Alpha is on, as three always asks.
export const GAME_GL: WebGLContextAttributes = {
  alpha: true,
  depth: true,
  stencil: true,
  antialias: true,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: 'default',
};

export function openWebGL(canvas: HTMLCanvasElement, attributes: WebGLContextAttributes): WebGLSurface {
  let reason: string | null = null;
  const onCreationError = (e: Event) => {
    reason = (e as WebGLContextEvent).statusMessage || null;
  };
  canvas.addEventListener('webglcontextcreationerror', onCreationError);
  try {
    const context = canvas.getContext('webgl2', attributes);
    if (!context) throw new WebGLUnavailable(reason);
    return { canvas, context };
  } catch (e) {
    if (e instanceof WebGLUnavailable) throw e;
    throw new WebGLUnavailable(reason, { cause: e });
  } finally {
    canvas.removeEventListener('webglcontextcreationerror', onCreationError);
  }
}

export function noWebGLText(err: WebGLUnavailable, userAgent: string): { title: string; lines: string[]; detail: string | null } {
  const lines = [
    'Your browser could not start 3D graphics. Try one of these:',
    '• Turn on hardware acceleration in the browser settings.',
    '• Update the graphics driver.',
    '• Open the game in another browser.',
  ];
  if (userAgent.includes('Firefox/')) lines.push('• In Firefox, about:support shows the WebGL status.');
  lines.push('Your saves stay in this browser. The game loads them once WebGL works.');
  return { title: 'Road Machiners needs WebGL', lines, detail: err.reason };
}
