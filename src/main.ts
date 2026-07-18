import * as THREE from 'three'
import { World, PUMP_SLOTS_POS, EV_SLOTS_POS } from './world'
import { Car, CarManager, Tanker } from './cars'
import { UI, BuildingCard } from './ui'
import {
  FuelType, FUEL_LABEL, FUEL_PRICE, GameState, FILL_RATE, SPILL_PENALTY_PER_L, WRONG_FUEL_PENALTY,
  EV_PRICE_PER_KWH, TANK_CAPACITY, URANIUM_COST, buyItem, doMaintenance, getShopItems,
} from './state'
import { loadModels, loadStatics } from './models'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

THREE.Object3D.DEFAULT_UP.set(0, 0, 1) // z yukarı

const app = document.getElementById('app')!
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1
app.appendChild(renderer.domElement)

// Kamera: (1x, 2y, 1z) yönünden ortografik; tekerlek = zoom, sürükle = kaydır
const VIEW = 26
const camera = new THREE.OrthographicCamera()
const camDir = new THREE.Vector3(1, 2, 1).normalize().multiplyScalar(42)
let camY = 0

function updateCamera() {
  camera.position.set(camDir.x, camDir.y + camY, camDir.z)
  camera.lookAt(0, camY, 0)
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
  camera.zoom = Math.min(2.6, Math.max(0.5, camera.zoom * Math.exp(-e.deltaY * 0.0012)))
  camera.updateProjectionMatrix()
}, { passive: true })
resize()
updateCamera()

// Kenney modelleri (yüklenemezse prosedürele düşer)
const [modelLib, staticLib] = await Promise.all([loadModels(), loadStatics()])

const world = new World(staticLib)
const state = new GameState()
const ui = new UI()
ui.batteryKwh = () => state.battery
let tanker: Tanker | null = null
let exploding = false
let selectedBuilding: string | null = null
let cardRefreshT = 0

composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(world.scene, camera))
composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.5, 0.85))
composer.addPass(new OutputPass())
composer.setSize(window.innerWidth, window.innerHeight)

