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
  console.log('DB hazır (benzinlik_player).')
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
    if (url === '/api/register' && req.method === 'POST') {
      const { email, password } = await readBody(req)
      const e = String(email || '').trim().toLowerCase()
      if (!/^\S+@\S+\.\S+$/.test(e)) return json(res, 400, { error: 'Geçerli bir e-posta gir.' })
      if (String(password || '').length < 4) return json(res, 400, { error: 'Şifre en az 4 karakter olmalı.' })
      const exists = await pool.query('SELECT 1 FROM benzinlik_player WHERE email=$1', [e])
      if (exists.rowCount > 0) return json(res, 409, { error: 'Bu e-posta zaten kayıtlı — giriş yap.' })
      await pool.query('INSERT INTO benzinlik_player(email, pass) VALUES ($1, $2)', [e, hashPassword(String(password))])
      return json(res, 200, { token: sign(e), email: e })
    }
    if (url === '/api/login' && req.method === 'POST') {
      const { email, password } = await readBody(req)
      const e = String(email || '').trim().toLowerCase()
      const r = await pool.query('SELECT pass FROM benzinlik_player WHERE email=$1', [e])
      if (r.rowCount === 0 || !verifyPassword(String(password || ''), r.rows[0].pass)) {
        return json(res, 401, { error: 'E-posta veya şifre hatalı.' })
      }
      return json(res, 200, { token: sign(e), email: e })
    }
    if (url === '/api/save' && req.method === 'GET') {
      const email = auth(); if (!email) return
      const r = await pool.query('SELECT save, updated_at FROM benzinlik_player WHERE email=$1', [email])
      return json(res, 200, { save: r.rows[0]?.save ?? null, updatedAt: r.rows[0]?.updated_at ?? null })
    }
    if (url === '/api/save' && req.method === 'POST') {
      const email = auth(); if (!email) return
      const { save } = await readBody(req)
      await pool.query('UPDATE benzinlik_player SET save=$2, updated_at=now() WHERE email=$1', [email, save])
      return json(res, 200, { ok: true })
    }
    json(res, 404, { error: 'not found' })
  } catch (err) {
    console.error(err)
    json(res, 500, { error: 'Sunucu hatası.' })
  }
}

const server = http.createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0]
  if (url.startsWith('/api/')) return handleApi(req, res, url)
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

initDb().then(() => {
  server.listen(PORT, () => console.log(`Benzinlik sunucusu :${PORT}`))
})
