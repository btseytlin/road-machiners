// three's PCF shadow filter rotates 5 taps with screen-space noise. The noise is fixed to the screen, not the
// ground, so it crawls under a moving camera and leaves grainy, stepped edges. This swaps it for a fixed 3x3
// grid of compare taps, which gives a smooth penumbra that stays on the ground.
import * as THREE from "three";

const NOISY_TAPS = /float phi = interleavedGradientNoise\( gl_FragCoord\.xy \) \* PI2;[\s\S]*?\) \* 0\.2;/;

const GRID_TAPS = `float sum = 0.0;
				for ( int sx = -1; sx <= 1; sx ++ ) {
					for ( int sy = -1; sy <= 1; sy ++ ) {
						sum += texture( shadowMap, vec3( shadowCoord.xy + vec2( float( sx ), float( sy ) ) * radius, shadowCoord.z ) );
					}
				}
				shadow = sum / 9.0;`;

// Patches the shared shader chunk once. Call it before the first render. Only the 2D getShadow changes,
// which comes before getPointShadow.
export function installShadowFilter(): void {
  const chunk: string = THREE.ShaderChunk.shadowmap_pars_fragment;
  if (chunk.includes(GRID_TAPS)) return;
  const end = chunk.indexOf("float getPointShadow");
  const head = end < 0 ? chunk : chunk.slice(0, end);
  if (!NOISY_TAPS.test(head)) throw new Error("Shadow filter patch: three's 2D PCF block was not found");
  THREE.ShaderChunk.shadowmap_pars_fragment = head.replace(NOISY_TAPS, () => GRID_TAPS) + chunk.slice(head.length);
}

// Turns on PCF shadow maps with the smooth filter. Call it before the first render.
export function enableSunShadows(renderer: THREE.WebGLRenderer): void {
  installShadowFilter();
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
}
