import * as THREE from 'three'
import { World, PUMP_SLOTS_POS, EV_SLOTS_POS } from './world'
import { Car, CarManager, Tanker } from './cars'
import { UI, BuildingCard } from './ui'
import {
  FuelType, FUELS, FUEL_LABEL, FUEL_PRICE, GameState, FILL_RATE, SPILL_PENALTY_PER_L, WRONG_FUEL_PENALTY,
  EV_PRICE_PER_KWH, TANK_CAPACITY, URANIUM_COST, PARCEL_COLS, PARCEL_ROWS, PAVE_COST,
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
const ui = new UI()
ui.batteryKwh = () => state.battery
const tankers: { t: Tanker; fuel: FuelType }[] = []
let exploding = false
let selectedBuilding: string | null = null
let cardRefreshT = 0

composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(world.scene, camera))
composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.35, 0.5, 0.85)) // yarı çözünürlük bloom: gözle fark yok, kat kat hızlı
composer.addPass(new OutputPass())
composer.setSize(window.innerWidth, window.innerHeight)

const cars = new CarManager(world.scene, modelLib, {
  pumpCount: () => state.pumps,
  evCount: () => state.evChargers,
  entryChance: () => state.entryChance(),
  evShare: () => (state.evChargers > 0 ? Math.min(0.5, 0.15 + 0.09 * state.evChargers) : 0),
  isPumpBroken: i => state.brokenPumps.has(i),
  isChargerBroken: i => state.brokenChargers.has(i),
  parkSpots: () => world.getParkingSpots(),
  onCarReady: car => { if (!ui.activeCar) ui.selectCar(car) },
  onCarLost: car => {
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
  const y = car.slotIndex >= 0 ? PUMP_SLOTS_POS[car.slotIndex].y : car.group.position.y
  const start = new THREE.Vector3(0.3, y + 0.3, 1.3)
  const mid = new THREE.Vector3(0.85, y - 0.05, 0.5)
  const end = new THREE.Vector3(1.22, y - 0.35, 0.62)
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
    v.push({ buildingId: 'toilet', revenue: () => 0, toastMsg: () => '', score: 0.15 * state.toiletLevel })
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
    state.money += m; d += 0.25
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

function spawnWalkerFor(car: Car, data: { visits: Visit[]; score: number }) {
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
        if (m > 0) { state.money += m; ui.toast(v.toastMsg(m), 'good') }
        score += v.score
      }
      state.addRep((score - 3.3) * 0.08)
      car.showFeedback(emojiFor(score))
      cars.releaseCar(car)
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
      if (m > 0) { state.money += m; ui.toast(v.toastMsg(m), 'good') }
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

  if (spill > 0.3) {
    const penalty = Math.round(spill * SPILL_PENALTY_PER_L)
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
  if (car.phase !== 'atPump' || car.filling || car.filled > 0) return
  state.addRep(-0.1)
  car.showFeedback('😐')
  ui.toast('Müşteri kibarca gönderildi.', '')
  cars.releaseCar(car)
  if (ui.activeCar === car) ui.selectCar(nextServableCar())
}

ui.onChargeEV = car => {
  if (car.phase !== 'atPump' || state.battery < car.demandKwh) return
  let kwh = car.demandKwh
  let score = 4.5
  if (car.patienceFrac < 0.4) score -= 1.5
  if (state.dieselRunning() && Math.random() < 0.35) {
    kwh = Math.ceil(kwh / 2)
    score = 2.5
    ui.toast('🔊 Jeneratör gürültüsünden rahatsız oldu, yarım şarjla gitti!', 'bad')
  }
  state.battery -= kwh
  const revenue = kwh * EV_PRICE_PER_KWH
  state.money += revenue
  ui.toast(`⚡ ${kwh} kWh şarj: +₺${revenue}`, 'good')
  concludeService(car, score)
}

// ---- Sipariş, inşaat, bakım ----

ui.onOrderFuel = f => {
  if (state.placeOrder(f)) ui.toast(`${FUEL_LABEL[f]} tankeri yola çıktı!`, 'good')
}

/** satın alma sonrası sahnedeki görsel karşılığını kurar */
function buildVisual(id: string, pos?: THREE.Vector2) {
  switch (id) {
    case 'pump': world.addPump(state.pumps - 1); break
    case 'sign': world.setSign(state.signLevel); break
    case 'tank': world.upgradeTankVisual(state.tankLevel); break
    case 'market': world.buildMarket(state.marketLevel, pos); break
    case 'toilet': world.buildToilet(state.toiletLevel, pos); break
    case 'battery': world.buildBattery(state.batteryLevel, pos); break
    case 'evcharger': world.addEvCharger(state.evChargers - 1); break
    case 'solar': world.buildSolar(state.landSouth ? 'south' : 'north', pos); break
    case 'dieselgen': world.buildDiesel(pos); break
    case 'smr': world.buildSMR(state.landNorth ? 'north' : 'south', pos); break
    case 'wash': world.buildWash(pos); break
    case 'oil': world.buildOil(pos); break
    case 'coffee': world.buildCoffee(pos); break
    case 'restaurant': world.buildRestaurant(pos); break
    case 'truckpark': world.buildTruckPark(pos); break
    case 'airwater': world.buildAirWater(pos); break
    case 'selfwash': world.buildSelfWash(pos); break
    case 'parking': world.buildParking(pos); break
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
}

interface Rect { cx: number; cy: number; w: number; d: number }
const placedRects: (Rect & { id: string })[] = []
const placedPos: Record<string, [number, number]> = {}
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)

// ---- Kayıt sistemi ----
const SAVE_KEY = 'benzinlik-save-v1'

let lastRemotePush = 0

function savePayload() {
  return { s: serializeState(state), placedPos, placedRot, placedRects, at: Date.now() }
}

function persist() {
  if (isFullMode) return
  const payload = savePayload()
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload))
  } catch { /* depolama dolu vs. */ }
  // giriş yapıldıysa buluta da it (10 sn'de bir)
  if (auth.loggedIn() && Date.now() - lastRemotePush > 10_000) {
    lastRemotePush = Date.now()
    auth.pushSave(payload).catch(() => {})
  }
}

