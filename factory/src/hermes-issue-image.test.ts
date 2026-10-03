import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allowedSource, extractMediaUrls } from './media.js';

const HERMES = join(import.meta.dirname, '..', 'hermes');
const SCRIPT = join(HERMES, 'factory-issue-image');
const ASSET = 'https://github.com/user-attachments/assets/0a1b2c3d-1111-4222-8333-444455556666';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('original pixels')]);

// Stub gh and curl. The stub gh keeps the issue body in a file. Its `--attach` appends a native link and keeps the bytes it got.
// STUB_VERSION, STUB_NO_ATTACH, STUB_UPLOAD_FAILS, STUB_NO_LINK, STUB_CORRUPT and STUB_CTYPE change what it does.
const GH = `#!/bin/bash
d="$STUB_DIR"
case "$1 $2" in
  "--version "*) echo "gh version \${STUB_VERSION:-2.102.0} (2026-01-01)" ;;
  "auth token") echo stub-token ;;
  "issue edit")
    if [ "$3" = "--help" ]; then
      echo "Flags:"; [ -n "$STUB_NO_ATTACH" ] || echo "      --attach strings   Attach files"; exit 0
    fi
    [ -z "$STUB_UPLOAD_FAILS" ] || { echo boom >&2; exit 1; }
    echo "$*" >> "$d/edit-args"
    spec="\${@: -1}"; path="\${spec%%#*}"; alt="\${spec#*#}"
    if [ -z "$STUB_NO_LINK" ]; then
      cp "$path" "$d/uploaded"
      printf '\\n![%s](${ASSET})\\n' "$alt" >> "$d/body"
    fi ;;
  "issue view") cat "$d/body" ;;
  *) echo "unexpected gh $*" >&2; exit 9 ;;
esac
`;
const CURL = `#!/bin/bash
out=""; while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift ;; esac; shift; done
cp "$STUB_DIR/uploaded" "$out"
[ -z "$STUB_CORRUPT" ] || printf x >> "$out"
printf '%s' "\${STUB_CTYPE:-image/png}"
`;

let dir: string;
let image: string;

