import { defineConfig } from 'vite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// piexifjs is a UMD CommonJS module — load via createRequire so the ESM Vite
// config can still pull it in. We only use `dump()` to build the raw EXIF
// binary blob; insertion into the PNG `eXIf` chunk is done by hand below
// (piexifjs's `insert()` is JPEG-only). See THIRD-PARTY-LICENSES.md.
const piexif = require('piexifjs') as {
  dump: (exif: Record<string, unknown>) => string
  ImageIFD: Record<string, number>
  ExifIFD: Record<string, number>
}

const TELEMETRY_LOG_PATH =
  process.env.PAGETURN_TELEMETRY_LOG ?? '/tmp/pageturn-telemetry.jsonl'

const SCREENSHOT_DIR = path.resolve(__dirname, 'contrib/screenshots')

// ---------------------------------------------------------------------------
// Schema validation for POST /__screenshot. Kept inline (no zod dep) — the
// browser-side agent owns the matching TypeScript interface; this validates
// the parsed JSON shape before we touch disk.
// ---------------------------------------------------------------------------
type Vec2 = { x: number; y: number }
type Vec3 = { x: number; y: number; z: number }

interface ScreenshotPayload {
  imageDataUrl: string
  clientTimestamp: string
  url: string
  sessionId: string | null
  triggerLocation: Vec2
  state: {
    drag: { isDragging: boolean; dragPoint: Vec2 | null; dragProgress: number; dragVelocity: number }
    crease: { alpha: number; originY: number; dihedral: number; creaseDir: Vec2; cornerDir: Vec2 }
    turn: { j: number; phi: number; progress: number; isTurning: boolean; isReverse: boolean; settling: boolean; settleTarget: number }
    camera: { position: Vec3; target: Vec3 }
    fps: number
  }
}

function isVec2(v: unknown): v is Vec2 {
  return !!v && typeof v === 'object' && typeof (v as Vec2).x === 'number' && typeof (v as Vec2).y === 'number'
}
function isVec3(v: unknown): v is Vec3 {
  return !!v && typeof v === 'object'
    && typeof (v as Vec3).x === 'number'
    && typeof (v as Vec3).y === 'number'
    && typeof (v as Vec3).z === 'number'
}

function validatePayload(p: unknown): { ok: true; value: ScreenshotPayload } | { ok: false; error: string } {
  if (!p || typeof p !== 'object') return { ok: false, error: 'payload is not an object' }
  const o = p as Record<string, unknown>
  if (typeof o.imageDataUrl !== 'string' || !o.imageDataUrl.startsWith('data:image/png;base64,'))
    return { ok: false, error: 'imageDataUrl must be a "data:image/png;base64,..." string' }
  if (typeof o.clientTimestamp !== 'string') return { ok: false, error: 'clientTimestamp must be string' }
  if (typeof o.url !== 'string') return { ok: false, error: 'url must be string' }
  if (!(o.sessionId === null || typeof o.sessionId === 'string'))
    return { ok: false, error: 'sessionId must be string or null' }
  if (!isVec2(o.triggerLocation)) return { ok: false, error: 'triggerLocation must be {x,y}' }
  const s = o.state as Record<string, unknown> | undefined
  if (!s || typeof s !== 'object') return { ok: false, error: 'state must be object' }

  const drag = s.drag as Record<string, unknown> | undefined
  if (!drag
    || typeof drag.isDragging !== 'boolean'
    || !(drag.dragPoint === null || isVec2(drag.dragPoint))
    || typeof drag.dragProgress !== 'number'
    || typeof drag.dragVelocity !== 'number')
    return { ok: false, error: 'state.drag invalid' }

  const crease = s.crease as Record<string, unknown> | undefined
  if (!crease
    || typeof crease.alpha !== 'number'
    || typeof crease.originY !== 'number'
    || typeof crease.dihedral !== 'number'
    || !isVec2(crease.creaseDir)
    || !isVec2(crease.cornerDir))
    return { ok: false, error: 'state.crease invalid' }

  const turn = s.turn as Record<string, unknown> | undefined
  if (!turn
    || typeof turn.j !== 'number'
    || typeof turn.phi !== 'number'
    || typeof turn.progress !== 'number'
    || typeof turn.isTurning !== 'boolean'
    || typeof turn.isReverse !== 'boolean'
    || typeof turn.settling !== 'boolean'
    || typeof turn.settleTarget !== 'number')
    return { ok: false, error: 'state.turn invalid' }

  const cam = s.camera as Record<string, unknown> | undefined
  if (!cam || !isVec3(cam.position) || !isVec3(cam.target))
    return { ok: false, error: 'state.camera invalid' }

  if (typeof s.fps !== 'number') return { ok: false, error: 'state.fps invalid' }

  return { ok: true, value: o as unknown as ScreenshotPayload }
}