const cars = new CarManager(world.scene, modelLib, {
  pumpCount: () => state.pumps,
  evCount: () => state.evChargers,
  entryChance: () => state.entryChance(),
  evShare: () => (state.evChargers > 0 ? Math.min(0.5, 0.15 + 0.09 * state.evChargers) : 0),
  isPumpBroken: i => state.brokenPumps.has(i),
  isChargerBroken: i => state.brokenChargers.has(i),
  onCarReady: car => { if (!ui.activeCar) ui.selectCar(car) },
  onCarLost: car => {
    ui.toast('😡 Müşteri beklemekten sıkıldı ve gitti!', 'bad')
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
    new THREE.MeshLambertMaterial({ color: car.nozzle === 'benzin' ? 0x2fa05a : 0xe8862e }))
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
    state.money += m; d += 0.2
    ui.toast(`🚿 Araç yıkandı: +₺${m}`, 'good')
  }
  if (car.wantsOil && state.hasOil) {
    const m = Math.round(150 + Math.random() * 100)
    state.money += m; d += 0.25
    ui.toast(`🔧 Yağ değişimi yapıldı: +₺${m}`, 'good')
  }
  if (car.wantsAir && state.hasAirWater) {
    const m = Math.round(10 + Math.random() * 10)
    state.money += m; d += 0.1
    ui.toast(`💨 Hava-su: +₺${m}`, 'good')
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
function concludeService(car: Car, score: number) {
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
    ui.toast(`💦 Fazla bastın, ${spill.toFixed(1)}L taştı! -${penalty} ₺`, 'bad')
  } else if (car.filledValue >= car.demandAmount - 10) {
    const tip = Math.round(revenue0 * 0.1)
    revenue += tip
    score += 0.8
    ui.toast(`👌 Tam isabet! +${tip} ₺ bahşiş`, 'good')
  } else {
    score -= 0.6
    ui.toast(`🤏 Eksik doldurdun (₺${revenue0.toFixed(0)} ödendi)`, '')
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

ui.onOrder = () => {
  if (state.placeOrder()) ui.toast('🚛 Tanker yola çıktı!', 'good')
}

/** satın alma sonrası sahnedeki görsel karşılığını kurar */
function buildVisual(id: string, pos?: THREE.Vector2) {
  switch (id) {
    case 'land-south': world.buyLand('south'); break
    case 'land-north': world.buyLand('north'); break
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
    case 'land-west': world.buyLand('west'); break
    case 'coffee': world.buildCoffee(pos); break
    case 'restaurant': world.buildRestaurant(pos); break
    case 'truckpark': world.buildTruckPark(pos); break
    case 'airwater': world.buildAirWater(pos); break
    case 'selfwash': world.buildSelfWash(pos); break
  }
}

// ---- Grid'e yerleştirme modu ----

const PLACEABLE: Record<string, () => { w: number; d: number }> = {
  market: () => (state.marketLevel === 0 ? { w: 5, d: 6 } : { w: 6, d: 8 }),
  toilet: () => ({ w: 3, d: 4 }),
  battery: () => ({ w: 3, d: 2 }),
  solar: () => ({ w: 5, d: 7 }),
  dieselgen: () => ({ w: 2, d: 2 }),
  smr: () => ({ w: 6, d: 5 }),
  wash: () => ({ w: 4.5, d: 5 }),
  oil: () => ({ w: 4, d: 4 }),
  coffee: () => ({ w: 3.2, d: 3.2 }),
  restaurant: () => ({ w: 5.5, d: 6 }),
  truckpark: () => ({ w: 8, d: 6 }),
  airwater: () => ({ w: 1.6, d: 2 }),
  selfwash: () => ({ w: 5.5, d: 7 }),
}

interface Rect { cx: number; cy: number; w: number; d: number }
const placedRects: (Rect & { id: string })[] = []
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)

function fixedObstacles(): Rect[] {
  const r: Rect[] = [
    { cx: 4.1, cy: 0, w: 3.0, d: 48 },      // servis şeridi (araç yolu)
    { cx: -4.4, cy: -5.4, w: 5.6, d: 6.6 }, // yakıt tankları
    { cx: -5.0, cy: 4.5, w: 4.8, d: 5.4 },  // ofis
    { cx: 4.0, cy: -11.5, w: 2.6, d: 3.8 }, // tabela
    { cx: -2.2, cy: 1.2, w: 3.2, d: 6.6 },  // otopark
    { cx: 0.2, cy: 4.8, w: 7.2, d: 1.8 },   // otopark yolu
  ]
  for (let i = 0; i < state.pumps; i++) r.push({ cx: 0.9, cy: PUMP_SLOTS_POS[i].y, w: 4.6, d: 4.2 })
  for (let i = 0; i < state.evChargers; i++) r.push({ cx: 1.2, cy: EV_SLOTS_POS[i].y, w: 4.2, d: 2.8 })
  return r
}

function overlaps(a: Rect, b: Rect): boolean {
  return Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 && Math.abs(a.cy - b.cy) < (a.d + b.d) / 2
}

let placing: { id: string; w: number; d: number; ghost: THREE.Mesh; valid: boolean; cx: number; cy: number } | null = null

function inOwnedLand(x: number, y: number): boolean {
  if (x >= -6.3 && x <= 4.8) {
    if (y >= -9.7 && y <= 9.7) return true
    if (state.landSouth && y >= -23.7 && y < -9.7) return true
    if (state.landNorth && y > 9.7 && y <= 23.7) return true
  }
  if (state.landWest && x >= -17.8 && x < -6.3 && y >= -9.7 && y <= 9.7) return true
  return false
}

function isValidPlacement(p: Rect, skipId: string): boolean {
  // ayak izinin köşeleri, kenar ortaları ve merkezi sahip olunan arsada olmalı
  for (const sx of [-1, 0, 1]) for (const sy of [-1, 0, 1]) {
    if (!inOwnedLand(p.cx + sx * (p.w / 2 - 0.2), p.cy + sy * (p.d / 2 - 0.2))) return false
  }
  for (const o of fixedObstacles()) if (overlaps(p, o)) return false
  for (const o of placedRects) if (o.id !== skipId && overlaps(p, o)) return false
  return true
}

function startPlacement(id: string) {
  cancelPlacement()
  const { w, d } = PLACEABLE[id]()
  const ghost = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ color: 0x37c97e, transparent: true, opacity: 0.42, depthTest: false }))
  ghost.position.z = 0.06
  world.scene.add(ghost)
  world.showGrid(true)
  placing = { id, w, d, ghost, valid: false, cx: 0, cy: 0 }
  ui.closeShop()
  ui.toast('📐 Yerleştirme modu: yeşil kareye tıkla · sağ tık veya ESC iptal', '')
}

