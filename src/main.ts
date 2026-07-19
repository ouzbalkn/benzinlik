import * as THREE from 'three'
import { World, PUMP_SLOTS_POS, EV_SLOTS_POS, TANK_POS } from './world'
import { Car, CarManager, Tanker } from './cars'
import { UI, BuildingCard } from './ui'
import {
  FuelType, FUELS, FUEL_LABEL, FUEL_PRICE, GameState, FILL_RATE, SPILL_PENALTY_PER_L, WRONG_FUEL_PENALTY, GRID_COST_PER_KWH,
  EV_PRICE_PER_KWH, TANK_CAPACITY, URANIUM_COST, PARCEL_COLS, PARCEL_ROWS, PAVE_COST, FUEL_COST, priceBounds,
  parcelKey, parcelCost, buyItem, doMaintenance, getShopItems, serializeState, hydrateState, checkAchievements,
} from './state'
import { loadModels, loadStatics } from './models'
import { audio } from './audio'
import * as auth from './auth'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

THREE.Object3D.DEFAULT_UP.set(0, 0, 1) // z yukarı

// ---- ÖNCE GİRİŞ: hesap yoksa oyun motoru hiç başlamaz ----
{
  // misafir modu YOK: vitrin (?full) dahil her şey giriş ister
  const gated = !localStorage.getItem('benzinlik-token')
  if (gated) {
    const gate = document.getElementById('authgate') as HTMLDivElement
    gate.style.display = 'flex'
    gate.classList.add('solid')
    const gErr = document.getElementById('agerr') as HTMLDivElement
    const gEmail = document.getElementById('gemail') as HTMLInputElement
    const gPass = document.getElementById('gpass') as HTMLInputElement
    const wire = (id: string, path: string) => {
      (document.getElementById(id) as HTMLButtonElement).addEventListener('click', async () => {
        gErr.textContent = ''
        try {
          const res = await fetch(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: gEmail.value, password: gPass.value }),
          })
          const d = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(d.error ?? 'Sunucuya ulaşılamadı.')
          localStorage.setItem('benzinlik-token', d.token)
          localStorage.setItem('benzinlik-email', d.email)
          location.reload()
        } catch (err) {
          gErr.textContent = (err as Error).message
        }
      })
    }
    wire('glogin', '/api/login')
    wire('gregister', '/api/register')
    gPass.addEventListener('keydown', e => {
      if (e.key === 'Enter') (document.getElementById('glogin') as HTMLButtonElement).click()
    })
    await new Promise(() => {}) // giriş yapılana dek modül burada durur
  }
}

const app = document.getElementById('app')!
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)) // performans: 2x retina yerine 1.5x yeterli
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1
app.appendChild(renderer.domElement)

// Kamera: (1x, 2y, 1z) yönünden ortografik; tekerlek = zoom, sürükle = kaydır
const VIEW = 26
const camera = new THREE.OrthographicCamera()
const camDir = new THREE.Vector3(1, 2, 1).normalize().multiplyScalar(42)
let camX = 0
let camY = 0

function updateCamera() {
  camera.position.set(camDir.x + camX, camDir.y + camY, camDir.z)
  camera.lookAt(camX, camY, 0)
}

let composer: EffectComposer | null = null

function resize() {
  const w = window.innerWidth, h = window.innerHeight
  renderer.setSize(w, h)
  composer?.setSize(w, h)
  const aspect = w / h
  camera.left = -VIEW * aspect / 2
  camera.right = VIEW * aspect / 2
  camera.top = VIEW / 2
  camera.bottom = -VIEW / 2
  camera.near = 0.1
  camera.far = 200
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
window.addEventListener('wheel', e => {
  // UI panellerinin üzerindeyken oyuna zoom geçirme (modal içinde scroll serbest)
  if ((e.target as HTMLElement).closest?.('.backdrop, .modal, #panel, #infocard, .hud')) return
  camera.zoom = Math.min(2.6, Math.max(0.78, camera.zoom * Math.exp(-e.deltaY * 0.0012)))
  camera.updateProjectionMatrix()
}, { passive: true })
resize()
updateCamera()

// tarayıcı autoplay kuralı: ilk dokunuşta ses sistemini aç
window.addEventListener('pointerdown', () => audio.ensure(), { once: true })

// sekme arka plandayken önemli olayları bildir (izin verildiyse) + başlıkta işaret
function notifyIfHidden(text: string) {
  if (!document.hidden) return
  document.title = `(!) ${text.slice(0, 40)}`
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification('Benzinlik', { body: text }) } catch { /* mobil kısıt */ }
  }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) document.title = `${world?.stationName ?? 'Benzinlik'} — Benzinlik`
})

// Kenney modelleri (yüklenemezse prosedürele düşer)
const [modelLib, staticLib] = await Promise.all([loadModels(), loadStatics()])

const world = new World(staticLib)
const state = new GameState()
world.isPavedFn = (c, r) => state.isPaved(c, r)
const isPromoMode = new URLSearchParams(location.search).has('promo')
let promoTick: ((dt: number) => void) | null = null
const ui = new UI()
ui.batteryKwh = () => state.battery
ui.feedbackContext = () => ({
  day: state.day, money: Math.round(state.money), pumps: state.pumps,
  rep: Number(state.reputation.toFixed(2)), ua: navigator.userAgent.slice(0, 120),
})
ui.tankerStatus = () => {
  const parts: string[] = []
  for (const f of FUELS) {
    const active = tankers.find(x => x.fuel === f)
    if (active) {
      if (active.t.unloading) parts.push(`${FUEL_LABEL[f]} · boşaltıyor`)
      else {
        const d = active.t.group.position.distanceTo(new THREE.Vector3(world.tankAnchor.x, world.tankAnchor.y, 0))
        parts.push(`${FUEL_LABEL[f]} · ${Math.max(1, Math.round(d))}m`)
      }
    } else if (state.orders[f].pending) {
      parts.push(`${FUEL_LABEL[f]} · ${Math.ceil(state.orders[f].eta)}s`)
    }
  }
  return parts
}
const tankers: { t: Tanker; fuel: FuelType; slot: number }[] = []
let evTurnAwayT = 0
let exploding = false
let selectedBuilding: string | null = null
let cardRefreshT = 0

composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(world.scene, camera))
composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.24, 0.4, 0.93)) // yarı çözünürlük bloom: gözle fark yok, kat kat hızlı
composer.addPass(new OutputPass())
composer.setSize(window.innerWidth, window.innerHeight)

const cars = new CarManager(world.scene, modelLib, {
  pumpCount: () => state.pumps,
  evCount: () => state.evChargers,
  entryChance: () => state.entryChance() * (isPromoMode ? 2.5 : 1),
  evShare: () => (state.evChargers > 0 ? Math.min(0.5, 0.15 + 0.09 * state.evChargers) * state.evPriceFactor() : 0),
  isPumpBroken: i => state.brokenPumps.has(i),
  isChargerBroken: i => state.brokenChargers.has(i),
  parkSpots: () => world.getParkingSpots(),
  extraObstacles: () => tankers.map(x => x.t.group.position),
  prices: () => state.prices,
  pumpSlot: i => world.pumpSlots[i],
  evSlot: i => world.evSlots[i],
  gateInY: () => world.gateIn.y,
  gateOutY: () => world.gateOut.y,
  truckSpots: () => world.getTruckSpots(),
  onTruckParked: () => {
    const fee = 40 + Math.round(Math.random() * 40)
    state.addPending('truckpark', fee, 'Tır parkı')
    ui.toast(`Tır park etti: ₺${fee} kumbarada`, 'good', true)
  },
  onCarReady: car => { if (!ui.activeCar) ui.selectCar(car) },
  onEvTurnedAway: () => {
    if (evTurnAwayT > 0) return
    evTurnAwayT = 4
    state.stats.lost++
    state.addRep(-0.3)
    audio.miss()
    ui.toast('EV müşterisi dolu (ama şarj etmeyen) üniteyi görüp KAÇTI — itibar düştü!', 'bad', true)
  },
  onCarLost: car => {
    state.stats.lost++
    ui.toast('Müşteri beklemekten sıkıldı ve gitti!', 'bad', true)
    audio.miss()
    state.addRep(-0.2)
    if (ui.activeCar === car) ui.selectCar(nextServableCar())
  },
})

function nextServableCar(): Car | null {
  return cars.cars.find(c => c.phase === 'atPump') ?? null
}

// ---- Pompa hortumları (her pompa bağımsız, her aracın kendi hortumu) ----
const hoses = new Map<Car, THREE.Group>()

function buildHose(car: Car): THREE.Group {
  const slot = car.slotIndex >= 0 ? world.pumpSlots[car.slotIndex] : car.group.position
  const bx = slot.x - 1.8
  const y = slot.y
  const start = new THREE.Vector3(bx + 0.3, y + 0.3, 1.3)
  const mid = new THREE.Vector3(bx + 0.85, y - 0.05, 0.5)
  const end = new THREE.Vector3(bx + 1.22, y - 0.35, 0.62)
  const curve = new THREE.QuadraticBezierCurve3(start, mid, end)
  const g = new THREE.Group()
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.045, 8),
    new THREE.MeshLambertMaterial({ color: 0x23272b }))
  tube.castShadow = true
  g.add(tube)
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.24),
    new THREE.MeshLambertMaterial({ color: car.nozzle === 'benzin' ? 0x2fa05a : car.nozzle === 'dizel' ? 0xe8862e : 0x2f6fed }))
  tip.position.copy(end)
  tip.position.z += 0.12
  g.add(tip)
  world.scene.add(g)
  return g
}

function syncHoses() {
  for (const c of cars.cars) {
    const need = c.kind === 'fuel' && c.phase === 'atPump' && !!c.nozzle && !c.wrongFuelHandled
    if (need && !hoses.has(c)) hoses.set(c, buildHose(c))
    else if (!need && hoses.has(c)) { world.scene.remove(hoses.get(c)!); hoses.delete(c) }
  }
  for (const [c, g] of hoses) {
    if (c.phase !== 'atPump' || !cars.cars.includes(c)) {
      world.scene.remove(g)
      hoses.delete(c)
    }
  }
}

// ---- Memnuniyet, tesis ziyaretleri ve yayalar ----

interface Visit {
  buildingId: string
  revenue: () => number
  toastMsg: (m: number) => string
  score: number
}

/** araç park edip yayanın yürüyerek ziyaret edeceği tesisler */
function facilityVisits(car: Car): Visit[] {
  const v: Visit[] = []
  if (car.wantsMarket && state.marketLevel > 0) {
    v.push({ buildingId: 'market', revenue: () => Math.round((25 + Math.random() * 35) * state.marketLevel), toastMsg: m => `🛒 Market alışverişi: +₺${m}`, score: 0.2 })
  }
  if (car.wantsToilet && state.toiletLevel > 0) {
    const fee = state.toiletFee
    v.push({
      buildingId: 'toilet',
      revenue: () => fee,
      toastMsg: mm => `🚻 Tuvalet ücreti: +₺${mm}`,
      score: 0.15 * state.toiletLevel - (fee > 0 ? 0.03 + fee * 0.012 : 0),
    })
  }
  if (car.wantsCoffee && state.hasCoffee) {
    v.push({ buildingId: 'coffee', revenue: () => Math.round(20 + Math.random() * 25), toastMsg: m => `☕ Kahve satışı: +₺${m}`, score: 0.15 })
  }
  if (car.wantsFood && state.hasRestaurant) {
    v.push({ buildingId: 'restaurant', revenue: () => Math.round(80 + Math.random() * 80), toastMsg: m => `🍽️ Restoran hesabı: +₺${m}`, score: 0.25 })
  }
  return v
}

/** olmayan tesisi arayan müşterinin hayal kırıklığı */
function missingPenalty(car: Car): number {
  let d = 0
  if (car.wantsToilet && state.toiletLevel === 0) { d -= 0.8; ui.toast('🚻 Müşteri tuvalet arıyordu, bulamadı!', 'bad') }
  if (car.wantsMarket && state.marketLevel === 0) d -= 0.3
  if (car.wantsCoffee && !state.hasCoffee) d -= 0.1
  if (car.wantsFood && !state.hasRestaurant) d -= 0.1
  if (car.wantsWash && !state.hasWash) d -= 0.25
  if (car.wantsOil && !state.hasOil) d -= 0.15
  return d
}

