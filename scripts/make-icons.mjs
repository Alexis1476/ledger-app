// Generates the PWA icons (public/*.png, favicon.svg) without image dependencies.
// Run: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const BG = [30, 64, 175] // blue-800 (brand)
const FG = [255, 255, 255]

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/** Book-with-check glyph drawn with simple shapes on a full-bleed square (maskable safe zone). */
function pixel(x, y, s) {
  const u = x / s
  const v = y / s
  // two "pages"
  const inPage = (cx) => Math.abs(u - cx) < 0.17 && v > 0.3 && v < 0.7
  const left = inPage(0.33)
  const right = inPage(0.67)
  const spine = Math.abs(u - 0.5) < 0.012 && v > 0.3 && v < 0.7
  // check mark on the right page: two segments
  const seg = (ax, ay, bx, by) => {
    const dx = bx - ax
    const dy = by - ay
    const t = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy)))
    return Math.hypot(u - (ax + t * dx), v - (ay + t * dy)) < 0.028
  }
  const check = seg(0.57, 0.5, 0.635, 0.565) || seg(0.635, 0.565, 0.77, 0.42)
  if ((left || right) && !spine) return check ? BG : FG
  return BG
}

function png(size) {
  const rows = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4)
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x + 0.5, y + 0.5, size)
      row.set([r, g, b, 255], 1 + x * 4)
    }
    rows.push(row)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0))
  ])
}

writeFileSync('public/pwa-192.png', png(192))
writeFileSync('public/pwa-512.png', png(512))
writeFileSync('public/apple-touch-icon.png', png(180))
writeFileSync(
  'public/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1e40af"/><rect x="10" y="19" width="21" height="26" rx="2" fill="#fff"/><rect x="33" y="19" width="21" height="26" rx="2" fill="#fff"/><path d="M37 32l4 4 8-8" stroke="#1e40af" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`
)
console.log('icons written to public/')
