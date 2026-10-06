import { mkdirSync, mkdtempSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pngBytes } from './photo-fixtures';
import { botClient } from './telegram';

type Call = { url: string; init: RequestInit };

function fakeFetch(replies: unknown[]): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(replies[calls.length - 1] ?? replies[replies.length - 1]));
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const ok = (id: number) => ({ ok: true, result: { message_id: id } });
const body = (call: Call) => JSON.parse(call.init.body as string);

describe('botClient sendButtons', () => {
  it('sends one message with an inline keyboard', async () => {
    const { fetchFn, calls } = fakeFetch([ok(51)]);
    expect(await botClient('T', fetchFn).sendButtons('-100', 'review', [[{ text: 'Queue as change', data: 'factory:waste:9' }]])).toBe(51);
    expect(body(calls[0]!)).toEqual({ chat_id: '-100', text: 'review', reply_markup: { inline_keyboard: [[{ text: 'Queue as change', callback_data: 'factory:waste:9' }]] } });
  });

  it('refuses a text it would have to split', async () => {
    const { fetchFn, calls } = fakeFetch([ok(1)]);
    await expect(botClient('T', fetchFn).sendButtons('c', 'a'.repeat(4097), [[{ text: 'x', data: 'y' }]])).rejects.toThrow('limit is 4096');
    expect(calls).toEqual([]);
  });
});

describe('botClient sendMessage', () => {
  it('posts JSON to the bot endpoint and returns the message id', async () => {
    const { fetchFn, calls } = fakeFetch([ok(41)]);
    expect(await botClient('T0K', fetchFn).sendMessage('-100', 'hi')).toBe(41);
    expect(calls[0]!.url).toBe('https://api.telegram.org/botT0K/sendMessage');
    expect(body(calls[0]!)).toEqual({ chat_id: '-100', text: 'hi' });
  });

  it('adds reply_parameters when replyTo is given', async () => {
    const { fetchFn, calls } = fakeFetch([ok(1)]);
    await botClient('T', fetchFn).sendMessage('c', 'hi', 9);
    expect(body(calls[0]!).reply_parameters).toEqual({ message_id: 9 });
  });

  it('splits text over 4096 chars and returns the first id', async () => {
    const { fetchFn, calls } = fakeFetch([ok(10), ok(11), ok(12)]);
    const text = `${'a'.repeat(3000)}\n${'b'.repeat(3000)}\n${'c'.repeat(3000)}`;
    expect(await botClient('T', fetchFn).sendMessage('c', text, 5)).toBe(10);
    const parts = calls.map((c) => body(c).text as string);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
    expect(parts.join('').replace(/\n/g, '')).toBe(text.replace(/\n/g, ''));
    expect(calls.map((c) => body(c).reply_parameters)).toEqual([{ message_id: 5 }, undefined, undefined]);
  });

  it('splits a long text with no newline', async () => {
    const { fetchFn, calls } = fakeFetch([ok(1), ok(2)]);
    await botClient('T', fetchFn).sendMessage('c', 'x'.repeat(5000));
    expect(calls.map((c) => (body(c).text as string).length)).toEqual([4096, 904]);
  });

  it('throws with the Telegram description when ok is false', async () => {
    const { fetchFn } = fakeFetch([{ ok: false, description: 'chat not found' }]);
    await expect(botClient('T', fetchFn).sendMessage('c', 'hi')).rejects.toThrow('chat not found');
  });
});