/** araç servisleri (yıkama, yağ, hava-su) — park gerektirmez */
function vehicleServices(car: Car): number {
  let d = 0
  if (car.wantsWash && state.hasWash) {
    const m = Math.round(60 + Math.random() * 60)
    state.addPending('wash', m, 'Oto yıkama'); d += 0.2
    ui.toast(`Araç yıkandı: ₺${m} kumbarada`, 'good')
  }
  if (car.wantsOil && state.hasOil) {
    const m = Math.round(150 + Math.random() * 100)
    state.facEarn('oil', m); d += 0.25
    ui.toast(`🔧 Yağ değişimi yapıldı: +₺${m}`, 'good')
  }
  if (car.wantsAir && state.hasAirWater) {
    const m = Math.round(10 + Math.random() * 10)
    state.addPending('airwater', m, 'Hava-su'); d += 0.1
  }
  return d
}

// yaya sistemi
interface Walker {
  g: THREE.Group
  queue: { p: THREE.Vector3; wait: number }[]
  wait: number
  done: () => void
}
const walkers: Walker[] = []
const pendingVisits = new Map<Car, { visits: Visit[]; score: number; started: boolean }>()

function personMesh(): THREE.Group {
  const g = new THREE.Group()
  const SHIRTS = [0xd66a5b, 0x5b8def, 0x62b56b, 0xe0b13e, 0x9a7bd0]
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.5, 10),
    new THREE.MeshLambertMaterial({ color: SHIRTS[Math.floor(Math.random() * SHIRTS.length)] }))
  body.rotation.x = Math.PI / 2
  body.position.z = 0.32
  body.castShadow = true
  g.add(body)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0xf0c8a0 }))
  head.position.z = 0.68
  g.add(head)
  return g
}

function spawnWalkerFor(car: Car, data: { visits: Visit[]; score: number; squat?: boolean }) {
  const start = car.group.position.clone().add(new THREE.Vector3(0.8, -0.6, 0))
  start.z = 0
  const stops = data.visits
    .map(v => world.buildings.find(b => b.id === v.buildingId))
    .filter(b => !!b)
    .map(b => {
      const p = b!.group.position.clone()
      p.x += 1.9; p.z = 0
      return p
    })
  const g = personMesh()
  g.position.copy(start)
  world.scene.add(g)
  const queue = stops.map(p => ({ p, wait: 1.4 }))
  queue.push({ p: start.clone(), wait: 0 })
  walkers.push({
    g, queue, wait: 0,
    done: () => {
      let score = data.score
      for (const v of data.visits) {
        const m = v.revenue()
        if (m > 0) { state.money -= m; state.facEarn(v.buildingId, m); ui.toast(v.toastMsg(m), 'good') }
        score += v.score
      }
      state.addRep((score - 3.3) * 0.08)
      car.showFeedback(emojiFor(score))
      if (!data.squat) cars.releaseCar(car) // işgalci: oyuncu GÖNDER diyene kadar kalır
      pendingVisits.delete(car)
    },
  })
}

function updateWalkers(dt: number) {
  for (let i = walkers.length - 1; i >= 0; i--) {
    const w = walkers[i]
    if (w.wait > 0) { w.wait -= dt; continue }
    const target = w.queue[0]
    if (!target) {
      world.scene.remove(w.g)
      walkers.splice(i, 1)
      w.done()
      continue
    }
    const d = new THREE.Vector3().subVectors(target.p, w.g.position)
    d.z = 0
    const dist = d.length()
    const step = 2.4 * dt
    if (dist <= step) {
      w.g.position.copy(target.p)
      w.wait = target.wait
      w.queue.shift()
    } else {
      d.normalize()
      w.g.position.addScaledVector(d, step)
      w.g.rotation.z = Math.atan2(d.y, d.x)
    }
  }
}

function emojiFor(score: number): string {
  return score >= 4.5 ? '😍' : score >= 3.5 ? '🙂' : score >= 2.5 ? '😐' : '😡'
}

// ---- Servis akışı (yakıt) ----

ui.onNozzle = (car, type: FuelType) => {
  car.nozzle = type
}

ui.onStart = (car, amount) => {
  car.targetAmount = amount
  car.filling = true
  car.beingServed = true
  audio.clunk()
}

ui.onStartFull = car => {
  // FULLE: gizli depo ihtiyacına kadar bas — ne tutacağı sonda belli olur
  car.fullMode = true
  car.filling = true
  car.beingServed = true
  audio.clunk()
}

/** servis bitti: skoru bağla, tesis ziyareti varsa otoparka çek, yoksa uğurla */
function trackDaily() {
  state.dailyServed++
  if (!state.dailyDone && state.dailyServed >= 15) {
    state.dailyDone = true
    state.money += 1000
    ui.toast('GÜNLÜK GÖREV TAMAM: 15 müşteri — ödül +₺1.000!', 'good', true)
    audio.achieve()
  } else if (!state.dailyDone && state.dailyServed % 5 === 0) {
    ui.toast(`Günlük görev: ${state.dailyServed}/15 müşteri`, '', true)
  }
}

function concludeService(car: Car, score: number) {
  if (car.isTruck && state.hasTruckPark && car.phase === 'atPump' && Math.random() < 0.45) {
    trackDaily()
    state.addRep((score - 3.3) * 0.1)
    car.showFeedback(emojiFor(score))
    car.hideBubble()
    car.filling = false
    car.beingServed = false
    if (ui.activeCar === car) ui.selectCar(nextServableCar())
    if (cars.sendTruckToParkFromPump(car)) return
    cars.releaseCar(car)
    return
  }
  trackDaily()
  score += missingPenalty(car) + vehicleServices(car)
  const visits = facilityVisits(car)
  if (visits.length > 0 && cars.sendToParking(car)) {
    pendingVisits.set(car, { visits, score, started: false })
    ui.toast('🅿️ Müşteri aracını otoparka çekti, tesisleri kullanacak.', '')
  } else {
    // otopark doluysa ziyaret gelirleri yine gelsin (hızlı mod)
    for (const v of visits) {
      const m = v.revenue()
      if (m > 0) { state.money -= m; state.facEarn(v.buildingId, m); ui.toast(v.toastMsg(m), 'good') }
      score += v.score
    }
    state.addRep((score - 3.3) * 0.08)
    car.showFeedback(emojiFor(score))
    cars.releaseCar(car)
  }
  if (ui.activeCar === car) ui.selectCar(nextServableCar())
}

function finishSale(car: Car) {
  const revenue0 = Math.min(car.filledValue, car.demandAmount)
  let revenue = revenue0
  const spill = Math.max(0, car.filled - car.demandLiters)
  let score = 3.5

  if (car.patienceFrac > 0.6) score += 0.5
  else if (car.patienceFrac < 0.25) score -= 1

  if (spill > 1) {
    // ufak taşmalar dert değil; anlamlı döküntüye anlamlı ceza
    const penalty = Math.max(5, Math.round(spill * SPILL_PENALTY_PER_L))
    state.money -= penalty
    score -= 0.8
    ui.toast(`Taşan yakıt cezası: -₺${penalty}`, 'bad')
  } else if (car.filledValue >= car.demandAmount - 10) {
    const tip = Math.round(revenue0 * 0.1)
    revenue += tip
    score += 0.8
    ui.toast(`Bahşiş: +₺${tip}`, 'good')
  } else {
    score -= 0.6 // eksik dolum: sessiz, sadece memnuniyet düşer
  }

  state.money += revenue
  state.stats.served++
  state.stats.revenue += revenue
  if (car.nozzle) state.stats.liters[car.nozzle] += car.filled
  car.filling = false
  concludeService(car, score)
}

function wrongFuel(car: Car) {
  car.wrongFuelHandled = true
  car.filling = false
  state.money -= WRONG_FUEL_PENALTY
  state.addRep(-0.4)
  ui.toast(`🚨 ${FUEL_LABEL[car.demandType]} isteyen araca ${FUEL_LABEL[car.nozzle!]} bastın! -${WRONG_FUEL_PENALTY} ₺`, 'bad')
  car.showFeedback('😡')
  cars.releaseCar(car)
  if (ui.activeCar === car) ui.selectCar(nextServableCar())
}

// ---- EV şarj ----

ui.onDismiss = car => {
  if (car.squatting) {
    car.squatting = false
    cars.releaseCar(car)
    ui.toast('Molacı uğurlandı — şarj yeri boşaldı.', 'good')
    if (ui.activeCar === car) ui.selectCar(nextServableCar())
    return
  }
  if (car.phase !== 'atPump' || car.filling || car.filled > 0) return
  state.addRep(-0.1)
  car.showFeedback('😐')
  ui.toast('Müşteri kibarca gönderildi.', '')
  cars.releaseCar(car)
  if (ui.activeCar === car) ui.selectCar(nextServableCar())
}

/** batarya deposu seviyesine göre araca akış hızı (kWh/sn) */
const DISCHARGE_RATE = [0, 15, 25, 40]

function startCharging(car: Car, auto = false) {
  if (car.phase !== 'atPump' || car.charging || car.squatting) return
  if (state.dieselRunning() && Math.random() < 0.35) {
    car.demandKwh = Math.ceil(car.demandKwh / 2)
    ui.toast('🔊 Jeneratör gürültüsünden rahatsız — yarısı kadar şarj isteyecek!', 'bad')
  }
  car.charging = true
  car.beingServed = true
  if (auto) ui.toast('Otomatik şarj başladı.', '', true)
  else if (state.battery < 1) ui.toast('Depo şu an boş — üretim geldikçe şarj yavaş akacak.', '')
}

ui.onChargeEV = car => startCharging(car)

/** kademeli EV şarjı: depo → araç akışı */
function tickEvCharging(dt: number) {
  const cap = DISCHARGE_RATE[state.batteryLevel] || 0
  for (const c of cars.cars) {
    if (!c.charging) continue
    if (c.phase !== 'atPump') { c.charging = false; continue }
    const need = c.demandKwh - c.chargedKwh
    const give = Math.min(need, cap * dt, state.battery)
    state.battery = Math.max(0, state.battery - give)
    c.chargedKwh += give
    c.setCounter(`⚡ ${Math.floor(c.chargedKwh)}/${c.demandKwh} kWh`)
    if (c.chargedKwh >= c.demandKwh - 0.001) {
      c.charging = false
      const revenue = Math.round(c.demandKwh * state.elecPrice)
      state.money += revenue
      state.stats.served++
      state.stats.kwh += c.demandKwh
      state.stats.revenue += revenue
      let score = 4.5
      if (c.patienceFrac < 0.4) score -= 1.5
      ui.toast(`⚡ ${c.demandKwh} kWh şarj tamamlandı: +₺${revenue}`, 'good')
      const anyFacility = state.marketLevel > 0 || state.toiletLevel > 0 || state.hasCoffee || state.hasRestaurant
      if (anyFacility && Math.random() < 0.12) {
        // işgalci: aracı ünitede bırakıp tesislere gidiyor — GÖNDER'e basılana dek yer dolu
        c.squatting = true
        c.beingServed = true
        c.setCounter('MOLADA')
        const visits = facilityVisits(c)
        spawnWalkerFor(c, { visits, score, squat: true })
        ui.toast('Müşteri şarj bitince tesislere takıldı — araca tıklayıp GÖNDER, yoksa yeni EV müşterileri kaçar!', 'bad')
      } else {
        concludeService(c, score)
      }
    }
  }
}

// ---- Sipariş, inşaat, bakım ----

ui.onOrderFuel = f => {
  if (state.placeOrder(f)) ui.toast(`${FUEL_LABEL[f]} tankeri yola çıktı!`, 'good')
}

