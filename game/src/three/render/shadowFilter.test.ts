import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { installShadowFilter } from './shadowFilter';

const original = THREE.ShaderChunk.shadowmap_pars_fragment;
afterEach(() => {
  THREE.ShaderChunk.shadowmap_pars_fragment = original;
});

describe('installShadowFilter', () => {
  it('swaps the noisy PCF taps for a fixed grid and is idempotent', () => {
    installShadowFilter();
    const once = THREE.ShaderChunk.shadowmap_pars_fragment;
    expect(once).toContain('shadow = sum / 9.0;');
    const pcf = once.slice(once.indexOf('SHADOWMAP_TYPE_PCF'), once.indexOf('SHADOWMAP_TYPE_VSM'));
    expect(pcf).not.toContain('interleavedGradientNoise( gl_FragCoord.xy )');
    installShadowFilter();
    expect(THREE.ShaderChunk.shadowmap_pars_fragment).toBe(once);
  });

  it('throws when three no longer holds the block it replaces', () => {
    THREE.ShaderChunk.shadowmap_pars_fragment = original.replace('* 0.2;', '* 0.25;');
    expect(() => installShadowFilter()).toThrow(/2D PCF block/);
  });
});
