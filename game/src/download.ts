import { DOWNLOAD } from './config';

export class DownloadFailed extends Error {
  readonly url: string;

  constructor(url: string, tries: number, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Download of ${url} failed ${tries} times: ${reason}`, { cause });
    this.name = 'DownloadFailed';
    this.url = url;
  }
}

export class HttpStatusError extends Error {
  constructor(url: string, readonly status: number) {
    super(`File ${url} failed to load: HTTP ${status}`);
  }
}

export type Body = { response: Response; bytes: ArrayBuffer };

export type DownloadDeps = {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  wait?: (ms: number) => Promise<void>;
};

function retryable(status: number): boolean {
  return status === 404 || status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Outcome = { body: Body } | { status: number };

async function attempt(url: string, init: RequestInit | undefined, get: NonNullable<DownloadDeps['fetch']>): Promise<Outcome> {
  const response = await get(url, init);
  if (response.ok) return { body: { response, bytes: await response.arrayBuffer() } };
  return { status: response.status };
}

export async function download(url: string, deps: DownloadDeps = {}): Promise<ArrayBuffer> {
  return (await downloadBody(url, undefined, deps)).bytes;
}

export async function downloadBody(url: string, init?: RequestInit, deps: DownloadDeps = {}): Promise<Body> {
  const get = deps.fetch ?? ((u: string, i?: RequestInit) => (i ? globalThis.fetch(u, i) : globalThis.fetch(u)));
  const wait = deps.wait ?? pause;
  let dropped: unknown;
  let status: number | null = null;
  for (let i = 0; i < DOWNLOAD.tries; i++) {
    if (i > 0) await wait(DOWNLOAD.waitMs[i - 1]);
    try {
      const outcome = await attempt(url, init, get);
      if ('body' in outcome) return outcome.body;
      status = outcome.status;
    } catch (e) {
      dropped = e;
      status = null;
      continue;
    }
    if (!retryable(status)) break;
  }
  if (status === null) throw new DownloadFailed(url, DOWNLOAD.tries, dropped);
  throw new HttpStatusError(url, status);
}