function cancelPlacement() {
  if (!placing) return
  world.scene.remove(placing.ghost)
  world.showGrid(false)
  placing = null
}

function confirmPlacement() {
  const p = placing!
  if (!buyItem(state, p.id)) {
    ui.toast('💸 Para yetmiyor!', 'bad')
    cancelPlacement()
    return
  }
  buildVisual(p.id, new THREE.Vector2(p.cx, p.cy))
  const i = placedRects.findIndex(r => r.id === p.id)
  if (i >= 0) placedRects.splice(i, 1)
  placedRects.push({ id: p.id, cx: p.cx, cy: p.cy, w: p.w, d: p.d })
  buyToast(p.id)
  cancelPlacement()
}

window.addEventListener('keydown', e => { if (e.key === 'Escape') cancelPlacement() })
renderer.domElement.addEventListener('contextmenu', e => { e.preventDefault(); cancelPlacement() })

ui.onBuy = id => {
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
}

function buyToast(id: string) {
  switch (id) {
    case 'land-south': ui.toast('🏞️ Güney arsa satın alındı!', 'good'); break
    case 'land-north': ui.toast('🏞️ Kuzey arsa satın alındı!', 'good'); break
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
    case 'land-west': ui.toast('🏞️ Batı arsa satın alındı — geniş alan senin!', 'good'); break
    case 'coffee': ui.toast('☕ Kahveci açıldı!', 'good'); break
    case 'restaurant': ui.toast('🍽️ Restoran açıldı — yolcular yemek molası verecek!', 'good'); break
    case 'truckpark': ui.toast('🚛 Tır parkı açıldı — düzenli konaklama geliri!', 'good'); break
    case 'airwater': ui.toast('💨 Hava-su ünitesi kuruldu!', 'good'); break
    case 'selfwash': ui.toast('🧽 Self yıkama açıldı — köpük ve su otomatik satılacak!', 'good'); break
  }
}

