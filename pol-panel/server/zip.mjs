/**
 * zip.mjs — a minimal, dependency-free ZIP writer (deflate + CRC32).
 *
 * Used by the Admin page's "backup data/" action. Pulling in `archiver` would
 * add ~40 transitive packages and native-adjacent code paths that are painful
 * to install on Termux, so we build the container ourselves instead.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() / 2)) & 0xffff;
  const day =
    (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, day };
}

function walk(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).split(path.sep).join("/");
    if (entry.isDirectory()) {
      walk(full, base, out);
    } else if (entry.isFile()) {
      out.push({ full, rel });
    }
  }
  return out;
}

/**
 * Create a ZIP archive from a directory.
 * @param {string} sourceDir
 * @param {string} outFile
 * @param {{maxBytesPerFile?:number, skip?:string[]}} [opts]
 */
export function zipDirectory(sourceDir, outFile, opts = {}) {
  const maxBytesPerFile = opts.maxBytesPerFile ?? 25 * 1024 * 1024;
  const skip = opts.skip ?? ["backups"];
  const files = walk(sourceDir, sourceDir, []).filter(
    (f) => !skip.some((s) => f.rel === s || f.rel.startsWith(`${s}/`)),
  );

  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const raw = fs.readFileSync(file.full);
    const payload = raw.length > maxBytesPerFile ? raw.subarray(0, maxBytesPerFile) : raw;
    const deflated = zlib.deflateRawSync(payload, { level: 6 });
    const useDeflate = deflated.length < payload.length;
    const body = useDeflate ? deflated : payload;
    const crc = crc32(payload);
    const nameBuf = Buffer.from(file.rel, "utf8");
    const { time, day } = dosDateTime(fs.statSync(file.full).mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(payload.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, body);

    const centralEntry = Buffer.alloc(46);
    centralEntry.writeUInt32LE(0x02014b50, 0);
    centralEntry.writeUInt16LE(20, 4);
    centralEntry.writeUInt16LE(20, 6);
    centralEntry.writeUInt16LE(0x0800, 8);
    centralEntry.writeUInt16LE(useDeflate ? 8 : 0, 10);
    centralEntry.writeUInt16LE(time, 12);
    centralEntry.writeUInt16LE(day, 14);
    centralEntry.writeUInt32LE(crc, 16);
    centralEntry.writeUInt32LE(body.length, 20);
    centralEntry.writeUInt32LE(payload.length, 24);
    centralEntry.writeUInt16LE(nameBuf.length, 28);
    centralEntry.writeUInt32LE(0, 38); // external attrs
    centralEntry.writeUInt32LE(offset, 42);
    central.push(centralEntry, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  fs.writeFileSync(outFile, Buffer.concat([...chunks, centralBuf, end]), { mode: 0o600 });
  return { file: outFile, entries: files.length, bytes: fs.statSync(outFile).size };
}