let loadedSaveAt = 0

function applySaveData(d: Record<string, unknown>) {
  loadedSaveAt = Number(d.at ?? 0)
  hydrateState(state, (d.s ?? {}) as Record<string, unknown>)
  Object.assign(placedPos, (d.placedPos ?? {}) as Record<string, [number, number]>)
  Object.assign(placedRot, (d.placedRot ?? {}) as Record<string, number>)
  if (Array.isArray(d.placedRects)) placedRects.push(...(d.placedRects as (Rect & { id: string })[]))
}

function loadSave(): boolean {
  const raw = localStorage.getItem(SAVE_KEY)
  if (!raw) return false
  try {
    applySaveData(JSON.parse(raw))
    return true
  } catch {
    return false
  }
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
  for (let i = 1; i < state.pumps; i++) world.addPump(i)
  for (let i = 0; i < state.evChargers; i++) world.addEvCharger(i)
  world.setSign(state.signLevel)
  for (let l = 1; l <= state.tankLevel; l++) world.upgradeTankVisual(l)
  const pv = (id: string) => (placedPos[id] ? new THREE.Vector2(placedPos[id][0], placedPos[id][1]) : undefined)
  if (state.marketLevel > 0) world.buildMarket(state.marketLevel, pv('market'))
  if (state.toiletLevel > 0) world.buildToilet(state.toiletLevel, pv('toilet'))
  if (state.batteryLevel > 0) world.buildBattery(state.batteryLevel, pv('battery'))
  if (state.hasSolar) world.buildSolar(state.landSouth ? 'south' : 'north', pv('solar'))
  if (state.hasDiesel) world.buildDiesel(pv('dieselgen'))
  if (state.hasSMR) world.buildSMR(state.landNorth ? 'north' : 'south', pv('smr'))
  if (state.hasWash) world.buildWash(pv('wash'))
  if (state.hasOil) world.buildOil(pv('oil'))
  if (state.hasCoffee) world.buildCoffee(pv('coffee'))
  if (state.hasRestaurant) world.buildRestaurant(pv('restaurant'))
  if (state.hasTruckPark) world.buildTruckPark(pv('truckpark'))
  if (state.hasAirWater) world.buildAirWater(pv('airwater'))
  if (state.hasSelfWash) world.buildSelfWash(pv('selfwash'))
  if (state.hasParking) world.buildParking(pv('parking'))
  for (const [id, rot] of Object.entries(placedRot)) world.rotateBuilding(id, rot)
  world.setClosed(state.closed)
}