/** satın alma sonrası sahnedeki görsel karşılığını kurar */
function buildVisual(id: string, pos?: THREE.Vector2) {
  const base = id.split('#')[0]
  if (base.startsWith('pump-') && pos) {
    world.addPump(parseInt(base.slice(5)), new THREE.Vector2(pos.x - 0.9, pos.y))
    return
  }
  if (base.startsWith('charger-') && pos) {
    world.addEvCharger(parseInt(base.slice(8)), new THREE.Vector2(pos.x - 0.5, pos.y))
    return
  }
  switch (base) {
    case 'pump': world.addPump(state.pumps - 1); break
    case 'sign': world.setSign(state.signLevel); break
    case 'tank': world.upgradeTankVisual(state.tankLevel); break
    case 'market': world.buildMarket(state.marketLevel, pos); break
    case 'toilet': world.buildToilet(state.toiletLevel, pos); break
    case 'battery': world.buildBattery(state.batteryLevel, pos); break
    case 'evcharger': world.addEvCharger(state.evChargers - 1); break
    case 'solar': world.buildSolar(state.landSouth ? 'south' : 'north', pos, id); break
    case 'dieselgen': world.buildDiesel(pos); break
    case 'smr': world.buildSMR(state.landNorth ? 'north' : 'south', pos); break
    case 'wash': world.buildWash(pos); break
    case 'oil': world.buildOil(pos); break
    case 'coffee': world.buildCoffee(pos); break
    case 'restaurant': world.buildRestaurant(pos); break
    case 'truckpark': world.buildTruckPark(pos); break
    case 'airwater': world.buildAirWater(pos, id); break
    case 'selfwash': world.buildSelfWash(pos, id); break
    case 'parking': world.buildParking(pos, id); break
    case 'office': world.buildOffice(pos); break
  }
}

// ---- Grid'e yerleştirme modu ----

interface Footprint { w: number; d: number; grass?: boolean }
const PLACEABLE: Record<string, (forMove: boolean) => Footprint> = {
  market: fm => ((fm ? state.marketLevel >= 2 : state.marketLevel >= 1) ? { w: 6, d: 8 } : { w: 5, d: 6 }),
  toilet: () => ({ w: 3, d: 4 }),
  battery: () => ({ w: 3, d: 2 }),
  solar: () => ({ w: 5, d: 7, grass: true }),
  dieselgen: () => ({ w: 2, d: 2 }),
  smr: () => ({ w: 6, d: 5 }),
  wash: () => ({ w: 4.5, d: 5 }),
  oil: () => ({ w: 4, d: 4 }),
  coffee: () => ({ w: 3.2, d: 3.2 }),
  restaurant: () => ({ w: 5.5, d: 6 }),
  truckpark: () => ({ w: 8, d: 6 }),
  airwater: () => ({ w: 1.6, d: 2 }),
  selfwash: () => ({ w: 5.5, d: 7 }),
  parking: () => ({ w: 4.6, d: 3.2 }),
  office: () => ({ w: 5, d: 5.5 }),
}

interface Rect { cx: number; cy: number; w: number; d: number }
const placedRects: (Rect & { id: string })[] = []
const placedPos: Record<string, [number, number]> = {}
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)

// ---- Kayıt sistemi ----

let lastRemotePush = 0

function savePayload() {
  return { s: serializeState(state), placedPos, placedRot, placedRects, at: Date.now() }
}

function persist() {
  if (isFullMode || isPromoMode) return
  // tek gerçek kaynak SQL: yerel kopya tutulmaz, eski veri asla hortlamaz
  if (auth.loggedIn() && Date.now() - lastRemotePush > 5_000) {
    lastRemotePush = Date.now()
    auth.pushSave(savePayload()).catch(() => {})
  }
}

let loadedSaveAt = 0

function applySaveData(d: Record<string, unknown>) {
  loadedSaveAt = Number(d.at ?? 0)
  hydrateState(state, (d.s ?? {}) as Record<string, unknown>)
  Object.assign(placedPos, (d.placedPos ?? {}) as Record<string, [number, number]>)
  Object.assign(placedRot, (d.placedRot ?? {}) as Record<string, number>)
  if (Array.isArray(d.placedRects)) placedRects.push(...(d.placedRects as (Rect & { id: string })[]).filter(r => r.id !== 'gatein' && r.id !== 'gateout'))
}

/** kayıttan gelen state'e göre sahneyi yeniden kurar */
function rebuildFromState() {
  for (const key of state.ownedParcels) {
    const [c, r] = key.split(',').map(Number)
    if (c === 0 && r === 1) continue
    world.markOwned(c, r)
  }
  for (const key of state.pavedParcels) {
    const [c, r] = key.split(',').map(Number)
    if (c === 0 && r === 1) continue
    world.paveParcel(c, r)
  }
  const pvv = (id: string) => (placedPos[id] ? new THREE.Vector2(placedPos[id][0], placedPos[id][1]) : undefined)
  for (let i = 1; i < state.pumps; i++) {
    const sp = pvv(`pump-${i}`)
    world.addPump(i, sp ? new THREE.Vector2(sp.x - 0.9, sp.y) : undefined)
  }
  for (let i = 0; i < state.evChargers; i++) {
    const sp = pvv(`charger-${i}`)
    world.addEvCharger(i, sp ? new THREE.Vector2(sp.x - 0.5, sp.y) : undefined)
  }
  world.setSign(state.signLevel)
  if (state.tankLevel > 0) world.upgradeTankVisual(state.tankLevel)
  const pv = (id: string) => (placedPos[id] ? new THREE.Vector2(placedPos[id][0], placedPos[id][1]) : undefined)
  if (state.marketLevel > 0) world.buildMarket(state.marketLevel, pv('market'))
  if (state.toiletLevel > 0) world.buildToilet(state.toiletLevel, pv('toilet'))
  if (state.batteryLevel > 0) world.buildBattery(state.batteryLevel, pv('battery'))
  for (let i = 0; i < state.solarCount; i++) {
    const iid = i === 0 ? 'solar' : `solar#${i}`
    world.buildSolar(state.landSouth ? 'south' : 'north', pv(iid), iid)
  }
  if (state.hasDiesel) world.buildDiesel(pv('dieselgen'))
  if (state.hasSMR) world.buildSMR(state.landNorth ? 'north' : 'south', pv('smr'))
  if (state.hasWash) world.buildWash(pv('wash'))
  if (state.hasOil) world.buildOil(pv('oil'))
  if (state.hasCoffee) world.buildCoffee(pv('coffee'))
  if (state.hasRestaurant) world.buildRestaurant(pv('restaurant'))
  if (state.hasTruckPark) world.buildTruckPark(pv('truckpark'))
  for (let i = 0; i < state.airWaterCount; i++) {
    const iid = i === 0 ? 'airwater' : `airwater#${i}`
    world.buildAirWater(pv(iid), iid)
  }
  for (let i = 0; i < state.selfWashCount; i++) {
    const iid = i === 0 ? 'selfwash' : `selfwash#${i}`
    world.buildSelfWash(pv(iid), iid)
  }
  for (let i = 0; i < state.parkingCount; i++) {
    const iid = i === 0 ? 'parking' : `parking#${i}`
    world.buildParking(pv(iid), iid)
  }
  if (placedPos.office) {
    world.removeBuildingGroup('office')
    world.buildOffice(pv('office'))
  }
  if (placedPos.gatein) world.buildGate('in', pv('gatein'))
  if (placedPos.gateout) world.buildGate('out', pv('gateout'))
  {
    const s0 = placedPos['pump-0']
    if (s0) world.movePump(0, new THREE.Vector2(s0[0] - 0.9, s0[1]))
  }
  if (placedPos.tank) world.moveTank(new THREE.Vector2(placedPos.tank[0], placedPos.tank[1]))
  for (const [id, rot] of Object.entries(placedRot)) world.rotateBuilding(id, rot)
  world.setClosed(state.closed)
}

/** araçların ASLA içinden geçemeyeceği katı objeler (fiziksel gövdeler) */
function hardRects(): { cx: number; cy: number; w: number; d: number }[] {
  const r: { cx: number; cy: number; w: number; d: number }[] = []
  for (let i = 0; i < state.pumps; i++) {
    const s = world.pumpSlots[i]
    r.push({ cx: s.x - 1.8, cy: s.y, w: 1.5, d: 3.4 })
  }
  for (let i = 0; i < state.evChargers; i++) {
    const s = world.evSlots[i]
    r.push({ cx: s.x - 1.1, cy: s.y, w: 0.9, d: 1.4 })
  }
  r.push({ cx: world.tankAnchor.x + 0.45, cy: world.tankAnchor.y + 0.45, w: 2.2, d: 2.2 })
  const of = world.buildings.find(b => b.id === 'office')
  if (of) r.push({ cx: of.group.position.x, cy: of.group.position.y, w: 4.2, d: 4.6 })
  for (const p of placedRects) {
    if (p.id.startsWith('parking') || p.id === 'gatein' || p.id === 'gateout') continue
    if (p.id.startsWith('pump-') || p.id.startsWith('charger-') || p.id === 'tank' || p.id === 'truckpark') continue
    r.push({ cx: p.cx, cy: p.cy, w: p.w, d: p.d })
  }
  return r
}

function fixedObstacles(skipId = ''): Rect[] {
  const r: Rect[] = [
    { cx: 4.3, cy: 0, w: 2.0, d: 48 },       // servis şeridi (araç yolu, daraltıldı)
    { cx: 4.0, cy: -11.5, w: 2.4, d: 3.4 },  // tabela
  ]
  if (skipId !== 'tank')
    r.push({ cx: world.tankAnchor.x + 0.45, cy: world.tankAnchor.y + 0.45, w: 2.0, d: 2.0 })
  if (skipId !== 'office') {
    const of = world.buildings.find(b => b.id === 'office')
    if (of) r.push({ cx: of.group.position.x, cy: of.group.position.y, w: 4.6, d: 5.0 })
  }
  for (let i = 0; i < state.pumps; i++) {
    if (skipId === `pump-${i}`) continue
    const s = world.pumpSlots[i]
    r.push({ cx: s.x - 0.9, cy: s.y, w: 4.4, d: 4.0 })
  }
  for (let i = 0; i < state.evChargers; i++) {
    if (skipId === `charger-${i}`) continue
    const s = world.evSlots[i]
    r.push({ cx: s.x - 0.6, cy: s.y, w: 4.0, d: 2.6 })
  }
  return r
}

function overlaps(a: Rect, b: Rect): boolean {
  return Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 && Math.abs(a.cy - b.cy) < (a.d + b.d) / 2
}

let placing: {
  id: string; w: number; d: number; grass: boolean; move: boolean
  root: THREE.Group; planeMat: THREE.MeshBasicMaterial
  valid: boolean; cx: number; cy: number; rot: number
} | null = null
const placedRot: Record<string, number> = {}

/** yerleştirme için silik model önizlemesi üretir */
function makePreview(id: string): THREE.Group | null {
  let g: THREE.Group | null = null
  const existing = world.buildings.find(b => b.id === id)
  if (existing) {
    g = (existing.group as THREE.Group).clone(true)
  } else {
    // binayı gerçekten kur, kayıttan düşüp hayalet olarak kullan
    const bump = id === 'market' ? 'marketLevel' : id === 'toilet' ? 'toiletLevel' : id === 'battery' ? 'batteryLevel' : null
    if (bump) (state as any)[bump]++
    buildVisual(id, new THREE.Vector2(0, 0))
    if (bump) (state as any)[bump]--
    g = world.detachPreview(id)
  }
  if (!g) return null
  g.position.set(0, 0, 0)
  g.rotation.z = 0
  g.traverse(o => {
    if ((o as THREE.Sprite).isSprite) { o.visible = false; return }
    const m = o as THREE.Mesh
    if (m.isMesh && m.material) {
      const mats = Array.isArray(m.material) ? m.material : [m.material]
      const clones = mats.map(x => {
        const c = (x as THREE.Material).clone()
        c.transparent = true
        ;(c as THREE.Material & { opacity: number }).opacity = 0.45
        c.depthWrite = false
        return c
      })
      m.material = (Array.isArray(m.material) ? clones : clones[0]) as THREE.Material
      m.castShadow = false
      m.receiveShadow = false
    }
  })
  return g
}

// ---- Kart görselleri: gerçek 3D modellerin PNG render'ları ----
let thumbRenderer: THREE.WebGLRenderer | null = null
const thumbCache = new Map<string, string>()

function thumbKey(id: string): string {
  if (id === 'market') return `market-${Math.min(state.marketLevel + 1, 2)}`
  if (id === 'toilet') return `toilet-${Math.min(state.toiletLevel + 1, 2)}`
  if (id === 'battery') return `battery-${Math.min(state.batteryLevel + 1, 3)}`
  if (id === 'sign') return `sign-${Math.min(state.signLevel, 3)}`
  return id
}