function safeGit(cmd: string): string {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

// "2026-05-12T20:15:32.123Z" -> "2026-05-12T20-15-32-123Z"
function isoSlug(iso: string): string {
  return iso.replace(/[:.]/g, '-')
}

// host + pathname + sorted query params, non-alphanumeric collapsed to '-'
function urlSlug(rawUrl: string): string {
  let host = ''
  let pathname = ''
  let query = ''
  try {
    const u = new URL(rawUrl)
    host = u.host
    pathname = u.pathname
    const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b))
    query = params.length ? '?' + params.map(([k, v]) => `${k}=${v}`).join('&') : ''
  } catch {
    host = rawUrl
  }
  let slug = (host + pathname + query)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length > 80) slug = slug.slice(0, 80).replace(/-+$/g, '')
  return slug || 'url'
}

// EXIF DateTime field is "YYYY:MM:DD HH:MM:SS" per spec
function exifDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}:${pad(d.getUTCMonth() + 1)}:${pad(d.getUTCDate())} `
    + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

// ---------------------------------------------------------------------------
// PNG eXIf chunk injection
//
// PNG layout: 8-byte signature, then a sequence of chunks. Each chunk is
//   length(4 BE) || type(4 ASCII) || data(length bytes) || crc(4 BE)
// where CRC-32 covers (type || data).
//
// Per W3C PNG 3rd Edition (https://www.w3.org/TR/png-3/#11eXIf), the `eXIf`
// chunk carries a TIFF/EXIF byte stream identical to the EXIF segment of a
// JPEG (sans the JPEG-only "Exif\0\0" marker prefix). Position: anywhere
// between IHDR and IEND. We slot it immediately after IHDR for easy
// inspection by tools that walk chunks linearly.
// ---------------------------------------------------------------------------

// Lazily-built CRC-32 table (PNG / IEEE 802.3 polynomial 0xEDB88320).
let crcTable: Uint32Array | null = null
function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  crcTable = t
  return t
}

function crc32(buf: Buffer): number {
  const t = getCrcTable()
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function makeChunk(type: string, data: Buffer): Buffer {
  if (type.length !== 4) throw new Error(`chunk type must be 4 ASCII bytes, got "${type}"`)
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crc])
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Inject (or replace) an `eXIf` chunk in `pngBuf`, slotting it immediately
 * after IHDR. Strips any pre-existing `eXIf` chunk first so callers can
 * re-encode safely. Throws on malformed PNG input.
 */
function injectExifChunk(pngBuf: Buffer, exifData: Buffer): Buffer {
  if (pngBuf.length < 8 || !pngBuf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG (signature mismatch)')
  }
  const out: Buffer[] = [PNG_SIGNATURE]
  const exifChunk = makeChunk('eXIf', exifData)
  let inserted = false
  let offset = 8
  while (offset < pngBuf.length) {
    if (offset + 8 > pngBuf.length) throw new Error('truncated PNG chunk header')
    const len = pngBuf.readUInt32BE(offset)
    const type = pngBuf.subarray(offset + 4, offset + 8).toString('ascii')
    const end = offset + 8 + len + 4 // length + type + data + crc
    if (end > pngBuf.length) throw new Error(`truncated PNG chunk "${type}"`)
    const chunkBuf = pngBuf.subarray(offset, end)
    // Drop any pre-existing eXIf so we don't duplicate.
    if (type !== 'eXIf') out.push(chunkBuf)
    if (type === 'IHDR' && !inserted) {
      out.push(exifChunk)
      inserted = true
    }
    offset = end
    if (type === 'IEND') break
  }
  if (!inserted) throw new Error('PNG missing IHDR; cannot inject eXIf')
  return Buffer.concat(out)
}

/**
 * piexif.dump() returns the EXIF segment as a "binary string" — each char
 * code is a single byte. Convert to a Buffer.
 *
 * For JPEG, piexif.dump() emits a payload that begins with the App1 marker
 * "Exif\0\0" prefix (so it can be slotted into a JPEG APP1 segment). The
 * PNG eXIf chunk wants the raw TIFF stream WITHOUT that prefix per W3C
 * PNG 3rd Edition. Strip it if present.
 */
function piexifDumpToTiffBuffer(exifObj: Record<string, unknown>): Buffer {
  const binStr = piexif.dump(exifObj)
  const buf = Buffer.from(binStr, 'binary')
  // Some piexifjs versions emit the bare TIFF stream directly; others
  // prefix the JPEG App1 marker. Detect and strip the prefix only if
  // present so we always hand the eXIf chunk a TIFF header.
  const PREFIX = Buffer.from('Exif\x00\x00', 'binary')
  if (buf.length >= PREFIX.length && buf.subarray(0, PREFIX.length).equals(PREFIX)) {
    return buf.subarray(PREFIX.length)
  }
  return buf
}

export default defineConfig({
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'esnext',
  },
  plugins: [
    {
      // Large self-hosted media (e.g. big-buck-bunny.mp4) shouldn't be
      // re-downloaded on every dev reload. Without an explicit Cache-Control
      // header, Vite falls back to heuristic caching, which Chromium often
      // ignores for video resources.
      name: 'long-cache-videos',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url && /^\/videos\//.test(req.url)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          }
          next()
        })
      },
    },
    {
      // Telemetry sink — receives POST /__telemetry from src/telemetry.ts and
      // appends each event as a single JSON line to PAGETURN_TELEMETRY_LOG
      // (default /tmp/pageturn-telemetry.jsonl).  Truncates the log on server
      // startup so each `npm run dev` begins with an empty file.  Designed to
      // let an agent monitor the prototype's runtime via `tail -f`.
      name: 'telemetry-sink',
      configureServer(server) {
        // Truncate at startup so each dev session is self-contained.
        try {
          fs.writeFileSync(TELEMETRY_LOG_PATH, '')
          server.config.logger.info(
            `[telemetry-sink] writing to ${TELEMETRY_LOG_PATH} (truncated)`,
          )
        } catch (err) {
          server.config.logger.warn(
            `[telemetry-sink] could not truncate ${TELEMETRY_LOG_PATH}: ${(err as Error).message}`,
          )
        }

        server.middlewares.use('/__telemetry', (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end()
            return
          }
          const chunks: Buffer[] = []
          req.on('data', (chunk: Buffer) => chunks.push(chunk))
          req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8')
            let parsed: Record<string, unknown> = {}
            try {
              parsed = JSON.parse(raw)
            } catch {
              // Keep raw payload so corrupt events are still observable.
              parsed = { _parseError: true, raw }
            }
            const line =
              JSON.stringify({ ts: new Date().toISOString(), ...parsed }) + '\n'
            // Async fire-and-forget — do not block the response on disk I/O.
            fs.appendFile(TELEMETRY_LOG_PATH, line, () => { /* swallow */ })
            res.statusCode = 204
            res.end()
          })
          req.on('error', () => {
            res.statusCode = 400
            res.end()
          })
        })
      },
    },
    {
      // screenshot-server — receives POST /__screenshot from a browser-side
      // long-press capture (sibling to telemetry-sink). Writes a PNG plus a
      // sidecar JSON to contrib/screenshots/. PNG was chosen over JPEG for
      // lossless debug clarity. Metadata (incl. git short SHA in EXIF Model
      // and the full StateSnapshot in EXIF UserComment) is embedded in the
      // PNG via the W3C PNG 3rd Edition `eXIf` chunk; the sidecar JSON is
      // the canonical machine-readable mirror of the same data.
      name: 'screenshot-server',
      configureServer(server) {
        const gitShort = safeGit('git rev-parse --short HEAD') || 'unknown'
        const gitFull = safeGit('git rev-parse HEAD') || 'unknown'
        const gitBranch = safeGit('git rev-parse --abbrev-ref HEAD') || 'unknown'

        try {
          fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
        } catch (err) {
          server.config.logger.warn(
            `[screenshot-server] could not create ${SCREENSHOT_DIR}: ${(err as Error).message}`,
          )
        }
        server.config.logger.info(
          `[screenshot-server] git commit: ${gitShort}, writing to contrib/screenshots/`,
        )

        server.middlewares.use('/__screenshot', (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'POST only' }))
            return
          }

          const chunks: Buffer[] = []
          req.on('data', (chunk: Buffer) => chunks.push(chunk))
          req.on('error', () => {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'request stream error' }))
          })
          req.on('end', async () => {
            const raw = Buffer.concat(chunks).toString('utf8')
            let parsed: unknown
            try {
              parsed = JSON.parse(raw)
            } catch (err) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: `invalid JSON: ${(err as Error).message}` }))
              return
            }
            const v = validatePayload(parsed)
            if (!v.ok) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: `schema mismatch: ${v.error}` }))
              return
            }
            const payload = v.value

            // Decode PNG
            const base64 = payload.imageDataUrl.slice('data:image/png;base64,'.length)
            let pngBuf: Buffer
            try {
              pngBuf = Buffer.from(base64, 'base64')
              // PNG signature: 89 50 4E 47 0D 0A 1A 0A
              if (pngBuf.length < 8
                || pngBuf[0] !== 0x89 || pngBuf[1] !== 0x50
                || pngBuf[2] !== 0x4e || pngBuf[3] !== 0x47) {
                throw new Error('not a PNG (missing signature)')
              }
            } catch (err) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: `imageDataUrl decode failed: ${(err as Error).message}` }))
              return
            }

            // Build filename
            const serverDate = new Date()
            const sessionPart = (payload.sessionId && payload.sessionId.trim()) || 'anon'
            const safeSession = sessionPart.replace(/[^A-Za-z0-9_-]+/g, '-')
            const tsSlug = isoSlug(serverDate.toISOString())
            const slug = urlSlug(payload.url)
            const filename = `${safeSession}-${tsSlug}-${slug}.png`
            const outPath = path.join(SCREENSHOT_DIR, filename)
            const sidecarPath = `${outPath}.json`
            const relPath = `contrib/screenshots/${filename}`
            const relSidecar = `${relPath}.json`

            // Build EXIF tags. piexif provides only the dump() helper here;
            // we use it to produce the raw TIFF/EXIF blob and inject our
            // own `eXIf` chunk into the PNG.
            const description =
              `j=${payload.state.turn.j},phi=${payload.state.turn.phi},`
              + `dihedral=${payload.state.crease.dihedral},`
              + `sessionId=${payload.sessionId ?? 'null'}`
            const userCommentJson = JSON.stringify(payload.state)
            // EXIF UserComment requires an 8-byte character-code prefix.
            const userComment = 'ASCII\x00\x00\x00' + userCommentJson
            const exifObj: Record<string, unknown> = {
              '0th': {
                [piexif.ImageIFD.Make]: 'pageturn-demo',
                [piexif.ImageIFD.Model]: gitShort,
                [piexif.ImageIFD.Software]: 'pageturn-screenshot-server',
                [piexif.ImageIFD.DateTime]: exifDateTime(serverDate),
                [piexif.ImageIFD.ImageDescription]: description,
              },
              Exif: {
                [piexif.ExifIFD.UserComment]: userComment,
                [piexif.ExifIFD.DateTimeOriginal]: exifDateTime(new Date(payload.clientTimestamp)),
              },
            }

            let outBuf: Buffer
            try {
              const exifData = piexifDumpToTiffBuffer(exifObj)
              outBuf = injectExifChunk(pngBuf, exifData)
            } catch (err) {
              server.config.logger.warn(
                `[screenshot-server] eXIf inject failed (${(err as Error).message}); writing raw PNG`,
              )
              outBuf = pngBuf
            }

            const sidecar = {
              ...payload,
              // Drop the giant base64 from the sidecar; it's already on disk
              // as <filename>.png. Keep a pointer back to the image instead.
              imageDataUrl: undefined,
              imageFile: relPath,
              server: {
                receivedAt: serverDate.toISOString(),
                git_commit: gitFull,
                git_commit_short: gitShort,
                git_branch: gitBranch,
                git_dirty: safeGit('git status --porcelain').length > 0,
              },
            }

            try {
              await fs.promises.writeFile(outPath, outBuf)
              await fs.promises.writeFile(sidecarPath, JSON.stringify(sidecar, null, 2))
            } catch (err) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: `disk write failed: ${(err as Error).message}` }))
              return
            }

            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              filename,
              path: relPath,
              sidecarPath: relSidecar,
            }))
          })
        })
      },
    },
  ],
})
