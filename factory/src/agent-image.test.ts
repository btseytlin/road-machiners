import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dockerContainer } from './container';
import { realRun } from './exec';
import { fetchMedia, mediaSection } from './media';
import { solidPng } from './media-fixtures';
import type { FactoryConfig } from './types';

const DOCKER = resolve(__dirname, '../docker');
const SKILL = join(DOCKER, 'skills/blender-image-to-3d');
const SHA = 'f0ef29385a03de139957e6f700b801cdc00b7e29';

describe('the vendored Blender image skill', () => {
  it('is the whole upstream folder with its license and the pinned source commit', () => {
    for (const path of ['SKILL.md', 'LICENSE', 'SOURCE.md', 'assets/build_template.py', 'scripts/review_render.py', 'scripts/compose_review.py', 'references/categories.md', 'evals/evals.json']) {
      expect(existsSync(join(SKILL, path)), path).toBe(true);
    }
    expect(readFileSync(join(SKILL, 'LICENSE'), 'utf8')).toContain('MIT License');
    expect(readFileSync(join(SKILL, 'SOURCE.md'), 'utf8')).toContain(SHA);
    expect(readFileSync(join(SKILL, 'SKILL.md'), 'utf8')).toMatch(/^---\nname: blender-image-to-3d\n/);
  });

  it('is copied to the user skills of the image, with the Pillow its compare sheets need', () => {
    const dockerfile = readFileSync(join(DOCKER, 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('COPY --chown=pwuser:pwuser skills/ /home/pwuser/.claude/skills/');
    expect(dockerfile).toMatch(/apt-get install[^\n]*python3-pil/);
  });
});

// Runs the real entry script with a stub claude that lists what it would discover.
function runEntry(home: string, gameSkills: string): { code: number | null; out: string; err: string } {
  const bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'claude'), '#!/bin/bash\nls "$HOME/.claude/skills"\n');
  chmodSync(join(bin, 'claude'), 0o755);
  const result = spawnSync('bash', [join(DOCKER, 'factory-agent')], { env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, FACTORY_GAME_SKILLS: gameSkills }, encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

describe('factory-agent', () => {
  it('lets Claude discover the Blender skill beside the game skills', () => {
    const home = mkdtempSync(join(tmpdir(), 'factory-home-'));
    const game = mkdtempSync(join(tmpdir(), 'factory-game-skills-'));
    mkdirSync(join(game, 'typescript-practices'));
    writeFileSync(join(game, 'typescript-practices/SKILL.md'), '---\nname: typescript-practices\n---\n');
    mkdirSync(join(home, '.claude'), { recursive: true });
    spawnSync('cp', ['-r', join(DOCKER, 'skills'), join(home, '.claude/skills')]);
    const run = runEntry(home, game);
    expect(run.code).toBe(0);
    expect(run.out.split('\n').filter(Boolean).sort()).toEqual(['blender-image-to-3d', 'typescript-practices']);
    expect(readdirSync(join(home, '.claude/skills/blender-image-to-3d/scripts'))).toContain('review_render.py');
    rmSync(home, { recursive: true, force: true });
    rmSync(game, { recursive: true, force: true });
  });

  it('stops when the image lacks the Blender skill', () => {
    const home = mkdtempSync(join(tmpdir(), 'factory-home-'));
    const run = runEntry(home, tmpdir());
    expect(run.code).toBe(1);
    expect(run.err).toContain('blender-image-to-3d skill is missing');
    rmSync(home, { recursive: true, force: true });
  });
});

// The real check that the agent sees pixels. It needs the built agent image, a Claude token and the network, so it runs only when
// FACTORY_SMOKE_IMAGE names the image and CLAUDE_CODE_OAUTH_TOKEN is set. Run it after a Dockerfile change:
//   FACTORY_SMOKE_IMAGE=roam-factory-agent npx vitest run agent-image
const smoke = process.env.FACTORY_SMOKE_IMAGE !== undefined && process.env.CLAUDE_CODE_OAUTH_TOKEN !== undefined;

describe.skipIf(!smoke)('reference image in the real agent container', () => {
  it('lets Claude read the pixels of a mounted image, and the Blender skill is listed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'factory-smoke-'));
    const clone = join(root, 'clone');
    mkdirSync(join(clone, 'game/.agents/skills/none'), { recursive: true });
    writeFileSync(join(clone, 'game/.agents/skills/none/SKILL.md'), '---\nname: none\ndescription: none\n---\n');
    const png = join(root, 'src.png');
    writeFileSync(png, solidPng(64, 64, [0, 200, 0]));
    const asset = 'https://github.com/user-attachments/assets/24c78bbf-b445-42bb-a191-2eba2e36379e';
    const host = async (input: URL | string): Promise<Response> => (String(input) === asset
      ? new Response(null, { status: 302, headers: { location: 'https://github-production-user-asset-6210df.s3.amazonaws.com/1/2' } })
      : new Response(new Uint8Array(readFileSync(png)), { status: 200 }));
    const media = join(root, 'media');
    const entries = await fetchMedia({ fetch: host as typeof fetch, dir: media, texts: [{ source: 'issue body', text: asset }] });
    const log = join(root, 'agent.log');
    const cfg = { image: process.env.FACTORY_SMOKE_IMAGE, oauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN, elevenlabsKey: '', sfxMaxGenerations: 0, home: root } as FactoryConfig;
    const prompt = `${mediaSection(entries)}\n\nLook at the reference image. Answer with exactly two lines. Line 1: the one word name of its main color (red, green, blue, ...). Line 2: the name of every skill you can use that mentions Blender.`;
    await dockerContainer(realRun, cfg, null).agent({ clone, dir: 'game', model: 'haiku', prompt, log, openNetwork: true, mediaDir: media });
    const text = readFileSync(log, 'utf8').toLowerCase();
    expect(text).toContain('green');
    expect(text).toContain('blender-image-to-3d');
    rmSync(root, { recursive: true, force: true });
  }, 300_000);
});