function buildThumbSubject(id: string): THREE.Group | null {
  const special = world.thumbSource(id)
  if (special) return special
  // bina sahnede zaten varsa görseli KOPYASINDAN üret — gerçek binaya asla dokunma
  const existing = world.buildings.find(b => b.id === id)
  if (existing) {
    const g = (existing.group as THREE.Group).clone(true)
    g.position.set(0, 0, 0)
    g.rotation.z = 0
    return g
  }
  if (id === 'pump') {
    if (state.pumps >= 4) {
      const ex = world.buildings.find(b => b.id.startsWith('pump-'))
      if (ex) { const g = (ex.group as THREE.Group).clone(true); g.position.set(0, 0, 0); return g }
    }
    world.addPump(state.pumps)
    const g = world.detachPreview(`pump-${state.pumps}`)
    if (g) world.scene.remove(g)
    return g
  }
  if (id === 'evcharger') {
    if (state.evChargers >= 4) {
      const ex = world.buildings.find(b => b.id.startsWith('charger-'))
      if (ex) { const g = (ex.group as THREE.Group).clone(true); g.position.set(0, 0, 0); return g }
    }
    world.addEvCharger(state.evChargers)
    const g = world.detachPreview(`charger-${state.evChargers}`)
    if (g) world.scene.remove(g)
    return g
  }
  if (id in PLACEABLE) {
    const bump = id === 'market' ? 'marketLevel' : id === 'toilet' ? 'toiletLevel' : id === 'battery' ? 'batteryLevel' : null
    let orig = 0
    if (bump) {
      orig = (state as any)[bump]
      ;(state as any)[bump] = Math.min(orig + 1, id === 'battery' ? 3 : 2)
    }
    buildVisual(id, new THREE.Vector2(0, 0))
    if (bump) (state as any)[bump] = orig
    const g = world.detachPreview(id)
    if (g) world.scene.remove(g)
    return g
  }
  return null
}

function getThumbnail(id: string): string | null {
  const key = thumbKey(id)
  const hit = thumbCache.get(key)
  if (hit) return hit
  const subject = buildThumbSubject(id)
  if (!subject) return null
  subject.traverse(o => { if ((o as THREE.Sprite).isSprite) o.visible = false })
  if (!thumbRenderer) {
    thumbRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
    thumbRenderer.setSize(300, 300)
    thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping
    thumbRenderer.toneMappingExposure = 1.15
  }
  const sc = new THREE.Scene()
  sc.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.35))
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4)
  sun.position.set(8, -5, 11)
  sc.add(sun)
  sc.add(subject)
  const bb = new THREE.Box3().setFromObject(subject)
  const center = bb.getCenter(new THREE.Vector3())
  const size = bb.getSize(new THREE.Vector3())
  const r = Math.max(size.x, size.y, size.z) * 0.56 + 0.35
  const cam = new THREE.OrthographicCamera(-r * 1.05, r * 1.05, r * 1.05, -r * 1.05, 0.1, 200)
  cam.up.set(0, 0, 1)
  cam.position.copy(center).add(new THREE.Vector3(1, 2, 1).normalize().multiplyScalar(40))
  cam.lookAt(center)
  thumbRenderer.render(sc, cam)
  const url = thumbRenderer.domElement.toDataURL('image/png')
  thumbCache.set(key, url)
  sc.remove(subject)
  return url
}
ui.getThumb = getThumbnail

/** ayak izi hücre çizgileri — kareler net görünsün */
function footprintGrid(w: number, d: number): THREE.LineSegments {
  const pts: number[] = []
  const hw = w / 2, hd = d / 2
  for (let x = -hw; x <= hw + 0.001; x += 1) pts.push(x, -hd, 0.07, x, hd, 0.07)
  for (let y = -hd; y <= hd + 0.001; y += 1) pts.push(-hw, y, 0.07, hw, y, 0.07)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return new THREE.LineSegments(geo,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }))
}
let zoneMode: { kind: 'land' | 'pave'; ghost: THREE.Mesh; c: number; r: number; valid: boolean } | null = null

function parcelAt(x: number, y: number): [number, number] | null {
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
    const [x0, x1] = PARCEL_COLS[c]
    const [y0, y1] = PARCEL_ROWS[r]
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return [c, r]
  }
  return null
}

function landOk(x: number, y: number, grassOk: boolean): boolean {
  const p = parcelAt(x, y)
  if (!p) return false
  if (!state.owns(p[0], p[1])) return false
  return grassOk || state.isPaved(p[0], p[1])
}

function isValidPlacement(p: Rect, skipId: string, grassOk: boolean): boolean {
  for (const sx of [-1, 0, 1]) for (const sy of [-1, 0, 1]) {
    if (!landOk(p.cx + sx * (p.w / 2 - 0.2), p.cy + sy * (p.d / 2 - 0.2), grassOk)) return false
  }
  for (const o of fixedObstacles(skipId)) if (overlaps(p, o)) return false
  for (const o of placedRects) if (o.id !== skipId && overlaps(p, o)) return false
  return true
}

function makeGhost(w: number, d: number): THREE.Mesh {
  const ghost = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ color: 0x37c97e, transparent: true, opacity: 0.42, depthTest: false }))
  ghost.position.z = 0.06
  world.scene.add(ghost)
  return ghost
}

function footprintOf(id: string, move = false): { w: number; d: number; grass?: boolean } | null {
  id = id.split('#')[0]
  if (id.startsWith('pump-')) return { w: 4.4, d: 4.0 }
  if (id.startsWith('charger-')) return { w: 4.0, d: 2.6 }
  if (id === 'tank') return { w: 2.0, d: 2.0 }
  if (id === 'gatein' || id === 'gateout') return { w: 2.6, d: 3.4, grass: true }
  return id in PLACEABLE ? PLACEABLE[id](move) : null
}

function startPlacement(id: string, move = false) {
  cancelPlacement()
  const f = footprintOf(id, move)
  if (!f) return
  const root = new THREE.Group()
  const planeMat = new THREE.MeshBasicMaterial({ color: 0x37c97e, transparent: true, opacity: 0.22, depthWrite: false })
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(f.w, f.d), planeMat)
  plane.position.z = 0.05
  root.add(plane)
  root.add(footprintGrid(f.w, f.d))
  const preview = makePreview(id)
  if (preview) root.add(preview)
  world.scene.add(root)
  placing = { id, w: f.w, d: f.d, grass: !!f.grass, move, root, planeMat, valid: false, cx: 0, cy: 0, rot: placedRot[id] ?? 0 }
  root.rotation.z = placing.rot * Math.PI / 2
  world.showGrid(true)
  ui.closeShop()
  ui.hideBuildingCard()
  ui.toast(move
    ? 'Taşıma modu: yeni yeri seç · R ile döndür · sağ tık/ESC iptal'
    : 'Yerleştirme modu: kareye tıkla · R ile döndür · sağ tık/ESC iptal', '')
}

function startZoneMode(kind: 'land' | 'pave') {
  cancelPlacement()
  zoneMode = { kind, ghost: makeGhost(1, 1), c: -1, r: -1, valid: false }
  world.showGrid(true)
  ui.closeShop()
  ui.toast(kind === 'land'
    ? '🏞️ Arsa seçimi: bitişik parsele tıkla (₺6-14 bin) · ESC iptal'
    : '🧱 Zemin seçimi: betonlanacak arsana tıkla · ESC iptal', '')
}

function cancelPlacement() {
  if (placing) {
    world.scene.remove(placing.root)
    placing = null
  }
  if (zoneMode) {
    world.scene.remove(zoneMode.ghost)
    zoneMode = null
  }
  world.showGrid(false)
}

/** taşımayı uygula — pompa/şarj/tank özel, kalanlar buildVisual */
function applyDynamicMove(id: string, cx: number, cy: number) {
  if (id.startsWith('pump-')) {
    const n = parseInt(id.slice(5))
    cars.evictSlot('fuel', n) // slottaki araç eski koordinatta asılı kalmasın
    world.movePump(n, new THREE.Vector2(cx - 0.9, cy))
  }
  else if (id.startsWith('charger-')) {
    const n = parseInt(id.slice(8))
    cars.evictSlot('ev', n)
    world.moveCharger(n, new THREE.Vector2(cx - 0.5, cy))
  }
  else if (id === 'tank') world.moveTank(new THREE.Vector2(cx, cy))
  else if (id === 'gatein') world.buildGate('in', new THREE.Vector2(cx, cy))
  else if (id === 'gateout') world.buildGate('out', new THREE.Vector2(cx, cy))
  else {
    world.removeBuildingGroup(id)
    buildVisual(id, new THREE.Vector2(cx, cy))
  }
}

function confirmPlacement() {
  const p = placing!
  if (p.move) {
    applyDynamicMove(p.id, p.cx, p.cy)
    ui.toast('Taşındı!', 'good')
  } else {
    const purchaseId = p.id.startsWith('pump-') ? 'pump'
      : p.id.startsWith('charger-') ? 'evcharger'
      : p.id.split('#')[0]
    if (!buyItem(state, purchaseId)) {
      ui.toast('💸 Para yetmiyor!', 'bad')
      cancelPlacement()
      return
    }
    buildVisual(p.id, new THREE.Vector2(p.cx, p.cy))
    buyToast(p.id.split('#')[0].replace(/^pump-\d+$/, 'pump').replace(/^charger-\d+$/, 'evcharger'))
  }
  if (!p.id.startsWith('pump-') && !p.id.startsWith('charger-') && p.id !== 'tank' && p.id !== 'gatein' && p.id !== 'gateout')
    world.rotateBuilding(p.id, p.rot)
  placedPos[p.id] = [p.cx, p.cy]
  placedRot[p.id] = p.rot
  const i = placedRects.findIndex(r => r.id === p.id)
  if (i >= 0) placedRects.splice(i, 1)
  if (p.id !== 'gatein' && p.id !== 'gateout') {
    const odd = p.rot % 2 === 1
    placedRects.push({ id: p.id, cx: p.cx, cy: p.cy, w: odd ? p.d : p.w, d: odd ? p.w : p.d })
  }
  cancelPlacement()
  persist()
}

function confirmZone() {
  const z = zoneMode!
  const key = parcelKey(z.c, z.r)
  if (z.kind === 'land') {
    const cost = parcelCost(z.c, z.r, state)
    if (state.money < cost) { ui.toast('💸 Para yetmiyor!', 'bad'); return }
    state.money -= cost
    state.ownedParcels.add(key)
    world.markOwned(z.c, z.r)
    ui.toast(`🏞️ Arsa satın alındı (-₺${cost.toLocaleString('tr-TR')}) — yapı için Zemin Betonu döşe.`, 'good')
  } else {
    if (state.money < PAVE_COST) { ui.toast('💸 Para yetmiyor!', 'bad'); return }
    state.money -= PAVE_COST
    state.pavedParcels.add(key)
    world.paveParcel(z.c, z.r)
    ui.toast('🧱 Zemin betonlandı — artık yapı kurabilirsin!', 'good')
  }
  cancelPlacement()
  persist()
}

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') cancelPlacement()
  if ((e.key === 'r' || e.key === 'R') && placing) {
    if (placing.id.startsWith('pump-') || placing.id.startsWith('charger-') || placing.id === 'tank' || placing.id === 'gatein' || placing.id === 'gateout') {
      ui.toast('Bu ünitenin yönü sabittir (araç yanaşması) — sadece yerini seçebilirsin.', '')
      return
    }
    placing.rot = (placing.rot + 1) % 4
    placing.root.rotation.z = placing.rot * Math.PI / 2
  }
})
renderer.domElement.addEventListener('contextmenu', e => { e.preventDefault(); cancelPlacement() })

const COUNTABLE: Record<string, () => number> = {
  parking: () => state.parkingCount,
  solar: () => state.solarCount,
  selfwash: () => state.selfWashCount,
  airwater: () => state.airWaterCount,
}