describe('botClient sendDocument', () => {
  it('posts the file as a reply to the given message', async () => {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
    const path = join(mkdtempSync(join(process.cwd(), 'tmp', 'tg-')), 'report.html');
    writeFileSync(path, '<html></html>');
    const { fetchFn, calls } = fakeFetch([ok(9)]);
    expect(await botClient('T', fetchFn).sendDocument('-100', path, 4)).toBe(9);
    expect(calls[0]!.url).toBe('https://api.telegram.org/botT/sendDocument');
    const form = calls[0]!.init.body as FormData;
    expect(form.get('chat_id')).toBe('-100');
    expect(JSON.parse(form.get('reply_parameters') as string)).toEqual({ message_id: 4 });
    expect((form.get('document') as File).name).toBe('report.html');
  });

  it('refuses a missing file, a link, an empty file and a file over 50 MB before any request', async () => {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
    const dir = mkdtempSync(join(process.cwd(), 'tmp', 'tg-'));
    writeFileSync(join(dir, 'empty.csv'), '');
    writeFileSync(join(dir, 'big.zip'), 'x');
    truncateSync(join(dir, 'big.zip'), 50 * 1024 * 1024 + 1);
    symlinkSync('/etc/passwd', join(dir, 'link.txt'));
    const { fetchFn, calls } = fakeFetch([ok(9)]);
    const client = botClient('T', fetchFn);
    for (const name of ['missing.csv', 'link.txt']) await expect(client.sendDocument('-100', join(dir, name), 4)).rejects.toThrow('not a regular file');
    for (const name of ['empty.csv', 'big.zip']) await expect(client.sendDocument('-100', join(dir, name), 4)).rejects.toThrow('the limit is');
    expect(calls).toEqual([]);
  });

  it('throws the Telegram description when the upload is refused', async () => {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
    const path = join(mkdtempSync(join(process.cwd(), 'tmp', 'tg-')), 'a.csv');
    writeFileSync(path, 'a,b');
    const { fetchFn } = fakeFetch([{ ok: false, description: 'Bad Request: chat not found' }]);
    await expect(botClient('T', fetchFn).sendDocument('-100', path, 4)).rejects.toThrow('chat not found');
  });
});

describe('botClient sendPhoto', () => {
  const png = (): string => {
    const dir = mkdtempSync(join(process.cwd(), 'tmp', 'tg-'));
    const path = join(dir, 'shot.png');
    writeFileSync(path, Buffer.from([1, 2, 3]));
    return path;
  };

  it('posts multipart form data with the file as a blob', async () => {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
    const { fetchFn, calls } = fakeFetch([ok(77)]);
    expect(await botClient('T', fetchFn).sendPhoto('-100', png(), 'cap')).toBe(77);
    expect(calls[0]!.url).toBe('https://api.telegram.org/botT/sendPhoto');
    const form = calls[0]!.init.body as FormData;
    expect(form.get('chat_id')).toBe('-100');
    expect(form.get('caption')).toBe('cap');
    const file = form.get('photo') as File;
    expect(file.name).toBe('shot.png');
    expect(file.size).toBe(3);
  });

  it('sends the buttons as an inline keyboard', async () => {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
    const { fetchFn, calls } = fakeFetch([ok(5)]);
    await botClient('T', fetchFn).sendPhoto('c', png(), 'cap', [[{ text: 'Yes', data: 'factory:approve:4' }, { text: 'No', data: 'factory:deny:4' }]]);
    const markup = (calls[0]!.init.body as FormData).get('reply_markup') as string;
    expect(JSON.parse(markup)).toEqual({ inline_keyboard: [[{ text: 'Yes', callback_data: 'factory:approve:4' }, { text: 'No', callback_data: 'factory:deny:4' }]] });
  });

  it('sends no reply_markup without buttons', async () => {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
    const { fetchFn, calls } = fakeFetch([ok(5)]);
    await botClient('T', fetchFn).sendPhoto('c', png(), 'cap');
    expect((calls[0]!.init.body as FormData).has('reply_markup')).toBe(false);
  });

  it('throws when callback data is over 64 bytes', async () => {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
    const { fetchFn, calls } = fakeFetch([ok(1)]);
    await expect(botClient('T', fetchFn).sendPhoto('c', png(), 'cap', [[{ text: 'x', data: 'd'.repeat(65) }]])).rejects.toThrow('64');
    expect(calls).toHaveLength(0);
  });

  it('throws when the caption is over 1024 chars', async () => {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
    const { fetchFn, calls } = fakeFetch([ok(1)]);
    await expect(botClient('T', fetchFn).sendPhoto('c', png(), 'x'.repeat(1025))).rejects.toThrow('1024');
    expect(calls).toHaveLength(0);
  });

  it('throws with the Telegram description when ok is false', async () => {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
    const { fetchFn } = fakeFetch([{ ok: false, description: 'wrong file' }]);
    await expect(botClient('T', fetchFn).sendPhoto('c', png(), 'cap')).rejects.toThrow('wrong file');
  });
});

