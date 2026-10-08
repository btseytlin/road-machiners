// Chromium flags for drawing on the GPU. The GPU is Metal on a Mac and Vulkan on Linux, like the factory's NVIDIA host.
const ANGLE = {
  darwin: ['--use-angle=metal'],
  linux: ['--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface'],
};
const SOFTWARE_RENDERERS = /SwiftShader|llvmpipe/;

export function gpuArgs() {
  const angle = ANGLE[process.platform];
  if (!angle) throw new Error(`No GPU flags for ${process.platform}. Run with --cpu.`);
  return [...angle, '--enable-gpu', '--ignore-gpu-blocklist'];
}

// The WebGL renderer name, for the log.
export function rendererOf(page) {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    return gl ? gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) : 'no WebGL2';
  });
}

// A GPU run that fell back to software drawing measures the CPU, not the game.
export function isSoftware(renderer) {
  return SOFTWARE_RENDERERS.test(renderer);
}