ui.onBuy = id => {
  audio.click()
  if (id === 'land' || id === 'pave') {
    startZoneMode(id)
    return
  }
  const item0 = getShopItems(state).find(r => r.id === id)
  if (id in COUNTABLE) {
    if (!item0 || item0.status !== 'buy' || state.money < (item0.cost ?? Infinity)) return
    const n = COUNTABLE[id]()
    startPlacement(n === 0 ? id : `${id}#${n}`)
    return
  }
  if (id === 'pump' && state.pumps >= 4) {
    if (!item0 || item0.status !== 'buy' || state.money < (item0.cost ?? Infinity)) return
    startPlacement(`pump-${state.pumps}`)
    return
  }
  if (id === 'evcharger' && state.evChargers >= 4) {
    if (!item0 || item0.status !== 'buy' || state.money < (item0.cost ?? Infinity)) return
    startPlacement(`charger-${state.evChargers}`)
    return
  }
  const needsPlacement = id in PLACEABLE && !(id === 'battery' && state.batteryLevel > 0)
  if (needsPlacement) {
    if (!item0 || item0.status !== 'buy' || state.money < (item0.cost ?? Infinity)) return
    startPlacement(id)
    return
  }
  if (!buyItem(state, id)) return
  buildVisual(id)
  buyToast(id)
  persist()
  if (selectedBuilding) refreshBuildingCard()
}

ui.onMove = id => {
  if (!footprintOf(id)) return
  startPlacement(id, true)
}

function buyToast(id: string) {
  audio.build()
  switch (id) {
    case 'pump': ui.toast(`⛽ Pompa #${state.pumps} kuruldu!`, 'good'); break
    case 'sign': ui.toast('🪧 Tabela büyüdü — daha çok müşteri gelecek!', 'good'); break
    case 'tank': ui.toast(`🛢️ Tank kapasitesi: ${state.tankCapacity}L`, 'good'); break
    case 'market': ui.toast('🛒 Market açıldı!', 'good'); break
    case 'toilet': ui.toast('🚻 Tuvalet hizmete girdi!', 'good'); break
    case 'grid': ui.toast(`⚡ Elektrik altyapısı Sv.${state.gridLevel} kuruldu!`, 'good'); break
    case 'battery': ui.toast('🔋 Batarya deposu kuruldu — üretim biriktikçe dolacak.', 'good'); break
    case 'evcharger': syncSignPrices(); ui.toast('🔌 DC şarj ünitesi kuruldu!', 'good'); break
    case 'solar': ui.toast('☀️ Güneş santrali kuruldu. ⚠️ Paneller zamanla kirlenir!', 'good'); break
    case 'dieselgen': ui.toast('🛠️ Jeneratör kuruldu. ⚠️ Gürültüsü EV müşterilerini kaçırabilir!', 'good'); break
    case 'smr': ui.toast('☢️ Reaktör devrede! ⚠️ BAKIMI ASLA AKSATMA — patlarsa her şey gider!', 'bad'); break
    case 'wash': ui.toast('🚿 Oto yıkama açıldı — müşteriler araç yıkatacak!', 'good'); break
    case 'oil': ui.toast('🔧 Yağ değişim istasyonu açıldı!', 'good'); break
    case 'coffee': ui.toast('☕ Kahveci açıldı!', 'good'); break
    case 'restaurant': ui.toast('🍽️ Restoran açıldı — yolcular yemek molası verecek!', 'good'); break
    case 'truckpark': ui.toast('🚛 Tır parkı açıldı — düzenli konaklama geliri!', 'good'); break
    case 'airwater': ui.toast('💨 Hava-su ünitesi kuruldu!', 'good'); break
    case 'selfwash': ui.toast('🧽 Self yıkama açıldı — köpük ve su otomatik satılacak!', 'good'); break
    case 'parking': ui.toast('🅿️ Otopark açıldı — müşteriler park edip tesisleri gezebilecek!', 'good'); break
  }
}

// 🧪 FULL / vitrin modu: ?full=1 ile her şey kurulu başlar
const isFullMode = new URLSearchParams(location.search).has('full')
let saveLoaded = false
if (!isFullMode && !isPromoMode && auth.loggedIn()) {
  try {
    const remote = await auth.pullSave()
    if (remote) {
      applySaveData(remote as Record<string, unknown>)
      saveLoaded = true
      ui.toast(`Bulut kaydı yüklendi — Gün ${state.day} (${auth.currentEmail()})`, 'good', true)
    }
  } catch {
    ui.toast('Buluta ulaşılamadı, yerel kayıt kullanılıyor.', 'bad', true)
  }
}
if (saveLoaded) rebuildFromState()
else if (!isFullMode && !isPromoMode) ui.toast('Sıfırdan başlıyorsun — hayırlı olsun patron!', 'good', true)
// eski yerel kayıt kalıntılarını temizle (artık her şey SQL'de)
for (const key of Object.keys(localStorage)) {
  if (key.startsWith('benzinlik-save-v1')) localStorage.removeItem(key)
}
// sekme kapanırken son durumu buluta yaz
window.addEventListener('pagehide', () => {
  if (isFullMode || !auth.loggedIn()) return
  fetch('/api/save', {
    method: 'POST',
    keepalive: true,
    headers: { 'content-type': 'application/json', 'x-auth': localStorage.getItem('benzinlik-token') ?? '' },
    body: JSON.stringify({ save: savePayload() }),
  }).catch(() => {})
})
ui.syncAccount(auth.currentEmail())

// ---- Zorunlu giriş kapısı: hesap yoksa oyun oynanmaz ----
async function doLogin(email: string, pass: string) {
  await auth.login(email, pass)
  location.reload()
}
async function doRegister(email: string, pass: string) {
  await auth.register(email, pass)
  location.reload()
}

document.getElementById('authgate')?.remove()
{

  // ---- Günlük giriş bonusu + seri + görev sıfırlama ----
  const today = new Date().toISOString().slice(0, 10)
  if (!isFullMode && state.lastLoginDate !== today) {
    const yest = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    state.loginStreak = state.lastLoginDate === yest ? state.loginStreak + 1 : 1
    state.lastLoginDate = today
    const bonus = 250 + 250 * Math.min(state.loginStreak, 7)
    state.money += bonus
    ui.toast(`Günlük giriş bonusu: +₺${bonus} (seri: ${state.loginStreak} gün)`, 'good', true)
    audio.achieve()
    state.dailyDate = today
    state.dailyServed = 0
    state.dailyDone = false
    persist()
  }
  if (state.dailyDate !== today) {
    state.dailyDate = today
    state.dailyServed = 0
    state.dailyDone = false
  }

  // ---- Offline kazanç raporu: sen yokken tesisler çalıştı ----
  if (!isFullMode && loadedSaveAt > 0) {
    const offSec = Math.min((Date.now() - loadedSaveAt) / 1000, 7200) // en fazla 2 saatlik birikim
    if (offSec > 90) {
      let total = 0
      const gains: [string, string, number][] = []
      if (state.hasTruckPark) gains.push(['truckpark', 'Tır parkı', 125 / 45])
      if (state.hasSelfWash) gains.push(['selfwash', 'Self yıkama', 45 / 35])
      for (const [id, name, rate] of gains) {
        const amt = Math.round(rate * offSec)
        state.addPending(id, amt, name)
        total += Math.min(amt, 600)
      }
      if (total > 0) {
        ui.toast(`Sen yokken tesislerin çalıştı: kumbaralarda ~₺${total} birikti — topla!`, 'good', true)
        audio.cash()
      }
    }
  }
}

ui.onLogin = async (email, pass) => {
  try {
    await auth.login(email, pass)
    location.reload()
  } catch (err) {
    ui.toast((err as Error).message, 'bad')
  }
}
ui.onRegister = async (email, pass) => {
  try {
    await auth.register(email, pass)
    location.reload()
  } catch (err) {
    ui.toast((err as Error).message, 'bad')
  }
}
ui.onLogout = () => {
  auth.logout()
  location.href = '/' // doğrudan giriş ekranına dön (misafir modu yok)
}
if (isFullMode) {
  for (const key of ['0,0', '0,2', '1,1']) {
    const [c, r] = key.split(',').map(Number)
    state.ownedParcels.add(key)
    state.pavedParcels.add(key)
    world.markOwned(c, r)
    world.paveParcel(c, r)
  }
  const FULL_ORDER = [
    'pump', 'pump', 'pump', 'sign', 'sign', 'sign',
    'tank', 'tank', 'tank', 'market', 'market', 'toilet', 'toilet', 'grid', 'grid',
    'battery', 'battery', 'battery', 'evcharger', 'evcharger', 'evcharger', 'evcharger',
    'solar', 'dieselgen', 'smr', 'wash', 'oil',
    'airwater', 'selfwash', 'coffee', 'restaurant', 'truckpark', 'parking',
  ]
  state.money = 10_000_000
  for (const id of FULL_ORDER) {
    if (buyItem(state, id)) buildVisual(id)
  }
  state.money = 50_000
  for (const f of FUELS) state.tanks[f] = state.tankCapacity
  state.battery = state.batteryCapacity
  ui.toast('🧪 FULL MOD: her şey kurulu — sürükleyerek gez, tekerlekle yaklaş!', 'good')
}

ui.onMaint = id => {
  if (id.startsWith('auto-charger-')) {
    const i = parseInt(id.slice(13))
    if (state.autoChargers.has(i)) state.autoChargers.delete(i)
    else state.autoChargers.add(i)
    ui.toast(state.autoChargers.has(i)
      ? `DC Şarj #${i + 1}: otomatik şarj AÇIK — EV'ler sormadan şarj alır.`
      : `DC Şarj #${i + 1}: otomatik şarj kapalı.`, 'good')
    refreshBuildingCard()
    persist()
    return
  }
  if (id === 'toilet-fee') {
    state.toiletFee = state.toiletFee === 0 ? 5 : state.toiletFee === 5 ? 10 : 0
    ui.toast(state.toiletFee === 0 ? 'Tuvalet artık ücretsiz.' : `Tuvalet ücreti: ₺${state.toiletFee}`, 'good')
    refreshBuildingCard()
    persist()
    return
  }
  if (doMaintenance(state, id)) {
    if (id === 'clean-solar') ui.toast('🧽 Paneller tertemiz, üretim tam güçte!', 'good')
    else if (id === 'maint-smr') ui.toast('☢️ Reaktör bakımı yapıldı, güvendesin.', 'good')
    else if (id === 'order-uranium') ui.toast('☢️ Uranyum siparişi verildi — özel konvoy yolda!', 'good')
    else ui.toast('🔧 Tamir edildi, tekrar hizmette!', 'good')
    if (selectedBuilding) refreshBuildingCard()
  } else {
    ui.toast('💸 Bunun için yeterli para yok!', 'bad')
  }
}

ui.onCardClose = () => {
  selectedBuilding = null
  world.setSelected(null)
}

ui.onReset = async () => {
  if (auth.loggedIn()) await auth.pushSave(null).catch(() => {})
  location.reload()
}

ui.onToggleClosed = () => {
  state.closed = !state.closed
  world.setClosed(state.closed)
  ui.toast(state.closed
    ? 'İstasyon KAPALI — yeni müşteri girmez, itibar etkilenmez. Bakım için rahatsın.'
    : 'İstasyon tekrar AÇIK — bekleriz!', state.closed ? '' : 'good')
  persist()
}

// ---- İstasyon adı ----
const nameInput = document.getElementById('stname') as HTMLInputElement

function applyStationName(name: string, silent = false) {
  world.setStationName(name)
  state.stationName = world.stationName // hesaba bağlı: bulut kaydıyla gezer
  nameInput.value = world.stationName
  document.title = `${world.stationName} — Benzinlik`
  if (!silent) {
    ui.toast(`Tabela güncellendi: ${world.stationName}`, 'good')
    persist()
  }
}

// eski tarayıcı-geneli isim kaydından hesaba göç (bir kereye mahsus)
const legacyName = localStorage.getItem('benzinlik-station-name')
applyStationName(
  state.stationName && state.stationName !== 'BENZİNLİK'
    ? state.stationName
    : (legacyName && legacyName !== 'OPET' ? legacyName : 'BENZİNLİK'),
  true,
)
ui.onRename = name => applyStationName(name)


// tek seferlik: patronun betonları söküldü, parası iade (mekanik testi için)
if (!isFullMode && auth.currentEmail() === 'oguz@benerits.com' && !localStorage.getItem('benzinlik-refund-2')) {
  localStorage.setItem('benzinlik-refund-2', '1')
  const extra = [...state.pavedParcels].filter(k => k !== '0,1')
  if (extra.length > 0) {
    for (const k of extra) state.pavedParcels.delete(k)
    state.money += extra.length * PAVE_COST
    ui.toast(`Beton iadesi: ${extra.length} arsa söküldü, +₺${(extra.length * PAVE_COST).toLocaleString('tr-TR')} iade edildi.`, 'good', true)
    persist()
    setTimeout(() => location.reload(), 1200) // sahne temiz kurulsun
  }
}