describe('botClient sendPhotos', () => {
  const dir = (): string => {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
    return mkdtempSync(join(process.cwd(), 'tmp', 'tg-album-'));
  };
  const photos = (count: number): { path: string; caption: string }[] => {
    const folder = dir();
    return Array.from({ length: count }, (_, i) => {
      const path = join(folder, `view${i}.png`);
      writeFileSync(path, pngBytes(i));
      return { path, caption: `view ${i}` };
    });
  };
  const group = (count: number, first = 200) => ({ ok: true, result: Array.from({ length: count }, (_, i) => ({ message_id: first + i })) });

  it('sends one photo as sendPhoto, as a reply, with no buttons', async () => {
    const { fetchFn, calls } = fakeFetch([ok(9)]);
    expect(await botClient('T', fetchFn).sendPhotos('c', photos(1), 4)).toEqual([9]);
    expect(calls[0]!.url).toBe('https://api.telegram.org/botT/sendPhoto');
    const form = calls[0]!.init.body as FormData;
    expect(JSON.parse(form.get('reply_parameters') as string)).toEqual({ message_id: 4 });
    expect(form.get('caption')).toBe('view 0');
    expect(form.has('reply_markup')).toBe(false);
  });

  it('sends two photos as a media group with attach references', async () => {
    const { fetchFn, calls } = fakeFetch([group(2)]);
    expect(await botClient('T', fetchFn).sendPhotos('c', photos(2), 4)).toEqual([200, 201]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.telegram.org/botT/sendMediaGroup');
    const form = calls[0]!.init.body as FormData;
    expect(JSON.parse(form.get('media') as string)).toEqual([
      { type: 'photo', media: 'attach://photo0', caption: 'view 0' },
      { type: 'photo', media: 'attach://photo1', caption: 'view 1' },
    ]);
    expect((form.get('photo0') as File).name).toBe('view0.png');
    expect((form.get('photo1') as File).type).toBe('image/png');
    expect(JSON.parse(form.get('reply_parameters') as string)).toEqual({ message_id: 4 });
    expect(form.has('reply_markup')).toBe(false);
  });

  it('sends ten photos in one group, in order', async () => {
    const { fetchFn, calls } = fakeFetch([group(10)]);
    expect(await botClient('T', fetchFn).sendPhotos('c', photos(10))).toHaveLength(10);
    const media = JSON.parse((calls[0]!.init.body as FormData).get('media') as string) as { caption: string }[];
    expect(media.map((item) => item.caption)).toEqual(Array.from({ length: 10 }, (_, i) => `view ${i}`));
    expect((calls[0]!.init.body as FormData).has('reply_parameters')).toBe(false);
  });

  it('refuses none and more than ten photos before any request', async () => {
    const { fetchFn, calls } = fakeFetch([group(11)]);
    await expect(botClient('T', fetchFn).sendPhotos('c', photos(11))).rejects.toThrow('1 to 10');
    await expect(botClient('T', fetchFn).sendPhotos('c', [])).rejects.toThrow('1 to 10');
    expect(calls).toHaveLength(0);
  });

  it('refuses a missing file, a non-image and an oversized one before any request', async () => {
    const { fetchFn, calls } = fakeFetch([group(2)]);
    const [first, second] = photos(2);
    const client = botClient('T', fetchFn);
    await expect(client.sendPhotos('c', [first!, { path: join(dir(), 'nope.png'), caption: 'x' }])).rejects.toThrow('missing');
    writeFileSync(second!.path, 'not an image at all, just text bytes');
    await expect(client.sendPhotos('c', [first!, second!])).rejects.toThrow('not a PNG, JPEG or WebP');
    writeFileSync(second!.path, pngBytes(1, 9000, 2000));
    await expect(client.sendPhotos('c', [first!, second!])).rejects.toThrow('too large');
    expect(calls).toHaveLength(0);
  });

  it('throws with the Telegram description when the album fails', async () => {
    const { fetchFn } = fakeFetch([{ ok: false, description: 'Bad Request: wrong file identifier' }]);
    await expect(botClient('T', fetchFn).sendPhotos('c', photos(3))).rejects.toThrow('wrong file identifier');
  });

  it('throws when the reply holds fewer messages than photos', async () => {
    const { fetchFn } = fakeFetch([group(1)]);
    await expect(botClient('T', fetchFn).sendPhotos('c', photos(3))).rejects.toThrow('1 messages for 3 photos');
  });
});
