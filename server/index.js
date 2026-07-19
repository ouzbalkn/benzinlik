// Benzinlik sunucusu: statik oyun dosyaları + hesap/kayıt API'si.
// Tabloyu açılışta kendisi kurar (CREATE TABLE IF NOT EXISTS) — elle SQL gerekmez.
import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import pg from 'pg'

const PORT = Number(process.env.PORT || 80)
const SECRET = process.env.AUTH_SECRET || 'benzinlik-dev-secret'
const DIST = path.resolve(process.cwd(), 'dist')

const pool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
  : null

async function initDb() {
  if (!pool) {
    console.warn('DATABASE_URL yok — hesap API devre dışı, sadece statik servis.')
    return
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS benzinlik_player (
      id serial PRIMARY KEY,
      email text UNIQUE NOT NULL,
      pass text NOT NULL,
      save jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS benzinlik_feedback (
      id serial PRIMARY KEY,
      email text NOT NULL,
      message text NOT NULL,
      game jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await pool.query(`ALTER TABLE benzinlik_player ADD COLUMN IF NOT EXISTS last_seen_at timestamptz DEFAULT now()`)
  await pool.query(`ALTER TABLE benzinlik_player ADD COLUMN IF NOT EXISTS sessions int NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE benzinlik_player ADD COLUMN IF NOT EXISTS banned_at timestamptz`)
  await pool.query(`ALTER TABLE benzinlik_player ADD COLUMN IF NOT EXISTS ban_reason text`)
  await pool.query(`ALTER TABLE benzinlik_feedback ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open'`)
  await pool.query(`ALTER TABLE benzinlik_feedback ADD COLUMN IF NOT EXISTS resolved_note text`)
  await pool.query(`ALTER TABLE benzinlik_feedback ADD COLUMN IF NOT EXISTS resolved_at timestamptz`)
  await pool.query(`CREATE TABLE IF NOT EXISTS benzinlik_stat_hourly (
    hour timestamptz PRIMARY KEY, visits int NOT NULL DEFAULT 0,
    signups int NOT NULL DEFAULT 0, logins int NOT NULL DEFAULT 0
  )`)
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS benzinlik_player_email_lower ON benzinlik_player (lower(email))`)
  console.log('DB hazır (benzinlik_player + benzinlik_feedback).')
}

// ---- şifre & token ----
function hashPassword(pass) {
  const salt = crypto.randomBytes(16).toString('hex')
  const h = crypto.scryptSync(pass, salt, 32).toString('hex')
  return `${salt}:${h}`
}
function verifyPassword(pass, stored) {
  const [salt, h] = String(stored).split(':')
  if (!salt || !h) return false
  const calc = crypto.scryptSync(pass, salt, 32).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(calc, 'hex'))
}
function sign(email) {
  const exp = Date.now() + 90 * 24 * 3600 * 1000
  const body = `${email}|${exp}`
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('hex')
  return Buffer.from(`${body}|${mac}`).toString('base64url')
}
function verifyToken(token) {
  try {
    const [email, exp, mac] = Buffer.from(token, 'base64url').toString().split('|')
    if (!email || Number(exp) < Date.now()) return null
    const calc = crypto.createHmac('sha256', SECRET).update(`${email}|${exp}`).digest('hex')
    return crypto.timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(calc, 'hex')) ? email : null
  } catch {
    return null
  }
}

function json(res, code, data) {
  const body = JSON.stringify(data)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = ''
    req.on('data', c => { s += c; if (s.length > 1_000_000) reject(new Error('too big')) })
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}) } catch (e) { reject(e) } })
  })
}

// İstemciden gelen kaydı makul sınırlara kırp — bariz hileleri SQL'e sokma.
const clamp = (v, lo, hi, dflt = lo) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt)
function sanitizeSave(save) {
  if (save === null) return null
  if (typeof save !== 'object' || Array.isArray(save)) return undefined
  const s = save.s
  if (!s || typeof s !== 'object') return undefined
  s.money = clamp(s.money, 0, 2_000_000, 5000)
  s.reputation = clamp(s.reputation, 0, 5, 3)
  s.day = clamp(s.day, 1, 100000, 1)
  s.pumps = clamp(s.pumps, 1, 8, 1)
  for (const k of ['parkingCount', 'solarCount', 'selfWashCount', 'airWaterCount']) {
    if (k in s) s[k] = clamp(s[k], 0, 30, 0)
  }
  s.evChargers = clamp(s.evChargers, 0, 8, 0)
  s.signLevel = clamp(s.signLevel, 0, 3, 0)
  s.tankLevel = clamp(s.tankLevel, 0, 3, 0)
  s.marketLevel = clamp(s.marketLevel, 0, 2, 0)
  s.toiletLevel = clamp(s.toiletLevel, 0, 2, 0)
  s.gridLevel = clamp(s.gridLevel, 0, 2, 0)
  s.batteryLevel = clamp(s.batteryLevel, 0, 3, 0)
  s.battery = clamp(s.battery, 0, 600, 0)
  s.uranium = clamp(s.uranium, 0, 100, 0)
  s.loginStreak = clamp(s.loginStreak, 0, 3650, 0)
  s.dailyServed = clamp(s.dailyServed, 0, 10000, 0)
  if (s.tanks && typeof s.tanks === 'object') {
    for (const k of ['benzin', 'dizel', 'lpg']) s.tanks[k] = clamp(s.tanks[k], 0, 5000, 0)
  }
  if (s.pendingCash && typeof s.pendingCash === 'object') {
    for (const k of Object.keys(s.pendingCash)) s.pendingCash[k] = clamp(s.pendingCash[k], 0, 600, 0)
  }
  if (typeof s.stationName === 'string') s.stationName = s.stationName.slice(0, 14)
  if (s.prices && typeof s.prices === 'object') {
    for (const k of ['benzin', 'dizel', 'lpg']) s.prices[k] = clamp(s.prices[k], 1, 30, 10)
  }
  if ('elecPrice' in s) {
    s.elecPrice = clamp(s.elecPrice, 4, 18, 8)
  }
  if (Array.isArray(save.placedRects) && save.placedRects.length > 64) save.placedRects = save.placedRects.slice(0, 64)
  if (Array.isArray(s.ownedParcels) && s.ownedParcels.length > 18) s.ownedParcels = s.ownedParcels.slice(0, 18)
  if (Array.isArray(s.achievements) && s.achievements.length > 32) s.achievements = s.achievements.slice(0, 32)
  return save
}

// ---- hız limitleri (bellek içi; tek konteyner için yeterli) ----
const buckets = new Map() // key -> { n, resetAt }
let statsCache = { data: null, at: 0 }
async function bumpStat(kind) {
  if (!pool) return
  try {
    await pool.query(
      `INSERT INTO benzinlik_stat_hourly(hour, ${kind}) VALUES (date_trunc('hour', now()), 1)
       ON CONFLICT (hour) DO UPDATE SET ${kind} = benzinlik_stat_hourly.${kind} + 1`)
  } catch { /* stat kaydı kritik değil */ }
}
function rateLimit(key, max, windowMs) {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || now > b.resetAt) {
    buckets.set(key, { n: 1, resetAt: now + windowMs })
    return true
  }
  b.n++
  return b.n <= max
}
setInterval(() => {
  const now = Date.now()
  for (const [k, b] of buckets) if (now > b.resetAt) buckets.delete(k)
}, 60_000).unref()

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return xf || req.socket.remoteAddress || '?'
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}

async function handleApi(req, res, url) {
  if (!pool) return json(res, 503, { error: 'Sunucuda veritabanı yapılandırılmamış.' })
  const auth = () => {
    const t = req.headers['x-auth'] || ''
    const email = verifyToken(String(t))
    if (!email) { json(res, 401, { error: 'Oturum geçersiz, tekrar giriş yap.' }); return null }
    return email
  }
  try {
    if (url === '/api/healthz') return json(res, 200, { ok: true })
    if (url === '/api/stats' && req.method === 'GET') {
      const now = Date.now()
      if (!statsCache.data || now - statsCache.at > 30_000) {
        const r = await pool.query(`SELECT count(*)::int AS players,
          count(*) FILTER (WHERE last_seen_at > now() - interval '5 min')::int AS online
          FROM benzinlik_player`)
        statsCache = { data: r.rows[0], at: now }
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=20' })
      return res.end(JSON.stringify(statsCache.data))
    }
    if (url === '/api/visit' && req.method === 'POST') {
      if (rateLimit('visit:' + clientIp(req), 1, 30_000)) bumpStat('visits')
      return json(res, 200, { ok: true })
    }
    if (url === '/api/config') {
      return json(res, 200, { adsClient: process.env.ADSENSE_PUB || null })
    }
    if (url === '/api/register' && req.method === 'POST') {
      if (!rateLimit('reg:' + clientIp(req), 6, 3600_000)) return json(res, 429, { error: 'Çok sık kayıt denemesi — biraz sonra tekrar dene.' })
      const { email, password } = await readBody(req)
      const e = String(email || '').trim().toLowerCase()
      if (!/^\S+@\S+\.\S+$/.test(e)) return json(res, 400, { error: 'Geçerli bir e-posta gir.' })
      if (String(password || '').length < 4) return json(res, 400, { error: 'Şifre en az 4 karakter olmalı.' })
      // atomik: yarış durumunda bile aynı e-posta ikinci kez ASLA açılmaz
      const ins = await pool.query(
        `INSERT INTO benzinlik_player(email, pass) VALUES ($1, $2)
         ON CONFLICT (email) DO NOTHING RETURNING id`,
        [e, hashPassword(String(password))],
      ).catch(err => {
        if (String(err.code) === '23505') return { rowCount: 0 }
        throw err
      })
      if (!ins.rowCount) return json(res, 409, { error: 'Bu e-posta zaten kayıtlı — giriş yap.' })
      bumpStat('signups')
      return json(res, 200, { token: sign(e), email: e })
    }
    if (url === '/api/login' && req.method === 'POST') {
      if (!rateLimit('login:' + clientIp(req), 30, 3600_000)) return json(res, 429, { error: 'Çok fazla deneme — biraz sonra tekrar dene.' })
      const { email, password } = await readBody(req)
      const e = String(email || '').trim().toLowerCase()
      const r = await pool.query('SELECT pass, banned_at FROM benzinlik_player WHERE email=$1', [e])
      if (r.rowCount === 0 || !verifyPassword(String(password || ''), r.rows[0].pass)) {
        return json(res, 401, { error: 'E-posta veya şifre hatalı.' })
      }
      if (r.rows[0].banned_at) return json(res, 403, { error: 'Bu hesap askıya alınmış.' })
      await pool.query('UPDATE benzinlik_player SET sessions=sessions+1, last_seen_at=now() WHERE email=$1', [e])
      bumpStat('logins')
      return json(res, 200, { token: sign(e), email: e })
    }
    if (url === '/api/feedback' && req.method === 'POST') {
      const email = auth(); if (!email) return
      if (!rateLimit('fb:' + email, 5, 3600_000)) return json(res, 429, { error: 'Çok sık bildirim — biraz sonra tekrar dene.' })
      const { message, game } = await readBody(req)
      const msg = String(message || '').trim().slice(0, 1000)
      if (msg.length < 3) return json(res, 400, { error: 'Mesaj çok kısa.' })
      const meta = game && typeof game === 'object' && !Array.isArray(game) ? game : null
      await pool.query('INSERT INTO benzinlik_feedback(email, message, game) VALUES ($1, $2, $3)', [email, msg, meta])
      return json(res, 200, { ok: true })
    }
    if (url === '/api/save' && req.method === 'GET') {
      const email = auth(); if (!email) return
      const r = await pool.query('SELECT save, updated_at, banned_at FROM benzinlik_player WHERE email=$1', [email])
      if (r.rows[0]?.banned_at) return json(res, 403, { error: 'Bu hesap askıya alınmış.' })
      await pool.query('UPDATE benzinlik_player SET last_seen_at=now() WHERE email=$1', [email])
      return json(res, 200, { save: r.rows[0]?.save ?? null, updatedAt: r.rows[0]?.updated_at ?? null })
    }
    if (url === '/api/save' && req.method === 'POST') {
      const email = auth(); if (!email) return
      if (!rateLimit('save:' + email, 1, 3_000)) return json(res, 429, { error: 'rate' })
      const { save } = await readBody(req)
      const clean = sanitizeSave(save)
      if (clean === undefined) return json(res, 400, { error: 'Geçersiz kayıt verisi.' })
      // makullük: para, geçen süreye göre imkânsız hızda artamaz (hile freni)
      if (clean && clean.s) {
        const prev = await pool.query('SELECT save, updated_at, banned_at FROM benzinlik_player WHERE email=$1', [email])
        if (prev.rows[0]?.banned_at) return json(res, 403, { error: 'Bu hesap askıya alınmış.' })
        const prevSave = prev.rows[0]?.save
        if (prevSave && prevSave.s && typeof prevSave.s.money === 'number') {
          const elapsed = Math.max(1, (Date.now() - new Date(prev.rows[0].updated_at).getTime()) / 1000)
          const allowance = 50_000 + elapsed * 600
          if (clean.s.money > prevSave.s.money + allowance) {
            clean.s.money = Math.round(prevSave.s.money + allowance)
          }
        }
      }
      await pool.query('UPDATE benzinlik_player SET save=$2, updated_at=now(), last_seen_at=now() WHERE email=$1', [email, clean])
      return json(res, 200, { ok: true })
    }
    json(res, 404, { error: 'not found' })
  } catch (err) {
    console.error(err)
    json(res, 500, { error: 'Sunucu hatası.' })
  }
}

// ---- VentureStudio paneli (/vs/v1): admin.benerits.com bu uçları Bearer key ile çeker ----
const VS_KEY = process.env.VS_API_KEY || ''

function vsAuth(req, res) {
  const h = String(req.headers.authorization || '')
  if (!VS_KEY || h !== `Bearer ${VS_KEY}`) {
    json(res, 401, { error: { code: 'unauthorized', message: 'Bearer eksik ya da hatalı.' } })
    return false
  }
  return true
}

function userRow(r) {
  const st = r.save?.s ?? {}
  return {
    id: String(r.id),
    email: r.email,
    name: st.stationName || null,
    avatarUrl: null,
    country: null,
    plan: 'free',
    source: null,
    authProvider: 'password',
    github: null,
    signedUpAt: r.created_at,
    lastSeenAt: r.last_seen_at ?? null,
    sessions: r.sessions ?? 0,
    ltvCents: 0,
    currency: 'USD',
    bannedAt: r.banned_at ?? null,
    coins: typeof st.money === 'number' ? Math.round(st.money) : 0,
    metadata: {
      day: st.day ?? 1,
      pumps: st.pumps ?? 1,
      reputation: st.reputation ?? 3,
      served: st.stats?.served ?? 0,
    },
  }
}

async function handleVs(req, res, url) {
  if (!pool) return json(res, 503, { error: { code: 'no_db', message: 'DB yok.' } })
  if (!vsAuth(req, res)) return
  const u = new URL(req.url, 'http://x')
  try {
    if (url === '/vs/v1/users/metrics' && req.method === 'GET') {
      const days = { '7d': 7, '30d': 30, '90d': 90 }[u.searchParams.get('window') || '30d'] || 30
      const q = await pool.query(`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE last_seen_at > now() - $1::interval)::int AS active,
          count(*) FILTER (WHERE last_seen_at > now() - ($1::interval * 2) AND last_seen_at <= now() - $1::interval)::int AS active_prev,
          count(*) FILTER (WHERE created_at > now() - $1::interval)::int AS news,
          count(*) FILTER (WHERE created_at > now() - ($1::interval * 2) AND created_at <= now() - $1::interval)::int AS news_prev
        FROM benzinlik_player`, [`${days} days`])
      const r = q.rows[0]
      const delta = (v, p) => (p > 0 ? Math.round(((v - p) / p) * 1000) / 10 : (v > 0 ? 100 : 0))
      return json(res, 200, {
        window: `${days}d`,
        activeUsers: { value: r.active, previous: r.active_prev, deltaPct: delta(r.active, r.active_prev) },
        newSignups: { value: r.news, previous: r.news_prev, deltaPct: delta(r.news, r.news_prev) },
        paidUsers: { value: 0, previous: 0, deltaPct: 0 },
        totalUsers: r.total,
        asOf: new Date().toISOString(),
      })
    }
    if (url === '/vs/v1/users' && req.method === 'GET') {
      const limit = Math.min(200, Math.max(10, Number(u.searchParams.get('limit')) || 50))
      const cursor = Number(Buffer.from(u.searchParams.get('cursor') || '', 'base64url').toString() || 0) || 0
      const search = (u.searchParams.get('q') || '').toLowerCase()
      const sort = u.searchParams.get('sort') || 'signed_up_desc'
      const order = sort === 'last_seen_desc' ? 'last_seen_at DESC NULLS LAST' : 'created_at DESC'
      const rows = await pool.query(`
        SELECT id, email, save, created_at, last_seen_at, sessions, banned_at
        FROM benzinlik_player
        WHERE ($1 = '' OR lower(email) LIKE '%' || $1 || '%' OR lower(coalesce(save->'s'->>'stationName','')) LIKE '%' || $1 || '%')
        ORDER BY ${order} OFFSET $2 LIMIT $3`, [search, cursor, limit + 1])
      const page = rows.rows.slice(0, limit).map(userRow)
      const nextCursor = rows.rows.length > limit ? Buffer.from(String(cursor + limit)).toString('base64url') : null
      return json(res, 200, { data: page, nextCursor })
    }
    const m = url.match(/^\/vs\/v1\/users\/(\d+)(?:\/(ban|unban|balance))?$/)
    if (m) {
      const id = Number(m[1])
      const found = await pool.query('SELECT id, email, save, created_at, last_seen_at, sessions, banned_at FROM benzinlik_player WHERE id=$1', [id])
      if (found.rowCount === 0) return json(res, 404, { error: { code: 'not_found', message: 'Kullanıcı yok.' } })
      if (m[2] === 'ban' && req.method === 'POST') {
        const { reason } = await readBody(req)
        await pool.query('UPDATE benzinlik_player SET banned_at=now(), ban_reason=$2 WHERE id=$1', [id, String(reason || '').slice(0, 300) || null])
      } else if (m[2] === 'unban' && req.method === 'POST') {
        await pool.query('UPDATE benzinlik_player SET banned_at=NULL, ban_reason=NULL WHERE id=$1', [id])
      } else if (m[2] === 'balance' && req.method === 'POST') {
        const { op, amount } = await readBody(req)
        const amt = Math.max(0, Math.round(Number(amount) || 0))
        const cur = Math.round(Number(found.rows[0].save?.s?.money) || 0)
        const next = op === 'set' ? amt : op === 'add' ? cur + amt : cur - amt
        if (next < 0 || !['set', 'add', 'subtract'].includes(String(op))) {
          return json(res, 400, { error: { code: 'invalid_request', message: 'Geçersiz işlem.' } })
        }
        await pool.query(`UPDATE benzinlik_player SET save = jsonb_set(coalesce(save, '{}'::jsonb), '{s,money}', to_jsonb($2::int)) WHERE id=$1`, [id, next])
        return json(res, 200, { data: { coins: next } })
      } else if (req.method === 'DELETE' && !m[2]) {
        await pool.query('DELETE FROM benzinlik_player WHERE id=$1', [id])
        res.writeHead(204)
        return res.end()
      } else if (req.method !== 'GET') {
        return json(res, 404, { error: { code: 'not_found', message: 'yok' } })
      }
      const fresh = await pool.query('SELECT id, email, save, created_at, last_seen_at, sessions, banned_at FROM benzinlik_player WHERE id=$1', [id])
      return json(res, 200, userRow(fresh.rows[0]))
    }
    if (url === '/vs/v1/feedback' && req.method === 'GET') {
      const limit = Math.min(200, Math.max(10, Number(u.searchParams.get('limit')) || 100))
      const rows = await pool.query('SELECT id, email, message, game, created_at, status, resolved_note FROM benzinlik_feedback ORDER BY (status=\'open\') DESC, id DESC LIMIT $1', [limit])
      return json(res, 200, { data: rows.rows.map(r => ({
        id: String(r.id),
        email: r.email,
        message: r.message,
        durum: r.status === 'resolved' ? 'Çözüldü' : r.status === 'wontfix' ? 'Kapatıldı' : 'Açık',
        cozumNotu: r.resolved_note || '',
        gun: r.game?.day ?? null,
        kasa: r.game?.money ?? null,
        cihaz: (r.game?.ua || '').slice(0, 60),
        createdAt: r.created_at,
      })), nextCursor: null })
    }
    const fbM = url.match(/^\/vs\/v1\/feedback\/(\d+)\/(resolve|reopen|wontfix)$/)
    if (fbM && req.method === 'POST') {
      const id = Number(fbM[1]); const act = fbM[2]
      const body = await readBody(req).catch(() => ({}))
      if (act === 'resolve') {
        await pool.query('UPDATE benzinlik_feedback SET status=\'resolved\', resolved_note=$2, resolved_at=now() WHERE id=$1', [id, String(body.note || 'Çözüldü').slice(0, 300)])
      } else if (act === 'wontfix') {
        await pool.query('UPDATE benzinlik_feedback SET status=\'wontfix\', resolved_note=$2, resolved_at=now() WHERE id=$1', [id, String(body.note || '').slice(0, 300)])
      } else {
        await pool.query('UPDATE benzinlik_feedback SET status=\'open\', resolved_note=NULL, resolved_at=NULL WHERE id=$1', [id])
      }
      const r = await pool.query('SELECT id, email, message, game, created_at, status, resolved_note FROM benzinlik_feedback WHERE id=$1', [id])
      const x = r.rows[0]
      return json(res, 200, { data: { id: String(x.id), durum: x.status === 'resolved' ? 'Çözüldü' : x.status === 'wontfix' ? 'Kapatıldı' : 'Açık', cozumNotu: x.resolved_note || '' } })
    }
    if (url === '/vs/v1/stats-hourly' && req.method === 'GET') {
      const rows = await pool.query(`
        SELECT to_char(hour, 'HH24:00') AS label, visits, signups, logins
        FROM benzinlik_stat_hourly WHERE hour > now() - interval '24 hours' ORDER BY hour`)
      return json(res, 200, { data: rows.rows })
    }
    if (url === '/vs/v1/engagement' && req.method === 'GET') {
      const agg = await pool.query(`
        SELECT
          coalesce(avg(sessions), 0)::float AS spu,
          count(*)::int AS total,
          count(*) FILTER (WHERE last_seen_at > now() - interval '5 min')::int AS active5m,
          count(*) FILTER (WHERE last_seen_at > now() - interval '1 hour')::int AS active1h,
          count(*) FILTER (WHERE last_seen_at > now() - interval '1 day')::int AS active1d,
          count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS new1d,
          count(*) FILTER (WHERE last_seen_at > created_at + interval '1 day')::int AS d1,
          count(*) FILTER (WHERE last_seen_at > created_at + interval '7 day')::int AS d7,
          count(*) FILTER (WHERE last_seen_at > created_at + interval '30 day')::int AS d30,
          coalesce(sum((save->'s'->'stats'->>'served')::int), 0)::int AS served,
          coalesce(sum((save->'s'->'stats'->>'kwh')::int), 0)::int AS kwh,
          coalesce(sum((save->'s'->'stats'->>'revenue')::numeric), 0)::bigint AS revenue,
          coalesce(round(avg((save->'s'->>'day')::int)), 0)::int AS avg_day,
          coalesce(max((save->'s'->>'day')::int), 0)::int AS max_day,
          coalesce(sum((save->'s'->'stats'->'liters'->>'benzin')::numeric), 0)::bigint AS l_benzin,
          coalesce(sum((save->'s'->'stats'->'liters'->>'dizel')::numeric), 0)::bigint AS l_dizel,
          coalesce(sum((save->'s'->'stats'->'liters'->>'lpg')::numeric), 0)::bigint AS l_lpg,
          count(*) FILTER (WHERE (save->'s'->>'evChargers')::int > 0)::int AS ev_stations,
          count(*) FILTER (WHERE (save->'s'->>'hasSMR')::boolean)::int AS nuclear_stations,
          coalesce(round(avg((save->'s'->>'reputation')::numeric), 2), 0)::float AS avg_rep
        FROM benzinlik_player`)
      const fb = await pool.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE status='open')::int AS acik FROM benzinlik_feedback")
      const vis = await pool.query(`SELECT
        coalesce(sum(visits),0)::int AS v24, coalesce(sum(signups),0)::int AS s24, coalesce(sum(logins),0)::int AS l24
        FROM benzinlik_stat_hourly WHERE hour > now() - interval '24 hours'`)
      const a = agg.rows[0]; const v = vis.rows[0]
      const conv = v.v24 > 0 ? Math.round((v.s24 / v.v24) * 100) : 0
      const pct = n => (a.total > 0 ? Math.round((n / a.total) * 100) : 0)
      return json(res, 200, {
        window: '30d',
        sessionsPerUser: Math.round(a.spu * 10) / 10,
        retention: { d1: pct(a.d1), d7: pct(a.d7), d30: pct(a.d30) },
        topEvents: [
          { event: 'AKTIF · su an (5dk)', count: Number(a.active5m) },
          { event: 'AKTIF · son 1 saat', count: Number(a.active1h) },
          { event: 'AKTIF · son 24 saat', count: Number(a.active1d) },
          { event: 'ZIYARET · son 24 saat', count: Number(v.v24) },
          { event: 'KAYIT · son 24 saat', count: Number(v.s24) },
          { event: 'GIRIS · son 24 saat', count: Number(v.l24) },
          { event: 'DONUSUM · ziyaret→kayit %', count: conv },
          { event: 'YENI OYUNCU · son 24 saat', count: Number(a.new1d) },
          { event: 'ACIK sorun bildirimi', count: fb.rows[0].acik },
          { event: 'toplam_musteri_servisi', count: Number(a.served) },
          { event: 'satilan_benzin_L', count: Number(a.l_benzin) },
          { event: 'satilan_dizel_L', count: Number(a.l_dizel) },
          { event: 'satilan_lpg_L', count: Number(a.l_lpg) },
          { event: 'satilan_elektrik_kWh', count: Number(a.kwh) },
          { event: 'toplam_ciro_TL', count: Number(a.revenue) },
          { event: 'ortalama_oyun_gunu', count: Number(a.avg_day) },
          { event: 'en_ileri_oyun_gunu', count: Number(a.max_day) },
          { event: 'elektrikli_istasyon_sayisi', count: Number(a.ev_stations) },
          { event: 'nukleer_reaktorlu_istasyon', count: Number(a.nuclear_stations) },
          { event: 'gun_ici_aktif_oyuncu', count: Number(a.active1d) },
          { event: 'ortalama_itibar_x100', count: Math.round(Number(a.avg_rep) * 100) },
          { event: 'sorun_bildirimi', count: fb.rows[0].n },
        ],
        asOf: new Date().toISOString(),
      })
    }
    if (url === '/vs/v1/health' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        version: process.env.GIT_SHA || '1.0.0',
        status: 'operational',
        uptime: { value: Math.round(process.uptime()), window: 'process-seconds', incidents: 0 },
      })
    }
    json(res, 404, { error: { code: 'not_found', message: 'yok' } })
  } catch (err) {
    console.error('vs api:', err)
    json(res, 500, { error: { code: 'server_error', message: 'Sunucu hatası.' } })
  }
}

const server = http.createServer(async (req, res) => {
  let url = (req.url || '/').split('?')[0]
  if (url.startsWith('/api/')) return handleApi(req, res, url)
  if (url.startsWith('/vs/v1/')) return handleVs(req, res, url)
  if (url === '/ads.txt' && process.env.ADSENSE_PUB) {
    res.writeHead(200, { 'content-type': 'text/plain' })
    return res.end(`google.com, ${String(process.env.ADSENSE_PUB).replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n`)
  }
  if (url === '/terms') url = '/terms.html'
  if (url === '/privacy') url = '/privacy.html'
  // statik dosyalar + SPA fallback
  let file = path.join(DIST, path.normalize(url).replace(/^([.][.][/\\])+/, ''))
  if (!file.startsWith(DIST)) file = path.join(DIST, 'index.html')
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  const ext = path.extname(file).toLowerCase()
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
  })
  createReadStream(file).pipe(res)
})

// dirençli boot: DB geç ayaklanırsa bile sunucu ASLA sessizce ölmez
async function start() {
  for (let i = 1; i <= 30; i++) {
    try {
      await initDb()
      break
    } catch (err) {
      console.error(`DB hazır değil (deneme ${i}/30):`, err.message)
      await new Promise(r => setTimeout(r, 2000))
    }
  }
  server.listen(PORT, () => console.log(`BenelOil sunucusu :${PORT}`))
}
start()