function fixedObstacles(): Rect[] {
  const r: Rect[] = [
    { cx: 4.2, cy: 0, w: 2.6, d: 48 },       // servis şeridi (araç yolu)
    { cx: -4.55, cy: -5.4, w: 5.0, d: 6.2 }, // yakıt tankları
    { cx: -5.0, cy: 4.5, w: 4.6, d: 5.0 },   // ofis
    { cx: 4.0, cy: -11.5, w: 2.4, d: 3.4 },  // tabela
  ]
  for (let i = 0; i < state.pumps; i++) r.push({ cx: 0.9, cy: PUMP_SLOTS_POS[i].y, w: 4.4, d: 4.0 })
  for (let i = 0; i < state.evChargers; i++) r.push({ cx: 1.2, cy: EV_SLOTS_POS[i].y, w: 4.0, d: 2.6 })
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
  if (id === 'pump') {
    const i = Math.min(state.pumps, 3)
    world.addPump(i)
    const g = world.detachPreview(`pump-${i}`)
    if (g) world.scene.remove(g)
    return g
  }
  if (id === 'evcharger') {
    const i = Math.min(state.evChargers, 3)
    world.addEvCharger(i)
    const g = world.detachPreview(`charger-${i}`)
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
    thumbRenderer.setSize(240, 180)
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
  const r = Math.max(size.x, size.y, size.z) * 0.6 + 0.5
  const cam = new THREE.OrthographicCamera(-r * 1.33, r * 1.33, r, -r, 0.1, 200)
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
  for (const o of fixedObstacles()) if (overlaps(p, o)) return false
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

function startPlacement(id: string, move = false) {
  cancelPlacement()
  const f = PLACEABLE[id](move)
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

function confirmPlacement() {
  const p = placing!
  if (p.move) {
    world.removeBuildingGroup(p.id)
    buildVisual(p.id, new THREE.Vector2(p.cx, p.cy))
    ui.toast('Taşındı!', 'good')
  } else {
    if (!buyItem(state, p.id)) {
      ui.toast('💸 Para yetmiyor!', 'bad')
      cancelPlacement()
      return
    }
    buildVisual(p.id, new THREE.Vector2(p.cx, p.cy))
    buyToast(p.id)
  }
  world.rotateBuilding(p.id, p.rot)
  placedPos[p.id] = [p.cx, p.cy]
  placedRot[p.id] = p.rot
  const i = placedRects.findIndex(r => r.id === p.id)
  if (i >= 0) placedRects.splice(i, 1)
  const odd = p.rot % 2 === 1
  placedRects.push({ id: p.id, cx: p.cx, cy: p.cy, w: odd ? p.d : p.w, d: odd ? p.w : p.d })
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
    placing.rot = (placing.rot + 1) % 4
    placing.root.rotation.z = placing.rot * Math.PI / 2
  }
})
renderer.domElement.addEventListener('contextmenu', e => { e.preventDefault(); cancelPlacement() })

ui.onBuy = id => {
  audio.click()
  if (id === 'land' || id === 'pave') {
    startZoneMode(id)
    return
  }
  const needsPlacement = id in PLACEABLE && !(id === 'battery' && state.batteryLevel > 0)
  if (needsPlacement) {
    const item = getShopItems(state).find(r => r.id === id)
    if (!item || item.status !== 'buy' || state.money < (item.cost ?? Infinity)) return
    startPlacement(id)
    return
  }
  if (!buyItem(state, id)) return
  buildVisual(id)
  buyToast(id)
  persist()
}

ui.onMove = id => {
  if (!(id in PLACEABLE)) return
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
    case 'evcharger': ui.toast('🔌 DC şarj ünitesi kuruldu!', 'good'); break
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
if (!isFullMode && auth.loggedIn()) {
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
if (!saveLoaded && !isFullMode && loadSave()) {
  saveLoaded = true
  ui.toast(`Kayıt yüklendi — Gün ${state.day}, hoş geldin!`, 'good', true)
}
if (saveLoaded) rebuildFromState()
ui.syncAccount(auth.currentEmail())

// ---- Zorunlu giriş kapısı: hesap yoksa oyun oynanmaz ----
async function doLogin(email: string, pass: string) {
  await auth.login(email, pass)
  const remote = await auth.pullSave().catch(() => null)
  if (!remote) await auth.pushSave(savePayload()).catch(() => {})
  location.reload()
}
async function doRegister(email: string, pass: string) {
  await auth.register(email, pass)
  await auth.pushSave(savePayload()).catch(() => {})
  location.reload()
}

const gateEl = document.getElementById('authgate') as HTMLDivElement
if (!isFullMode && !auth.loggedIn()) {
  gateEl.style.display = 'flex'
  const gErr = document.getElementById('agerr') as HTMLDivElement
  const gEmail = document.getElementById('gemail') as HTMLInputElement
  const gPass = document.getElementById('gpass') as HTMLInputElement
  const wire = (id: string, fn: (e: string, p: string) => Promise<void>) => {
    (document.getElementById(id) as HTMLButtonElement).addEventListener('click', async () => {
      gErr.textContent = ''
      try { await fn(gEmail.value, gPass.value) } catch (err) { gErr.textContent = (err as Error).message }
    })
  }
  wire('glogin', doLogin)
  wire('gregister', doRegister)
  gPass.addEventListener('keydown', e => {
    if (e.key === 'Enter') (document.getElementById('glogin') as HTMLButtonElement).click()
  })
} else {
  gateEl.remove()

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
    const remote = await auth.pullSave().catch(() => null)
    if (!remote) await auth.pushSave(savePayload()).catch(() => {})
    location.reload()
  } catch (err) {
    ui.toast((err as Error).message, 'bad')
  }
}
ui.onRegister = async (email, pass) => {
  try {
    await auth.register(email, pass)
    await auth.pushSave(savePayload()).catch(() => {})
    ui.toast('Hesap oluşturuldu — kaydın artık bulutta!', 'good')
    ui.syncAccount(auth.currentEmail())
  } catch (err) {
    ui.toast((err as Error).message, 'bad')
  }
}
ui.onLogout = () => {
  auth.logout()
  ui.syncAccount(null)
  ui.toast('Çıkış yapıldı — misafir modundasın.', '')
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

ui.onReset = () => {
  localStorage.removeItem(SAVE_KEY)
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
  localStorage.setItem('benzinlik-station-name', world.stationName)
  nameInput.value = world.stationName
  document.title = `${world.stationName} — Benzinlik`
  if (!silent) ui.toast(`🪧 Tabela güncellendi: ${world.stationName}`, 'good')
}

const savedName = localStorage.getItem('benzinlik-station-name')
applyStationName(!savedName || savedName === 'OPET' ? 'BENZİNLİK' : savedName, true)
ui.onRename = name => applyStationName(name)

// ---- Bina bilgi kartları ----

function buildingCard(id: string): BuildingCard | null {
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
        ['Satış', `₺${EV_PRICE_PER_KWH}/kWh`],
      ],
      action: broken ? { label: '🔧 Tamir Et — ₺1.000', maintId: `fix-charger-${i}` } : undefined,
    }
  }
  switch (id) {
    case 'office':
      return {
        icon: 'i-office', name: 'Ofis',
        desc: 'İstasyonun yönetim binası. Burada sen varsın — her işe tek başına yetişiyorsun.',
        stats: [
          ['Pompa', `${state.pumps}`],
          ['Şarj ünitesi', `${state.evChargers}`],
          ['İtibar', `${state.reputation.toFixed(1)} ⭐`],
        ],
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
        desc: 'Yol yorgunları için. Tuvalet arayan müşteri bulamazsa itibarın düşer.',
        stats: [
          ['Moral etkisi', `+${(0.15 * state.toiletLevel).toFixed(2)} puan/müşteri`, 'good'],
          ['Arayan müşteri', '~%30'],
        ],
      }
    case 'solar': {
      const net = 2 * (1 - 0.7 * state.solarDirt) * (state.gridLevel >= 2 ? 1.3 : 1)
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
          ['Üretim', `+1.5 kWh/sn`],
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
          ['Üretim', producing ? `+${(8 * (state.gridLevel >= 2 ? 1.3 : 1)).toFixed(1)} kWh/sn` : 'DURDU (uranyum yok)', producing ? 'good' : 'bad'],
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
  if (selectedBuilding in PLACEABLE) {
    card.move = { label: 'Taşı (ücretsiz)', id: selectedBuilding }
  }
  ui.showBuildingCard(card)
}

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
      else ui.toast(zoneMode.kind === 'land'
        ? '🚫 Bu arsa alınamaz (bitişik değil, zaten senin ya da para yetmiyor).'
        : '🚫 Bu arsa betonlanamaz (senin değil, zaten betonlu ya da para yetmiyor).', 'bad')
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
    const warnFor = hits.find(h => h.object.userData.warnFor)?.object.userData.warnFor
    if (warnFor) {
      ui.onMaint(warnFor)
      return
    }
    let obj: THREE.Object3D | null = hits[0].object
    while (obj && !obj.userData.buildingId) obj = obj.parent
    if (obj?.userData.buildingId) {
      selectedBuilding = obj.userData.buildingId as string
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
let dayTime = 0
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
    localStorage.removeItem(SAVE_KEY) // her şey sıfırlanır
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
      if (c.kind === 'ev' && (c.phase === 'atPump' || c.phase === 'waiting')) c.patience -= dt * 1.2
    }
  }

  for (const f of FUELS) {
    if (state.orders[f].arrived) {
      state.orders[f].arrived = false
      tankers.push({ t: new Tanker(world.scene, modelLib, f, tankers.length), fuel: f })
    }
  }
  for (let i = tankers.length - 1; i >= 0; i--) {
    const { t, fuel } = tankers[i]
    if (t.update(dt)) {
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
    if (c.nozzle !== c.demandType && c.filled > 1.5) {
      wrongFuel(c)
    } else if (c.filledValue >= c.targetAmount) {
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
  syncHoses()
  updateCamera()
  ui.update(state, dt)
  composer!.render()
}
frame()
