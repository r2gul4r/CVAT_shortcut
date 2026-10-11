/* Generates generic code-drawn icons and an allowlisted root-manifest Store ZIP. */
import {readFile, writeFile, mkdir, readdir} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {deflateSync, deflateRawSync} from "node:zlib";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extension = path.join(root, "extension");
const store = path.join(root, "store");
await mkdir(path.join(extension, "icons"), {recursive: true});
await mkdir(store, {recursive: true});
const crcTable = Array.from({length: 256}, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
function rounded(x, y, left, top, right, bottom, radius) {
  const centerX = Math.max(left + radius, Math.min(right - radius, x));
  const centerY = Math.max(top + radius, Math.min(bottom - radius, y));
  return x >= left && x <= right && y >= top && y <= bottom &&
    (x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2;
}
function line(x, y, x1, y1, x2, y2, width) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return (x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2 <= width ** 2 / 4;
}
function pixel(x, y) {
  let color = [0, 0, 0, 0];
  if (rounded(x, y, 5, 5, 123, 123, 25)) color = [28, 64, 113, 255];
  if (rounded(x, y, 24, 25, 95, 78, 10)) color = [244, 248, 253, 255];
  if (rounded(x, y, 30, 31, 89, 72, 6)) color = [28, 64, 113, 255];
  for (const left of [40, 59, 78]) if (rounded(x, y, left - 5, 42, left + 5, 51, 2)) color = [244, 248, 253, 255];
  if (rounded(x, y, 40, 58, 78, 64, 2)) color = [244, 248, 253, 255];
  if (line(x, y, 57, 100, 102, 55, 14)) color = [244, 161, 59, 255];
  if (line(x, y, 53, 104, 64, 93, 17)) color = [244, 248, 253, 255];
  return color;
}
for (const size of [16, 32, 48, 128]) {
  const rows = Buffer.alloc((1 + size * 4) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sums = [0, 0, 0, 0];
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const color = pixel((x + (sx + 0.5) / 4) * 128 / size, (y + (sy + 0.5) / 4) * 128 / size);
      color.forEach((value, channel) => {sums[channel] += value;});
    }
    const offset = y * (1 + size * 4) + 1 + x * 4;
    sums.forEach((value, channel) => {rows[offset + channel] = Math.round(value / 16);});
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6;
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
  await writeFile(path.join(extension, "icons", `icon${size}.png`), png);
}
const names = ["manifest.json", "common.js", "content.js", "popup.html", "popup.css", "popup.js", ...[16,32,48,128].map((size) => `icons/icon${size}.png`)];
const actual = (await readdir(extension, {withFileTypes: true})).map((entry) => entry.name).sort();
assert.deepEqual(actual, ["common.js", "content.js", "icons", "manifest.json", "popup.css", "popup.html", "popup.js"].sort());
assert.deepEqual((await readdir(path.join(extension, "icons"))).sort(), [16,32,48,128].map((size) => `icon${size}.png`).sort());
const manifest = JSON.parse(await readFile(path.join(extension, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual([...manifest.permissions].sort(), ["activeTab", "scripting", "storage"]);
for (const key of ["host_permissions", "optional_host_permissions", "content_scripts", "background", "externally_connectable", "web_accessible_resources", "key", "update_url"]) assert.equal(manifest[key], undefined, key);
const local = [], central = [], hashes = [];
let offset = 0;
for (const name of names) {
  const data = await readFile(path.join(extension, name));
  if (!name.endsWith(".png")) {
    const text = data.toString("utf8");
    assert(!/https?:\/\//i.test(text), `${name}: hardcoded URL`);
    assert(!/(-----BEGIN .+PRIVATE KEY-----|\bAKIA[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}|\bsk-[A-Za-z0-9_-]{20,})/.test(text), `${name}: secret pattern`);
    assert(!/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|captureVisibleTab|getImageData|toDataURL)\s*\(/.test(text), `${name}: network/image API`);
  }
  const nameBytes = Buffer.from(name), compressed = deflateRawSync(data), crc = crc32(data);
  const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8); header.writeUInt16LE(0x5d42, 12);
  header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(nameBytes.length, 26);
  local.push(header, nameBytes, compressed);
  const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
  record.writeUInt16LE(0x800, 8); record.writeUInt16LE(8, 10); record.writeUInt16LE(0x5d42, 14);
  record.writeUInt32LE(crc, 16); record.writeUInt32LE(compressed.length, 20); record.writeUInt32LE(data.length, 24);
  record.writeUInt16LE(nameBytes.length, 28); record.writeUInt32LE(offset, 42);
  central.push(record, nameBytes); offset += header.length + nameBytes.length + compressed.length;
  hashes.push({name, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex")});
}
const directory = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10);
end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...local, directory, end]);
const file = `cvat-sidebar-shortcuts-${manifest.version}-store.zip`;
await writeFile(path.join(root, file), zip);
const audit = {version: manifest.version, file, bytes: zip.length, sha256: createHash("sha256").update(zip).digest("hex"),
  manifestAtRoot: true, permissions: manifest.permissions, hostPermissions: [], automaticInjection: false,
  networkOrImageReadingAPIs: false, hardcodedURLLiterals: [], secretPatternMatches: [],
  companyImagesOrCapturedData: "None; all bundled files are authored extension code or generated generic icons",
  testFilesIncluded: false, documentationIncluded: false, files: hashes};
await writeFile(path.join(store, "package-audit.json"), JSON.stringify(audit, null, 2) + "\n");
console.log(`Built ${file}: ${names.length} allowlisted files, root manifest, no additional permissions.`);
