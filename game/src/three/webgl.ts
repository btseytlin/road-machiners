// Opens the game's one WebGL 2 context. A browser that cannot makes a WebGLUnavailable, which boot shows as a notice, not a crash.

import { t, type Msg } from '../text/msg';

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

export function noWebGLText(err: WebGLUnavailable, userAgent: string): { title: Msg; lines: Msg[]; detail: string | null } {
  const lines = [t('webgl.intro'), t('webgl.acceleration'), t('webgl.driver'), t('webgl.browser')];
  if (userAgent.includes('Firefox/')) lines.push(t('webgl.firefox'));
  lines.push(t('webgl.saves'));
  return { title: t('webgl.title'), lines, detail: err.reason };
}