// 🧪 FULL / vitrin modu: ?full=1 ile her şey kurulu başlar
if (new URLSearchParams(location.search).has('full')) {
  const FULL_ORDER = [
    'land-south', 'land-north', 'pump', 'pump', 'pump', 'sign', 'sign', 'sign',
    'tank', 'tank', 'tank', 'market', 'market', 'toilet', 'toilet', 'grid', 'grid',
    'battery', 'battery', 'battery', 'evcharger', 'evcharger', 'evcharger', 'evcharger',
    'solar', 'dieselgen', 'smr', 'wash', 'oil',
    'land-west', 'airwater', 'selfwash', 'coffee', 'restaurant', 'truckpark',
  ]
  state.money = 10_000_000
  for (const id of FULL_ORDER) {
    if (buyItem(state, id)) buildVisual(id)
  }
  state.money = 50_000
  state.tank = state.tankCapacity
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
      icon: '⛽', name: `Pompa #${i + 1}`,
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
      icon: '🔌', name: `DC Şarj #${i + 1}`,
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
        icon: '🏢', name: 'Ofis',
        desc: 'İstasyonun yönetim binası. Burada sen varsın — her işe tek başına yetişiyorsun.',
        stats: [
          ['Pompa', `${state.pumps}`],
          ['Şarj ünitesi', `${state.evChargers}`],
          ['İtibar', `${state.reputation.toFixed(1)} ⭐`],
        ],
      }
    case 'tank':
      return {
        icon: '🛢️', name: 'Yakıt Tankı',
        desc: 'Sattığın benzin ve dizel buradan çıkar. Bitirmeden tanker siparişi vermeyi unutma.',
        stats: [
          ['Doluluk', `${Math.round(state.tank)}L / ${state.tankCapacity}L`, state.tank < state.tankCapacity * 0.15 ? 'bad' : ''],
          ['Kapasite seviyesi', `${state.tankLevel + 1}/4 (maks ${TANK_CAPACITY[3]}L)`],
          ['Yakıt maliyeti', '₺6.5/L'],
        ],
      }
    case 'battery':
      return {
        icon: '🔋', name: 'Batarya Deposu',
        desc: 'Santrallerin ürettiği elektriği biriktirir. Elektrikli araçlar buradan anında şarj alır.',
        stats: [
          ['Dolu', `${Math.floor(state.battery)} / ${state.batteryCapacity} kWh`],
          ['Üretim', `+${rate.toFixed(1)} kWh/sn`, rate > 0 ? 'good' : ''],
          ['Seviye', `${state.batteryLevel}/3`],
        ],
      }
    case 'market':
      return {
        icon: '🛒', name: `Market Sv.${state.marketLevel}`,
        desc: 'Müşterilerin bir kısmı içeri girip alışveriş yapar — ekstra gelir ve memnuniyet.',
        stats: [
          ['Müşteri harcaması', `₺${25 * state.marketLevel}-${60 * state.marketLevel}`],
          ['Uğrama oranı', '~%35'],
        ],
      }
    case 'toilet':
      return {
        icon: '🚻', name: `Tuvalet Sv.${state.toiletLevel}`,
        desc: 'Yol yorgunları için. Tuvalet arayan müşteri bulamazsa itibarın düşer.',
        stats: [
          ['Moral etkisi', `+${(0.15 * state.toiletLevel).toFixed(2)} puan/müşteri`, 'good'],
          ['Arayan müşteri', '~%30'],
        ],
      }
    case 'solar': {
      const net = 2 * (1 - 0.7 * state.solarDirt) * (state.gridLevel >= 2 ? 1.3 : 1)
      return {
        icon: '☀️', name: 'Güneş Santrali',
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
        icon: '🛠️', name: 'Dizel Jeneratör',
        desc: 'Tanktan mazot yakarak elektrik üretir. Çalışırken gürültüsü şarjdaki müşterileri rahatsız eder.',
        stats: [
          ['Üretim', `+1.5 kWh/sn`],
          ['Yakıt tüketimi', '0.25 L/sn'],
          ['Durum', state.dieselRunning() ? 'ÇALIŞIYOR 🔊' : 'Beklemede', state.dieselRunning() ? 'bad' : 'good'],
        ],
      }
    case 'wash':
      return {
        icon: '🚿', name: 'Oto Yıkama',
        desc: 'Yakıt alan müşterilerin bir kısmı çıkışta aracını yıkatır.',
        stats: [
          ['Hizmet ücreti', '₺60-120'],
          ['Kullanım oranı', '~%25'],
        ],
      }
    case 'coffee':
      return {
        icon: '☕', name: 'Kahveci',
        desc: 'Park eden müşteriler kahve molası verir.',
        stats: [['Satış', '₺20-45'], ['Uğrama oranı', '~%30']],
      }
    case 'restaurant':
      return {
        icon: '🍽️', name: 'Restoran',
        desc: 'Uzun yol müşterisi park edip yemek yer — yüksek hesap öder.',
        stats: [['Hesap', '₺80-160'], ['Uğrama oranı', '~%18']],
      }
    case 'truckpark':
      return {
        icon: '🚛', name: 'Tır Parkı',
        desc: 'Tırcılar konaklar; sen hiçbir şey yapmadan düzenli gelir akar.',
        stats: [['Pasif gelir', '₺90-160 / ~45sn'], ['Trafik etkisi', '+%2']],
      }
    case 'airwater':
      return {
        icon: '💨', name: 'Hava-Su Ünitesi',
        desc: 'Lastik havası ve su. Küçük gelir ama müşteri çeker.',
        stats: [['Hizmet', '₺10-20'], ['Kullanım', '~%20']],
      }
    case 'selfwash':
      return {
        icon: '🧽', name: 'Self Yıkama',
        desc: 'Araçlar bölmelere girip kendileri yıkar; köpük ve su otomatik satılır.',
        stats: [['Pasif gelir', '₺30-60 / ~35sn'], ['Trafik etkisi', '+%2']],
      }
    case 'oil':
      return {
        icon: '🔧', name: 'Yağ Değişimi',
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
        icon: '☢️', name: 'Modüler Reaktör',
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
  if (card) ui.showBuildingCard(card)
}

// ---- Girdi: sürükle-kaydır + tıkla-seç ----
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
let downX = 0, downY = 0, lastX = 0, lastY = 0, isDown = false, isDrag = false

renderer.domElement.addEventListener('pointerdown', e => {
  isDown = true; isDrag = false
  downX = lastX = e.clientX
  downY = lastY = e.clientY
})
window.addEventListener('pointermove', e => {
  // yerleştirme hayaleti imleci takip eder
  if (placing) {
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    const pt = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(groundPlane, pt)) {
      placing.cx = Math.round(pt.x)
      placing.cy = Math.round(pt.y)
      placing.ghost.position.set(placing.cx, placing.cy, 0.06)
      placing.valid = isValidPlacement(placing, placing.id)
      ;(placing.ghost.material as THREE.MeshBasicMaterial).color.setHex(placing.valid ? 0x37c97e : 0xec5b5b)
    }
  }
  if (!isDown) return
  const dx = e.clientX - lastX
  const dy = e.clientY - lastY
  lastX = e.clientX; lastY = e.clientY
  if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 8) isDrag = true
  if (isDrag) {
    const wpp = VIEW / window.innerHeight / camera.zoom
    camY = Math.max(-22, Math.min(22, camY + (-0.45 * dx + 0.36 * dy) * wpp))
  }
})
window.addEventListener('pointerup', e => {
  if (!isDown) return
  isDown = false
  if (isDrag || e.target !== renderer.domElement) return
  if (placing) {
    if (e.button === 0) {
      if (placing.valid) confirmPlacement()
      else ui.toast('🚫 Buraya yerleştiremezsin — yeşil alana koy.', 'bad')
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

  for (const msg of state.events.splice(0)) ui.toast(msg, 'bad')

  if (state.exploded) {
    exploding = true
    ui.showBoom()
    setTimeout(() => location.reload(), 3500)
    return
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

  if (state.orderArrived) {
    state.orderArrived = false
    tanker = new Tanker(world.scene, modelLib)
  }
  if (tanker) {
    if (tanker.update(dt)) {
      state.deliverFuel()
      ui.toast('⛽ Ana tank dolduruldu!', 'good')
    }
    if (tanker.done) {
      world.scene.remove(tanker.group)
      tanker = null
    }
  }

  // pompalar bağımsız: dolumdaki HER araç aynı anda ilerler
  for (const c of [...cars.cars]) {
    if (c.phase === 'atPump' && c.kind === 'fuel') c.beingServed = c.filling
    if (!(c.filling && c.kind === 'fuel' && c.phase === 'atPump' && c.nozzle && !c.wrongFuelHandled)) continue
    if (state.tank <= 0) {
      ui.toast('🛢️ Ana tank boş kaldı! Satış yarım kaldı.', 'bad')
      finishSale(c)
      continue
    }
    const amount = Math.min(FILL_RATE * dt, state.tank)
    c.filled += amount
    state.tank -= amount
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
