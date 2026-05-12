import { defineConfig } from 'vite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// piexifjs is a UMD CommonJS module — load via createRequire so the ESM Vite
// config can still pull it in. See THIRD-PARTY-LICENSES.md for license.
const piexif = require('piexifjs') as {
  dump: (exif: Record<string, unknown>) => string
  insert: (exifBytes: string, jpeg: string) => string
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
  if (typeof o.imageDataUrl !== 'string' || !o.imageDataUrl.startsWith('data:image/jpeg;base64,'))
    return { ok: false, error: 'imageDataUrl must be a "data:image/jpeg;base64,..." string' }
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
      // long-press capture (sibling to telemetry-sink). Embeds EXIF metadata
      // in the JPEG (incl. git short SHA in the Model tag so an agent can
      // rewind to the captured revision) and writes both the JPEG and a
      // sidecar JSON to contrib/screenshots/.
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

            // Decode JPEG
            const base64 = payload.imageDataUrl.slice('data:image/jpeg;base64,'.length)
            let jpegBuf: Buffer
            try {
              jpegBuf = Buffer.from(base64, 'base64')
              if (jpegBuf.length < 4 || jpegBuf[0] !== 0xff || jpegBuf[1] !== 0xd8) {
                throw new Error('not a JPEG (missing SOI marker)')
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
            const filename = `${safeSession}-${tsSlug}-${slug}.jpg`
            const outPath = path.join(SCREENSHOT_DIR, filename)
            const sidecarPath = `${outPath}.json`
            const relPath = `contrib/screenshots/${filename}`
            const relSidecar = `${relPath}.json`

            // Build EXIF
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
              const exifBytes = piexif.dump(exifObj)
              const jpegBinary = jpegBuf.toString('binary')
              const newBinary = piexif.insert(exifBytes, jpegBinary)
              outBuf = Buffer.from(newBinary, 'binary')
            } catch (err) {
              server.config.logger.warn(
                `[screenshot-server] EXIF embed failed (${(err as Error).message}); writing raw JPEG`,
              )
              outBuf = jpegBuf
            }

            const sidecar = {
              ...payload,
              // Drop the giant base64 from the sidecar; it's already on disk
              // as <filename>.jpg. Keep a pointer back to the image instead.
              imageDataUrl: undefined,
              imageFile: relPath,
              server: {
                receivedAt: serverDate.toISOString(),
                git_commit: gitShort,
                git_commit_full: gitFull,
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