// kâr marjı ayarı (ofis kartından): alış sabit, satışı oyuncu belirler
function syncSignPrices() {
  world.setPrices(state.prices.benzin, state.prices.dizel, state.prices.lpg,
    state.evChargers > 0 ? state.elecPrice : 0)
}
syncSignPrices()
ui.onPriceChange = (f, delta) => {
  if (f === 'elec') {
    state.elecPrice = Math.min(18, Math.max(4, Math.round((state.elecPrice + delta) * 2) / 2))
    syncSignPrices()
  } else {
    const [lo, hi] = priceBounds(f)
    state.prices[f] = Math.min(hi, Math.max(lo, Math.round((state.prices[f] + delta) * 2) / 2))
    syncSignPrices()
  }
  refreshBuildingCard()
  persist()
}

// ---- Bina bilgi kartları ----

function buildingCard(id: string): BuildingCard | null {
  id = id.split('#')[0]
  const rate = state.genRate()
  if (id.startsWith('pump-')) {
    const i = Number(id.slice(5))
    const broken = state.brokenPumps.has(i)
    return {
      icon: 'i-fuel', name: `Pompa #${i + 1}`,
      desc: 'Benzin ve dizel dolumu. Müşterinin istediği yakıtı ve tutarı sen girersin — yanlış tabanca cezalıdır.',
      stats: [
        ['Durum', broken ? 'ARIZALI' : 'Çalışıyor', broken ? 'bad' : 'good'],
        ['Dolum hızı', `${FILL_RATE} L/sn`],
        ['Benzin', `₺${FUEL_PRICE.benzin}/L`],
        ['Dizel', `₺${FUEL_PRICE.dizel}/L`],
      ],
      action: broken ? { label: '🔧 Tamir Et — ₺800', maintId: `fix-pump-${i}` } : undefined,
    }
  }
  if (id.startsWith('charger-')) {
    const i = Number(id.slice(8))
    const broken = state.brokenChargers.has(i)
    return {
      icon: 'i-charger', name: `DC Şarj #${i + 1}`,
      desc: 'Elektrikli araçlar batarya deposundan anında şarj olur. Depoda yeterli kWh yoksa müşteri bekler.',
      stats: [
        ['Durum', broken ? 'ARIZALI' : 'Çalışıyor', broken ? 'bad' : 'good'],
        ['Şarj süresi', 'Anında'],
        ['Satış', `₺${state.elecPrice}/kWh`],
      ],
      action: broken
        ? { label: '🔧 Tamir Et — ₺1.000', maintId: `fix-charger-${i}` }
        : { label: `Otomatik Şarj: ${state.autoChargers.has(i) ? 'AÇIK' : 'KAPALI'} — değiştir`, maintId: `auto-charger-${i}` },
    }
  }
  switch (id) {
    case 'office': {
      const fx = Math.round((state.priceDemandFactor() - 1) * 100)
      return {
        icon: 'i-office', name: 'Ofis — Fiyat Yönetimi',
        desc: 'Alış fiyatı sabittir; satış fiyatını sen belirlersin. Marjı açtıkça litre başı kazanç artar ama müşteri kaçar.',
        stats: [
          ['Müşteri etkisi', `${fx >= 0 ? '+' : ''}${fx}%`, fx >= 0 ? 'good' : 'bad'],
          ['İtibar', state.reputation.toFixed(1)],
          ['Toplam müşteri', `${state.stats.served}`, 'good'],
          ['Kaçan müşteri', `${state.stats.lost}`, state.stats.lost > state.stats.served / 4 ? 'bad' : ''],
          ['Benzin satışı', `${Math.round(state.stats.liters.benzin)} L`],
          ['Dizel satışı', `${Math.round(state.stats.liters.dizel)} L`],
          ['LPG satışı', `${Math.round(state.stats.liters.lpg)} L`],
          ['Elektrik satışı', `${Math.round(state.stats.kwh)} kWh`],
          ['Toplam ciro', `₺${Math.round(state.stats.revenue).toLocaleString('tr-TR')}`, 'good'],
        ],
        priceRows: [
          ...(['benzin', 'dizel', 'lpg'] as FuelType[]).map(f => {
            const [lo, hi] = priceBounds(f)
            return {
              f: f as FuelType | 'elec', label: FUEL_LABEL[f], price: state.prices[f], cost: FUEL_COST[f] as number | string,
              canDown: state.prices[f] > lo, canUp: state.prices[f] < hi,
            }
          }),
          {
            f: 'elec' as FuelType | 'elec', label: 'Elektrik (kWh)', price: state.elecPrice, cost: 'santralden',
            canDown: state.elecPrice > 4, canUp: state.elecPrice < 18,
          },
        ],
      }
    }
    case 'gatein':
      return {
        icon: 'i-move', name: 'Giriş Kapısı',
        desc: 'Müşteriler ve tankerler istasyona buradan girer. Taşı butonuyla yol kenarında istediğin yere al — trafik akışı kendini uyarlar.',
        stats: [['Konum', `y ${Math.round(world.gateIn.y)}`], ['Kural', 'Çıkışla arası en az 5 birim']],
      }
    case 'gateout':
      return {
        icon: 'i-move', name: 'Çıkış Kapısı',
        desc: 'Araçlar istasyondan buradan çıkıp yola karışır. Taşı butonuyla yerini belirle.',
        stats: [['Konum', `y ${Math.round(world.gateOut.y)}`], ['Kural', 'Girişle arası en az 5 birim']],
      }
    case 'tank':
      return {
        icon: 'i-tank', name: 'Yakıt Tankı',
        desc: 'Sattığın benzin ve dizel buradan çıkar. Bitirmeden tanker siparişi vermeyi unutma.',
        stats: [
          ['Benzin', `${Math.round(state.tanks.benzin)} / ${state.tankCapacity}L`, state.tanks.benzin < state.tankCapacity * 0.15 ? 'bad' : ''],
          ['Dizel', `${Math.round(state.tanks.dizel)} / ${state.tankCapacity}L`, state.tanks.dizel < state.tankCapacity * 0.15 ? 'bad' : ''],
          ['LPG', `${Math.round(state.tanks.lpg)} / ${state.tankCapacity}L`, state.tanks.lpg < state.tankCapacity * 0.15 ? 'bad' : ''],
          ['Kapasite seviyesi', `${state.tankLevel + 1}/4 (maks ${TANK_CAPACITY[3]}L)`],
        ],
      }
    case 'battery':
      return {
        icon: 'i-batt', name: 'Batarya Deposu',
        desc: 'Santrallerin ürettiği elektriği biriktirir. Elektrikli araçlar buradan anında şarj alır.',
        stats: [
          ['Dolu', `${Math.floor(state.battery)} / ${state.batteryCapacity} kWh`],
          ['Üretim', `+${state.genRate().toFixed(1)} kWh/sn (şebeke dahil)`, 'good'],
          ['Şebeke maliyeti', `₺${GRID_COST_PER_KWH}/kWh`, 'bad'],
          ['Araca akış', `${[0, 15, 25, 40][state.batteryLevel]} kWh/sn`],
          ['Üretim', `+${rate.toFixed(1)} kWh/sn`, rate > 0 ? 'good' : ''],
          ['Seviye', `${state.batteryLevel}/3`],
        ],
      }
    case 'market':
      return {
        icon: 'i-market', name: `Market Sv.${state.marketLevel}`,
        desc: 'Müşterilerin bir kısmı içeri girip alışveriş yapar — ekstra gelir ve memnuniyet.',
        stats: [
          ['Müşteri harcaması', `₺${25 * state.marketLevel}-${60 * state.marketLevel}`],
          ['Uğrama oranı', '~%35'],
        ],
      }
    case 'toilet':
      return {
        icon: 'i-toilet', name: `Tuvalet Sv.${state.toiletLevel}`,
        desc: 'Yol yorgunları için. Ücret koyarsan gelir gelir ama memnuniyet biraz düşer.',
        stats: [
          ['Moral etkisi', `+${Math.max(0, 0.15 * state.toiletLevel - (state.toiletFee > 0 ? 0.03 + state.toiletFee * 0.012 : 0)).toFixed(2)} puan`, 'good'],
          ['Kullanım ücreti', state.toiletFee === 0 ? 'Ücretsiz' : `₺${state.toiletFee}`, state.toiletFee > 0 ? 'good' : ''],
        ],
        action: { label: `Ücreti Değiştir (${state.toiletFee === 0 ? 'Ücretsiz' : '₺' + state.toiletFee} → ${state.toiletFee === 0 ? '₺5' : state.toiletFee === 5 ? '₺10' : 'Ücretsiz'})`, maintId: 'toilet-fee' },
      }
    case 'solar': {
      const net = 3 * (1 - 0.7 * state.solarDirt) * (state.gridLevel >= 2 ? 1.3 : 1)
      return {
        icon: 'i-solar', name: 'Güneş Santrali',
        desc: 'Bedava elektrik üretir ama paneller kirlendikçe verim düşer. Ara sıra temizlik yaptır.',
        stats: [
          ['Üretim', `+${net.toFixed(1)} kWh/sn`, net < 1 ? 'bad' : 'good'],
          ['Kirlilik', `%${Math.round(state.solarDirt * 100)}`, state.solarDirt > 0.6 ? 'bad' : ''],
        ],
        action: state.solarDirt >= 0.15 ? { label: '🧽 Temizle — ₺300', maintId: 'clean-solar' } : undefined,
      }
    }
    case 'dieselgen':
      return {
        icon: 'i-gen', name: 'Dizel Jeneratör',
        desc: 'Tanktan mazot yakarak elektrik üretir. Çalışırken gürültüsü şarjdaki müşterileri rahatsız eder.',
        stats: [
          ['Üretim', `+7 kWh/sn`],
          ['Yakıt tüketimi', '0.25 L/sn'],
          ['Durum', state.dieselRunning() ? 'ÇALIŞIYOR 🔊' : 'Beklemede', state.dieselRunning() ? 'bad' : 'good'],
        ],
      }
    case 'wash':
      return {
        icon: 'i-wash', name: 'Oto Yıkama',
        desc: 'Yakıt alan müşterilerin bir kısmı çıkışta aracını yıkatır.',
        stats: [
          ['Hizmet ücreti', '₺60-120'],
          ['Kullanım oranı', '~%25'],
        ],
      }
    case 'coffee':
      return {
        icon: 'i-coffee', name: 'Kahveci',
        desc: 'Park eden müşteriler kahve molası verir.',
        stats: [['Satış', '₺20-45'], ['Uğrama oranı', '~%30']],
      }
    case 'restaurant':
      return {
        icon: 'i-food', name: 'Restoran',
        desc: 'Uzun yol müşterisi park edip yemek yer — yüksek hesap öder.',
        stats: [['Hesap', '₺80-160'], ['Uğrama oranı', '~%18']],
      }
    case 'truckpark':
      return {
        icon: 'i-truck', name: 'Tır Parkı',
        desc: 'Tırcılar konaklar; sen hiçbir şey yapmadan düzenli gelir akar.',
        stats: [['Pasif gelir', '₺90-160 / ~45sn'], ['Trafik etkisi', '+%2']],
      }
    case 'airwater':
      return {
        icon: 'i-air', name: 'Hava-Su Ünitesi',
        desc: 'Lastik havası ve su. Küçük gelir ama müşteri çeker.',
        stats: [['Hizmet', '₺10-20'], ['Kullanım', '~%20']],
      }
    case 'selfwash':
      return {
        icon: 'i-selfwash', name: 'Self Yıkama',
        desc: 'Araçlar bölmelere girip kendileri yıkar; köpük ve su otomatik satılır.',
        stats: [['Pasif gelir', '₺30-60 / ~35sn'], ['Trafik etkisi', '+%2']],
      }
    case 'parking':
      return {
        icon: 'i-parking', name: 'Otopark',
        desc: 'Servisi biten müşteriler buraya park edip market, tuvalet, kahveci ve restoranı gezer.',
        stats: [['Kapasite', '4 araç'], ['Doluluk', `${cars.cars.filter(c => c.phase === 'parked' || c.phase === 'toPark').length}/4`]],
      }
    case 'oil':
      return {
        icon: 'i-oil', name: 'Yağ Değişimi',
        desc: 'Bakım vakti gelen araçlar burada yağ değiştirir — en kârlı yan hizmet.',
        stats: [
          ['Hizmet ücreti', '₺150-250'],
          ['Kullanım oranı', '~%12'],
        ],
      }
    case 'smr': {
      const risk = state.smrWear > 0.7 ? 'YÜKSEK ☠️' : state.smrWear > 0.5 ? 'Orta' : 'Düşük'
      const producing = state.uranium > 0
      let action: BuildingCard['action']
      if (state.smrWear >= 0.5) action = { label: '☢️ Bakım Yap — ₺1.500', maintId: 'maint-smr' }
      else if (!state.uraniumPending && state.uranium <= 60) action = { label: `🟢 Uranyum Sipariş Et — ₺${URANIUM_COST.toLocaleString('tr-TR')}`, maintId: 'order-uranium' }
      else if (state.smrWear >= 0.1) action = { label: '☢️ Bakım Yap — ₺1.500', maintId: 'maint-smr' }
      return {
        icon: 'i-reactor', name: 'Modüler Reaktör',
        desc: 'En güçlü enerji kaynağı. Uranyumla çalışır, yıprandıkça patlama riski artar — bakımı ASLA aksatma.',
        stats: [
          ['Üretim', producing ? `+${(15 * (state.gridLevel >= 2 ? 1.3 : 1)).toFixed(1)} kWh/sn` : 'DURDU (uranyum yok)', producing ? 'good' : 'bad'],
          ['Uranyum', state.uraniumPending ? `Yolda (${Math.ceil(state.uraniumEta)}sn)` : `%${Math.round(state.uranium)}`, state.uranium <= 20 && !state.uraniumPending ? 'bad' : ''],
          ['Yıpranma', `%${Math.round(state.smrWear * 100)}`, state.smrWear > 0.5 ? 'bad' : ''],
          ['Patlama riski', risk, state.smrWear > 0.7 ? 'bad' : state.smrWear > 0.5 ? '' : 'good'],
        ],
        action,
      }
    }
  }
  return null
}

