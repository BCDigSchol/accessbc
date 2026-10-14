// Node access to the terrain tiles in src/basemap/terrain.pmtiles, with no dependencies: the PMTiles
// reader is the vendored browser build, and PNG decoding uses Node's zlib.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// The vendored pmtiles.js is a browser script that defines a global `pmtiles`; run it in a sandbox.
function loadPmtilesLibrary() {
  const sandbox = { DecompressionStream, Response, TextDecoder, Uint8Array, ArrayBuffer, DataView, Promise, Error, Math, Number, Object, console };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src/vendor/pmtiles/pmtiles.js'), 'utf8') + '\nthis.pmtiles = pmtiles;', sandbox);
  return sandbox.pmtiles;
}

class FileSource {
  constructor(file) { this.fd = fs.openSync(file, 'r'); this.file = file; }
  getKey() { return this.file; }
  async getBytes(offset, length) {
    const buf = Buffer.alloc(length);
    fs.readSync(this.fd, buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + length) };
  }
}

// Decodes an 8-bit, non-interlaced RGB or RGBA PNG (what the Terrarium tiles are) to RGBA pixels.
export function decodePng(bytes) {
  const buf = Buffer.from(bytes);
  let pos = 8, width = 0, height = 0, channels = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      const [depth, colour, , , interlace] = data.subarray(8, 13);
      if (depth !== 8 || interlace !== 0 || ![2, 6].includes(colour)) throw new Error(`unsupported PNG (depth ${depth}, colour ${colour})`);
      channels = colour === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels, out = new Uint8ClampedArray(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0, b = prev[i], c = i >= channels ? prev[i - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      cur[i] = (line[i] + predictor) & 255;
    }
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 3; k++) out[(y * width + x) * 4 + k] = cur[x * channels + k];
      out[(y * width + x) * 4 + 3] = channels === 4 ? cur[x * channels + 3] : 255;
    }
    prev = cur;
  }
  return out;
}

// loadTile(z, x, y) -> RGBA pixels or null, in the shape createTerrain() in src/js/routing/elevation.mjs expects.
export function terrainTileLoader() {
  const { PMTiles } = loadPmtilesLibrary();
  const archive = new PMTiles(new FileSource(path.join(ROOT, 'src/basemap/terrain.pmtiles')));
  return async (z, x, y) => {
    const tile = await archive.getZxy(z, x, y);
    return tile ? decodePng(new Uint8Array(tile.data)) : null;
  };
}