function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync('bash', [SCRIPT, ...args], { env: { PATH: `${join(dir, 'bin')}:${process.env.PATH}`, HOME: dir, STUB_DIR: dir, ...env }, encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'issue-image-'));
  mkdirSync(join(dir, 'bin'));
  for (const [name, text] of [['gh', GH], ['curl', CURL]]) {
    writeFileSync(join(dir, 'bin', name), text);
    chmodSync(join(dir, 'bin', name), 0o755);
  }
  writeFileSync(join(dir, 'body'), 'Add a ruined gas station, like this concept.\n');
  image = join(dir, 'telegram.png');
  writeFileSync(image, PNG);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('factory-issue-image attach', () => {
  it('uploads the original bytes, reads the body back and prints the native url', () => {
    const { code, out, err } = run(['attach', '175', image, 'gas station concept']);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain(`ATTACHED ${ASSET}`);
    expect(readFileSync(join(dir, 'uploaded')).equals(PNG)).toBe(true);
    expect(readFileSync(join(dir, 'edit-args'), 'utf8')).toContain(`--attach ${image}#gas station concept`);
  });

  it('leaves a body the factory ingestion accepts and would mount', () => {
    expect(run(['attach', '175', image, 'concept']).code).toBe(0);
    const urls = extractMediaUrls(readFileSync(join(dir, 'body'), 'utf8'));
    expect(urls).toEqual([ASSET]);
    expect(allowedSource(urls[0])).toBe(true);
  });

  it('holds when the upload fails', () => {
    const { code, err } = run(['attach', '175', image, 'x'], { STUB_UPLOAD_FAILS: '1' });
    expect(code).toBe(1);
    expect(err).toContain('HELD: gh upload failed');
  });

  it('holds when the body has no new native link after the upload', () => {
    const { code, err } = run(['attach', '175', image, 'x'], { STUB_NO_LINK: '1' });
    expect(code).toBe(1);
    expect(err).toContain('no new github.com/user-attachments URL');
  });

  it('does not take an old link of the body for the upload', () => {
    writeFileSync(join(dir, 'body'), `old ![a](${ASSET})\n`);
    const { code, err } = run(['attach', '175', image, 'x'], { STUB_NO_LINK: '1' });
    expect(code).toBe(1);
    expect(err).toContain('HELD');
  });

  it('holds when the bytes read back differ or the content type is wrong', () => {
    expect(run(['attach', '175', image, 'x'], { STUB_CORRUPT: '1' }).err).toContain('differ from the original');
    writeFileSync(join(dir, 'body'), 'again\n');
    expect(run(['attach', '175', image, 'x'], { STUB_CTYPE: 'text/html' }).err).toContain("content type read back is 'text/html'");
  });

  it('holds on an old gh, and on a gh without --attach', () => {
    expect(run(['attach', '175', image, 'x'], { STUB_VERSION: '2.46.0' }).err).toContain('gh 2.46.0 is older than 2.102.0');
    expect(run(['attach', '175', image, 'x'], { STUB_NO_ATTACH: '1' }).err).toContain("no 'issue edit --attach'");
  });

  it('never calls gh for a file that is not a supported image', () => {
    const text = join(dir, 'note.png');
    writeFileSync(text, 'not an image');
    expect(run(['attach', '175', text, 'x']).err).toContain('not a PNG, JPEG, GIF or WebP');
    expect(() => readFileSync(join(dir, 'edit-args'))).toThrow();
  });

  it('refuses a private report or job file, even when it is a real image', () => {
    for (const sub of ['adhoc-artifacts/issue-9', 'hermes-jobs/audit', 'logs']) {
      mkdirSync(join(dir, sub), { recursive: true });
      const file = join(dir, sub, 'chart.png');
      writeFileSync(file, PNG);
      const { code, err } = run(['attach', '175', file, 'x']);
      expect(code, sub).toBe(1);
      expect(err, sub).toContain('refusing a private path');
    }
    expect(() => readFileSync(join(dir, 'edit-args'))).toThrow();
  });

  it('refuses a symlink and a bad issue number', () => {
    const link = join(dir, 'link.png');
    spawnSync('ln', ['-s', image, link]);
    expect(run(['attach', '175', link, 'x']).err).toContain('not a plain file');
    expect(run(['attach', 'abc', image, 'x']).err).toContain('issue must be a number');
  });
});

describe('Hermes provisioning', () => {
  it('pins the official gh in the image, checks its checksum and ships the command', () => {
    const dockerfile = readFileSync(join(HERMES, 'Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(/ARG GH_VERSION=2\.102\.0/);
    expect(dockerfile).toContain('https://github.com/cli/cli/releases/download/v${GH_VERSION}');
    expect(dockerfile).toContain('sha256sum -c');
    expect(dockerfile).not.toMatch(/apt-get install[^\n]*\bgh\b/);
    expect(dockerfile).toContain('COPY --chmod=755 factory-issue-image /usr/local/bin/factory-issue-image');
    expect(dockerfile).toContain('RUN /usr/local/bin/factory-issue-image check');
  });

  it('tells Hermes to upload, verify, hold on failure and never publish to the web root', () => {
    const soul = readFileSync(join(HERMES, 'SOUL.md'), 'utf8');
    const section = soul.slice(soul.indexOf('## Images from the committee'), soul.indexOf('## Bigger jobs'));
    expect(section).toContain('factory-issue-image attach');
    expect(section).toContain('ATTACHED <url>');
    expect(section).toContain('HELD');
    expect(section).toMatch(/web root/);
    expect(section).toMatch(/private/);
    expect(soul).not.toMatch(/copy[^.\n]*image[^.\n]*to roam-game\.online/i);
  });
});

// FACTORY_SMOKE_GH=1 checks the gh on this machine: the version and the real `issue edit --attach` flag.
describe.skipIf(!process.env.FACTORY_SMOKE_GH)('real gh', () => {
  it('has issue edit --attach', () => {
    const result = spawnSync('bash', [SCRIPT, 'check'], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/^gh \d+\.\d+\.\d+ supports --attach/);
  });
});