function refreshBuildingCard() {
  if (!selectedBuilding) return
  const card = buildingCard(selectedBuilding)
  if (!card) return
  const facId = selectedBuilding.split('#')[0]
  if (['market', 'toilet', 'wash', 'oil', 'coffee', 'restaurant', 'truckpark', 'selfwash', 'airwater'].includes(facId)) {
    card.stats.push(['Bugünkü ciro', `₺${Math.round(state.facDaily[facId] ?? 0).toLocaleString('tr-TR')}`, 'good'])
  }
  // karttan doğrudan yükseltme: ilgili mağaza kalemi alınabilir durumdaysa buton koy
  const shopId = selectedBuilding.startsWith('pump-') ? 'pump'
    : selectedBuilding.startsWith('charger-') ? 'evcharger'
    : selectedBuilding
  const row = getShopItems(state).find(r => r.id === shopId)
  if (row && row.status === 'buy' && row.cost !== null) {
    card.buy = { label: `${row.title} — ₺${row.cost.toLocaleString('tr-TR')}`, id: shopId }
  }
  if (footprintOf(selectedBuilding)) {
    card.move = { label: 'Taşı (ücretsiz)', id: selectedBuilding }
  }
  ui.showBuildingCard(card)
}

// ---- Düzenleme modu: tıkla-taşı ----
let editMode = false
const editBtn = document.getElementById('editbtn') as HTMLButtonElement
editBtn.addEventListener('click', () => {
  editMode = !editMode
  editBtn.classList.toggle('danger', editMode)
  cancelPlacement()
  ui.toast(editMode
    ? 'Düzenleme modu AÇIK: taşımak istediğin binaya tıkla (pompa, şarj ve tank sabittir)'
    : 'Düzenleme modu kapandı.', '')
})

// ---- Girdi: sürükle-kaydır + tıkla-seç ----
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
let downX = 0, downY = 0, lastX = 0, lastY = 0, isDown = false, isDrag = false

let grabPoint: THREE.Vector3 | null = null

function groundPointAt(clientX: number, clientY: number): THREE.Vector3 | null {
  pointer.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1)
  raycaster.setFromCamera(pointer, camera)
  const pt = new THREE.Vector3()
  return raycaster.ray.intersectPlane(groundPlane, pt) ? pt : null
}

renderer.domElement.addEventListener('pointerdown', e => {
  // kamera kaydırma yalnızca sol tuşla; sağ tık sadece iptal işidir
  if (e.button !== 0) { isDown = false; return }
  isDown = true; isDrag = false
  downX = lastX = e.clientX
  downY = lastY = e.clientY
  grabPoint = groundPointAt(e.clientX, e.clientY)
})
window.addEventListener('pointermove', e => {
  // yerleştirme / arsa seçim hayaleti imleci takip eder
  if (placing || zoneMode) {
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    const pt = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(groundPlane, pt)) {
      if (placing) {
        if (placing.id === 'gatein' || placing.id === 'gateout') {
          // kapılar yol kenarı şeridine kilitli — sadece y seçilir
          placing.cx = 4.2
          placing.cy = Math.max(-24, Math.min(24, Math.round(pt.y)))
          placing.root.position.set(placing.cx, placing.cy, 0)
          const otherY = placing.id === 'gatein' ? world.gateOut.y : world.gateIn.y
          placing.valid = Math.abs(placing.cy - otherY) >= 5
          placing.planeMat.color.setHex(placing.valid ? 0x37c97e : 0xec5b5b)
          placing.planeMat.opacity = placing.valid ? 0.22 : 0.34
          return
        }
        placing.cx = Math.round(pt.x)
        placing.cy = Math.round(pt.y)
        placing.root.position.set(placing.cx, placing.cy, 0)
        const odd = placing.rot % 2 === 1
        const eff = { cx: placing.cx, cy: placing.cy, w: odd ? placing.d : placing.w, d: odd ? placing.w : placing.d }
        placing.valid = isValidPlacement(eff, placing.id, placing.grass)
        placing.planeMat.color.setHex(placing.valid ? 0x37c97e : 0xec5b5b)
        placing.planeMat.opacity = placing.valid ? 0.22 : 0.34
      } else if (zoneMode) {
        const pc = parcelAt(pt.x, pt.y)
        if (pc) {
          const [c, r] = pc
          zoneMode.c = c; zoneMode.r = r
          const [x0, x1] = PARCEL_COLS[c]
          const [y0, y1] = PARCEL_ROWS[r]
          zoneMode.ghost.scale.set(x1 - x0 - 0.3, y1 - y0 - 0.3, 1)
          zoneMode.ghost.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0.06)
          zoneMode.valid = zoneMode.kind === 'land'
            ? !state.owns(c, r) && state.parcelAdjacentToOwned(c, r) && state.money >= parcelCost(c, r, state)
            : state.owns(c, r) && !state.isPaved(c, r) && state.money >= PAVE_COST
          ;(zoneMode.ghost.material as THREE.MeshBasicMaterial).color.setHex(zoneMode.valid ? 0x37c97e : 0xec5b5b)
        }
      }
    }
  }
  if (!isDown) return
  // sol tuş bırakılmış ama pointerup kaçmışsa (ör. sağ tık menüsü araya girdi) sürüklemeyi kes
  if ((e.buttons & 1) === 0) { isDown = false; isDrag = false; grabPoint = null; return }
  lastX = e.clientX; lastY = e.clientY
  if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 8) isDrag = true
  if (isDrag && grabPoint) {
    // kavrama: bastığın zemin noktası imlecin altında kalsın
    const cur = groundPointAt(e.clientX, e.clientY)
    if (cur) {
      camX = Math.max(-34, Math.min(50, camX + grabPoint.x - cur.x))
      camY = Math.max(-26, Math.min(26, camY + grabPoint.y - cur.y))
      updateCamera()
    }
  }
})
window.addEventListener('pointerup', e => {
  if (!isDown) return
  isDown = false
  if (isDrag || e.target !== renderer.domElement) return
  if (placing) {
    if (e.button === 0) {
      if (placing.valid) confirmPlacement()
      else ui.toast('🚫 Buraya yerleştiremezsin — sahipli ve betonlu alana koy.', 'bad')
    }
    return
  }
  if (zoneMode) {
    if (e.button === 0) {
      if (zoneMode.valid) confirmZone()
      else if (zoneMode.kind === 'land') {
        const { c, r } = zoneMode
        const cost = parcelCost(c, r, state)
        ui.toast(c < 0 ? 'Bir parsele tıkla.'
          : state.owns(c, r) ? 'Bu arsa zaten senin.'
          : !state.parcelAdjacentToOwned(c, r) ? 'Bitişik değil — önce aradaki arsayı almalısın.'
          : `Para yetmiyor: bu arsa ₺${cost.toLocaleString('tr-TR')}, kasada ₺${Math.floor(state.money).toLocaleString('tr-TR')} var.`, 'bad')
      } else {
        const { c, r } = zoneMode
        ui.toast(c < 0 ? 'Bir parsele tıkla.'
          : !state.owns(c, r) ? 'Bu arsa senin değil — önce satın al.'
          : state.isPaved(c, r) ? 'Bu arsa zaten betonlu.'
          : `Para yetmiyor: beton ₺${PAVE_COST.toLocaleString('tr-TR')}.`, 'bad')
      }
    }
    return
  }
  handleClick(e)
})

function handleClick(e: PointerEvent) {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1)
  raycaster.setFromCamera(pointer, camera)

  // 1) pompadaki araçlar
  const carGroups = cars.cars.filter(c => c.phase === 'atPump').map(c => c.group)
  const carHits = raycaster.intersectObjects(carGroups, true)
  if (carHits.length > 0) {
    let obj: THREE.Object3D | null = carHits[0].object
    while (obj && !obj.userData.car) obj = obj.parent
    if (obj?.userData.car) ui.selectCar(obj.userData.car as Car)
    return
  }

  // 2) binalar (uyarı pill'i → direkt tamir; bina → bilgi kartı)
  const hits = raycaster.intersectObjects(world.buildings.map(b => b.group), true)
  if (hits.length > 0) {
    const cashFor = hits.find(h => h.object.userData.cashFor)?.object.userData.cashFor
    if (cashFor) {
      const amt = state.collectPending(cashFor)
      if (amt > 0) {
        audio.cash()
        ui.toast(`+₺${amt} toplandı!`, 'good', true)
        persist()
      }
      return
    }
    let obj: THREE.Object3D | null = hits[0].object
    while (obj && !obj.userData.buildingId) obj = obj.parent
    if (obj?.userData.buildingId) {
      const bid = obj.userData.buildingId as string
      if (editMode && footprintOf(bid)) {
        startPlacement(bid, true) // düzenleme: direkt taşıma
        return
      }
      selectedBuilding = bid
      world.setSelected(selectedBuilding)
      refreshBuildingCard()
      return
    }
  }

  // 3) boşluğa tıklama → seçimi kapat
  selectedBuilding = null
  world.setSelected(null)
  ui.hideBuildingCard()
}

// ---- Oyun döngüsü ----
const clock = new THREE.Clock()
// vitrin: ?night=1 gece ortasından başlatır (tanıtım çekimi / ekran görüntüsü)
let dayTime = new URLSearchParams(location.search).has('night') ? 100 : 0
let prevCycleT = 0
let achieveT = 2
let saveT = 5
const DAY_CYCLE = 160 // saniye: ~90sn gündüz, ~40sn gece

function nightFactor(t: number): number {
  if (t < 0.55) return 0
  if (t < 0.65) return (t - 0.55) / 0.1
  if (t < 0.9) return 1
  return 1 - (t - 0.9) / 0.1
}

