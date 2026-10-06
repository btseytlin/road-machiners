import { lstatSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { readPhoto } from './photo-file';
import type { AlbumPhoto, InlineButton, Telegram } from './types';

const MESSAGE_LIMIT = 4096;
const CAPTION_LIMIT = 1024;
const CALLBACK_DATA_LIMIT = 64; // bytes
const ALBUM_MAX = 10; // Telegram's limit of one media group
export const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024; // the Bot API's limit for an uploaded file

type ApiReply = { ok: boolean; description?: string; result?: unknown };

export function botClient(token: string, fetchFn: typeof fetch): Telegram {
  const call = async (method: string, body: string | FormData): Promise<unknown> => {
    const headers = typeof body === 'string' ? { 'content-type': 'application/json' } : undefined;
    const response = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers, body });
    const reply = (await response.json()) as ApiReply;
    if (!reply.ok || !reply.result) throw new Error(`Telegram ${method} failed: ${reply.description ?? 'no description'}`);
    return reply.result;
  };
  const callForId = async (method: string, body: string | FormData): Promise<number> => messageId(method, await call(method, body));

  return {
    async sendMessage(chat, text, replyTo) {
      const ids: number[] = [];
      for (const part of splitText(text)) {
        const payload: Record<string, unknown> = { chat_id: chat, text: part };
        if (replyTo !== undefined && ids.length === 0) payload.reply_parameters = { message_id: replyTo };
        ids.push(await callForId('sendMessage', JSON.stringify(payload)));
      }
      return ids[0]!;
    },
    // A message with buttons cannot be split, since only one part could carry them.
    async sendButtons(chat, text, buttons) {
      if (text.length > MESSAGE_LIMIT) throw new Error(`Telegram message with buttons is ${text.length} chars, the limit is ${MESSAGE_LIMIT}.`);
      return callForId(
        'sendMessage',
        JSON.stringify({
          chat_id: chat,
          text,
          reply_markup: JSON.parse(keyboard(buttons)),
        }),
      );
    },
    async sendPhoto(chat, pngPath, caption, buttons) {
      if (caption.length > CAPTION_LIMIT) throw new Error(`Telegram caption is ${caption.length} chars, the limit is ${CAPTION_LIMIT}.`);
      const markup = buttons ? keyboard(buttons) : null;
      const form = new FormData();
      form.set('chat_id', chat);
      form.set('caption', caption);
      if (markup) form.set('reply_markup', markup);
      form.set('photo', new Blob([readFileSync(pngPath)], { type: 'image/png' }), basename(pngPath));
      return callForId('sendPhoto', form);
    },
    // One photo goes as sendPhoto, 2 to 10 as one media group. Albums cannot carry buttons. Every file is checked before anything is sent.
    async sendPhotos(chat, photos, replyTo) {
      const { method, form } = albumRequest(chat, photos, replyTo);
      const result = await call(method, form);
      return method === 'sendPhoto' ? [messageId(method, result)] : groupIds(result, photos.length);
    },
    // A file goes to the chat only as an upload, never as a link. The reply points at the message it answers.
    async sendDocument(chat, path, replyTo) {
      const stat = lstatSync(path, { throwIfNoEntry: false });
      if (!stat || !stat.isFile()) throw new Error(`Telegram document ${basename(path)} is missing or is not a regular file.`);
      if (stat.size === 0 || stat.size > DOCUMENT_MAX_BYTES) throw new Error(`Telegram document ${basename(path)} is ${stat.size} bytes, the limit is ${DOCUMENT_MAX_BYTES}.`);
      const form = new FormData();
      form.set('chat_id', chat);
      if (replyTo !== undefined) form.set('reply_parameters', JSON.stringify({ message_id: replyTo }));
      form.set('document', new Blob([readFileSync(path)]), basename(path));
      return callForId('sendDocument', form);
    },
    async editCaption(chat, messageId, caption) {
      if (caption.length > CAPTION_LIMIT) throw new Error(`Telegram caption is ${caption.length} chars, the limit is ${CAPTION_LIMIT}.`);
      // An empty keyboard drops the buttons, so a decided post cannot be pressed again.
      await call(
        'editMessageCaption',
        JSON.stringify({
          chat_id: chat,
          message_id: messageId,
          caption,
          reply_markup: { inline_keyboard: [] },
        }),
      );
    },
  };
}

function checkAlbum(photos: AlbumPhoto[]): void {
  if (photos.length === 0 || photos.length > ALBUM_MAX) throw new Error(`Telegram takes 1 to ${ALBUM_MAX} photos in one send, got ${photos.length}.`);
  for (const { caption } of photos) {
    if (caption.length > CAPTION_LIMIT) throw new Error(`Telegram caption is ${caption.length} chars, the limit is ${CAPTION_LIMIT}.`);
  }
}

function albumRequest(chat: string, photos: AlbumPhoto[], replyTo: number | undefined): { method: string; form: FormData } {
  checkAlbum(photos);
  const files = photos.map((photo) => readPhoto(photo.path));
  const form = new FormData();
  form.set('chat_id', chat);
  if (replyTo !== undefined) form.set('reply_parameters', JSON.stringify({ message_id: replyTo }));
  if (photos.length === 1) {
    form.set('caption', photos[0]!.caption);
    form.set('photo', new Blob([files[0]!.bytes], { type: files[0]!.mime }), files[0]!.name);
    return { method: 'sendPhoto', form };
  }
  form.set(
    'media',
    JSON.stringify(
      photos.map((photo, i) => ({
        type: 'photo',
        media: `attach://photo${i}`,
        caption: photo.caption,
      })),
    ),
  );
  files.forEach((file, i) => form.set(`photo${i}`, new Blob([file.bytes], { type: file.mime }), file.name));
  return { method: 'sendMediaGroup', form };
}

function messageId(method: string, result: unknown): number {
  const id = (result as { message_id?: unknown } | null)?.message_id;
  if (typeof id !== 'number') throw new Error(`Telegram ${method} returned no message id.`);
  return id;
}

function groupIds(result: unknown, count: number): number[] {
  if (!Array.isArray(result) || result.length !== count) throw new Error(`Telegram sendMediaGroup returned ${Array.isArray(result) ? result.length : 'no'} messages for ${count} photos.`);
  return result.map((message) => messageId('sendMediaGroup', message));
}

function keyboard(buttons: InlineButton[][]): string {
  for (const { data } of buttons.flat()) {
    const size = Buffer.byteLength(data);
    if (size > CALLBACK_DATA_LIMIT) throw new Error(`Telegram callback data is ${size} bytes, the limit is ${CALLBACK_DATA_LIMIT}.`);
  }
  return JSON.stringify({
    inline_keyboard: buttons.map((row) => row.map(({ text, data }) => ({ text, callback_data: data }))),
  });
}

// Cuts at the last line break inside the limit, or at the limit when a line is longer.
function splitText(text: string): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > MESSAGE_LIMIT) {
    const cut = rest.lastIndexOf('\n', MESSAGE_LIMIT);
    const end = cut > 0 ? cut : MESSAGE_LIMIT;
    parts.push(rest.slice(0, end));
    rest = rest.slice(cut > 0 ? end + 1 : end);
  }
  parts.push(rest);
  return parts;
}
