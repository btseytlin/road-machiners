// A PNG header with the given sides plus a seed byte, enough for the photo checks. Different seeds give different bytes.
export function pngBytes(seed: number, width = 640, height = 480): Buffer {
  const head = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12, 'latin1');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  head[28] = seed;
  return head;
}