function frame() {
  requestAnimationFrame(frame)
  const dt = Math.min(clock.getDelta(), 0.05)
  promoTick?.(dt)
  if (exploding) { composer!.render(); return }

  dayTime += dt
  world.setNight(nightFactor((dayTime % DAY_CYCLE) / DAY_CYCLE))

  state.tick(dt)
  cars.update(dt)

  for (const msg of state.events.splice(0)) {
    if (msg.includes('Başarım')) {
      ui.toast(msg, 'good', true)
      audio.achieve()
    } else {
      ui.toast(msg, 'bad')
      if (msg.includes('KRİTİK') || msg.includes('doldu')) notifyIfHidden(msg)
    }
  }

  if (state.exploded) {
    exploding = true
    if (auth.loggedIn()) auth.pushSave(null).catch(() => {}) // her şey sıfırlanır (SQL'de)
    audio.boom()
    ui.showBoom()
    setTimeout(() => location.reload(), 3500)
    return
  }

  // gün dönümü: günlük kâr raporu
  const cycleT = (dayTime % DAY_CYCLE) / DAY_CYCLE
  if (cycleT < prevCycleT) {
    state.day++
    const profit = Math.round(state.money - state.dayStartMoney)
    ui.toast(`📅 Gün ${state.day - 1} bitti — ${profit >= 0 ? 'kâr' : 'zarar'}: ₺${Math.abs(profit).toLocaleString('tr-TR')}`, profit >= 0 ? 'good' : 'bad')
    state.dayStartMoney = state.money
    state.facDaily = {}
    persist()
  }
  prevCycleT = cycleT

  // başarımlar + otomatik kayıt
  achieveT -= dt
  if (achieveT <= 0) {
    achieveT = 2
    checkAchievements(state)
  }
  saveT -= dt
  if (saveT <= 0) {
    saveT = 5
    persist()
  }

  // bina uyarı etiketleri
  const warns = new Map<string, { text: string; maintId: string }>()
  state.brokenPumps.forEach(i => warns.set(`pump-${i}`, { text: '🔧 ARIZA · TAMİR ₺800', maintId: `fix-pump-${i}` }))
  state.brokenChargers.forEach(i => warns.set(`charger-${i}`, { text: '🔧 ARIZA · TAMİR ₺1.000', maintId: `fix-charger-${i}` }))
  if (state.hasSolar && state.solarDirt >= 0.6) warns.set('solar', { text: '🧽 TEMİZLİK ₺300', maintId: 'clean-solar' })
  if (state.hasSMR && state.smrWear >= 0.5) {
    warns.set('smr', { text: state.smrWear > 0.75 ? '🚨 BAKIM ŞART ₺1.500' : '☢️ BAKIM ₺1.500', maintId: 'maint-smr' })
  } else if (state.hasSMR && state.uranium <= 15 && !state.uraniumPending) {
    warns.set('smr', {
      text: state.uranium === 0 ? '🚨 URANYUM BİTTİ · ₺2.500' : '🟢 URANYUM AZ · ₺2.500',
      maintId: 'order-uranium',
    })
  }
  world.syncWarnings(warns)
  const cashMap = new Map<string, number>()
  for (const [id, amt] of Object.entries(state.pendingCash)) if (amt >= 1) cashMap.set(id, amt)
  world.syncCash(cashMap)

  // seçili bina kartını canlı tut
  if (selectedBuilding && ui.buildingCardVisible) {
    cardRefreshT -= dt
    if (cardRefreshT <= 0) {
      refreshBuildingCard()
      cardRefreshT = 0.5
    }
  }

  // jeneratör gürültüsü EV sabrını tüketir
  if (state.dieselRunning()) {
    for (const c of cars.cars) {
      if (c.kind === 'ev' && !c.charging && (c.phase === 'atPump' || c.phase === 'waiting')) c.patience -= dt * 1.2
    }
  }

  for (const f of FUELS) {
    if (state.orders[f].arrived) {
      state.orders[f].arrived = false
      const used = new Set(tankers.map(x => x.slot))
      let slot = 0
      while (used.has(slot)) slot++
      tankers.push({ t: new Tanker(world.scene, modelLib, f, slot, new THREE.Vector3(world.tankAnchor.x, world.tankAnchor.y, 0)), fuel: f, slot })
    }
  }
  const blockedFor = (self: Tanker) => (pos: THREE.Vector3, dir: THREE.Vector3) => {
    const check = (p: THREE.Vector3, maxF: number, maxL: number) => {
      const rel = new THREE.Vector3().subVectors(p, pos)
      rel.z = 0
      const forward = rel.dot(dir)
      if (forward < 0.5 || forward > maxF) return false
      return rel.addScaledVector(dir, -forward).length() < maxL
    }
    for (const c of cars.cars) {
      if (c.phase !== 'gone' && check(c.group.position, 3.8, 1.6)) return true
    }
    // tanker de şeride çıkarken yaklaşan trafiğe yol verir
    if (pos.x > 3.8 && pos.x < 6.7 && dir.x > 0.3) {
      for (const c of cars.cars) {
        if (c.phase === 'transit' && c.lane === 'near'
          && c.group.position.y > pos.y - 12 && c.group.position.y < pos.y + 2) return true
      }
    }
    // tankerler birbirinin içinden GEÇMEZ: öndeki tanker varsa kuyrukta bekle
    for (const x of tankers) {
      if (x.t !== self && check(x.t.group.position, 5.2, 2.0)) return true
    }
    return false
  }
  for (let i = tankers.length - 1; i >= 0; i--) {
    const { t, fuel } = tankers[i]
    if (t.update(dt, blockedFor(t))) {
      state.deliverFuel(fuel)
      ui.toast(`${FUEL_LABEL[fuel]} tankı dolduruldu!`, 'good')
    }
    if (t.done) {
      world.scene.remove(t.group)
      tankers.splice(i, 1)
    }
  }

  // pompalar bağımsız: dolumdaki HER araç aynı anda ilerler
  for (const c of [...cars.cars]) {
    // tabanca seçildiyse işlem başladı demektir: sabır donar, müşteri beklemeden gitmez
    if (c.phase === 'atPump' && c.kind === 'fuel') c.beingServed = c.filling || !!c.nozzle
    if (!(c.filling && c.kind === 'fuel' && c.phase === 'atPump' && c.nozzle && !c.wrongFuelHandled)) continue
    if (state.tanks[c.nozzle] <= 0) {
      ui.toast(`${FUEL_LABEL[c.nozzle]} tankı boş kaldı! Satış yarım kaldı — sipariş ver.`, 'bad')
      finishSale(c)
      continue
    }
    const amount = Math.min(FILL_RATE * dt, state.tanks[c.nozzle])
    c.filled += amount
    state.tanks[c.nozzle] -= amount
    c.setCounter(`${c.filled.toFixed(1)}L · ₺${c.filledValue.toFixed(0)}`)
    if (c.nozzle !== c.demandType && c.filled > 1.5) {
      wrongFuel(c)
    } else if (c.fullMode ? c.filled >= c.hiddenNeedL : c.filledValue >= c.targetAmount) {
      if (c.fullMode) {
        c.demandAmount = Math.round(c.filledValue * 100) / 100
        c.demandLiters = c.filled
      }
      finishSale(c)
    }
  }

  // park etmiş araçların yayaları
  for (const [c, data] of pendingVisits) {
    if (c.phase === 'parked' && !data.started) {
      data.started = true
      spawnWalkerFor(c, data)
    }
  }
  updateWalkers(dt)

  world.update(dt)
  audio.setDiesel(state.dieselRunning() && !state.closed)
  audio.setPump(cars.cars.some(c => c.filling && c.phase === 'atPump' && !c.wrongFuelHandled))
  Car.solids = hardRects()
  evTurnAwayT = Math.max(0, evTurnAwayT - dt)
  // otomatik şarj: işaretli ünitelere yanaşan EV kendiliğinden başlar
  for (const c of cars.cars) {
    if (c.kind === 'ev' && c.phase === 'atPump' && !c.charging && !c.squatting
      && c.chargedKwh === 0 && c.slotIndex >= 0 && state.autoChargers.has(c.slotIndex)) {
      startCharging(c, true)
    }
  }
  tickEvCharging(dt)
  syncHoses()
  updateCamera()
  ui.update(state, dt)
  composer!.render()
}
frame()


// 🎬 REKLAM MODU (?promo=1): oyun kendi reklamını oynar — tek pompadan nükleer çağa.
if (isPromoMode) {
  state.money = 9000
  const fastAd = new URLSearchParams(location.search).has('fast')
  const T = fastAd ? 0.62 : 1
  const cap = document.createElement('div')
  cap.id = 'promocap'
  cap.style.cssText =
    'position:fixed;left:50%;transform:translateX(-50%);bottom:10%;z-index:60;max-width:94vw;' +
    "font-family:'Baloo 2',sans-serif;font-weight:800;color:#fff;text-align:center;" +
    'background:rgba(28,37,48,.9);padding:16px 30px;border-radius:22px;' +
    'border-bottom:5px solid #d64545;box-shadow:0 12px 34px rgba(0,0,0,.45);' +
    'font-size:min(6.6vw,80px);line-height:1.12;opacity:0;transition:opacity .4s;pointer-events:none'
  cap.style.transition = 'opacity .4s, transform .4s cubic-bezier(.34,1.56,.64,1)'
  cap.style.transform = 'translateX(-50%) scale(.9)'
  document.body.appendChild(cap)
  // geçiş flaşı: her beat'te yumuşak beyaz parlama
  const flash = document.createElement('div')
  flash.style.cssText = 'position:fixed;inset:0;background:#fff;opacity:0;z-index:55;' +
    'pointer-events:none;transition:opacity .12s'
  document.body.appendChild(flash)
  const say = (t: string) => {
    flash.style.opacity = '0.75'
    setTimeout(() => { flash.style.transition = 'opacity .55s'; flash.style.opacity = '0' }, 130)
    setTimeout(() => { flash.style.transition = 'opacity .12s' }, 750)
    cap.style.opacity = '0'
    cap.style.transform = 'translateX(-50%) scale(.9)'
    setTimeout(() => {
      cap.innerHTML = t
      cap.style.opacity = '1'
      cap.style.transform = 'translateX(-50%) scale(1)'
    }, 430)
  }
  const buy = (id: string) => {
    if (!buyItem(state, id)) { state.money += 500_000; buyItem(state, id) }
    buildVisual(id)
    try { audio.build() } catch { /* ses yoksa sessiz geç */ }
  }
  const beats: [number, () => void][] = [
    [1.0, () => say('KENDİ BENZİNLİĞİNİ KUR')],
    [6.0, () => say('YAKIT SATMAYA BAŞLA')],
    [13, () => { say('BÜYÜ VE GELİŞ'); buy('pump') }],
    [15, () => buy('pump')],
    [17, () => { buy('pump'); buy('sign') }],
    [19, () => { buy('sign'); buy('tank') }],
    [21.5, () => { say('MARKETİNİ AÇ, MÜŞTERİYİ TUT'); buy('market'); buy('toilet') }],
    [24, () => { buy('wash'); buy('coffee') }],
    [26.5, () => buy('market')],
    [29, () => { say('ELEKTRİĞE GEÇ'); buy('grid'); buy('battery') }],
    [31.5, () => { buy('evcharger'); buy('evcharger') }],
    [34, () => { buy('grid'); buy('evcharger') }],
    [37, () => { say('GÜNEŞ PANELLERİNİ KUR'); buy('solar') }],
    [40, () => { buy('airwater'); buy('selfwash') }],
    [43, () => { say('NÜKLEER ÇAĞA ADIM AT'); buy('smr') }],
    [49, () => say('KENDİ PETROL İSTASYONUNU İŞLET')],
    [55, () => say('<span style="color:#ffd24d">ŞİMDİ OYNA</span>')],
  ]
  let bi = 0
  let pt = 0
  promoTick = dt => {
    pt += dt
    while (bi < beats.length && pt >= beats[bi][0] * T) { beats[bi][1](); bi++ }
    // kasa reklam boyunca dolar — büyüme hissi
    state.money += dt * (1800 + pt * 160)
    // kamera: yakın plandan geniş plana süzülür
    camera.zoom = 1.85 - Math.min(1, pt / (46 * T)) * 1.02
    camera.updateProjectionMatrix()
    // müşteriler reklamda kendiliğinden karşılanır
    for (const c of cars.cars) {
      if (c.phase !== 'atPump') continue
      if (c.kind === 'fuel' && !c.filling && c.filled === 0 && !c.wrongFuelHandled) {
        c.nozzle = c.demandType
        c.fullMode = true
        c.filling = true
        c.beingServed = true
      } else if (c.kind === 'ev' && !c.charging && c.chargedKwh === 0 && !c.squatting) {
        startCharging(c, true)
      }
    }
  }
}
