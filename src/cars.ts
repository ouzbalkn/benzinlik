import * as THREE from 'three'
import { t } from './i18n'
import { FuelType, FUEL_LABEL, FUEL_PRICE } from './state'
import { ROAD_X, LANE_NEAR, LANE_FAR, PUMP_SLOTS_POS, EV_SLOTS_POS, TANK_POS, APRON_IN_Y, APRON_OUT_Y, APRON_SOUTH_Y } from './world'

const CAR_COLORS = [0x5b8def, 0xe25b5b, 0xf2c14e, 0x62b56b, 0x9a7bd0, 0xe8e6e1, 0x4a5560, 0x53b8a7, 0xef8b4e]
const CAR_SPEED = 7
const DEMAND_AMOUNTS = [100, 150, 200, 250, 300, 400]
const DECISION_Y = -26 // yakın şeritte istasyona girme kararının verildiği nokta

export type CarPhase = 'transit' | 'driving' | 'waiting' | 'atPump' | 'toPark' | 'parked' | 'leaving' | 'gone'
export type CarKind = 'fuel' | 'ev'
type BodyKind = 'sedan' | 'hatch' | 'suv'

const lam = (color: number) => new THREE.MeshLambertMaterial({ color })

function shapeFrom(points: [number, number][]): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1])
  s.closePath()
  return s
}

interface CarSpec {
  body: [number, number][]
  cabin: [number, number][]
  width: number
  wheelR: number
  wheelX: number
  front: number
  rear: number
}

const SPECS: Record<BodyKind, CarSpec> = {
  sedan: {
    body: [[-1.25, 0.2], [1.22, 0.2], [1.34, 0.35], [1.3, 0.62], [-1.22, 0.68], [-1.32, 0.45]],
    cabin: [[0.55, 0.66], [0.28, 1.05], [-0.45, 1.08], [-0.85, 0.68]],
    width: 1.1, wheelR: 0.27, wheelX: 0.8, front: 1.34, rear: -1.32,
  },
  hatch: {
    body: [[-1.0, 0.2], [1.0, 0.2], [1.12, 0.35], [1.08, 0.6], [-1.02, 0.68], [-1.1, 0.4]],
    cabin: [[0.4, 0.64], [0.15, 1.05], [-0.68, 1.06], [-0.96, 0.66]],
    width: 1.05, wheelR: 0.25, wheelX: 0.62, front: 1.12, rear: -1.1,
  },
  suv: {
    body: [[-1.2, 0.28], [1.2, 0.28], [1.32, 0.45], [1.28, 0.75], [-1.22, 0.8], [-1.3, 0.5]],
    cabin: [[0.5, 0.78], [0.3, 1.25], [-0.82, 1.28], [-1.08, 0.8]],
    width: 1.2, wheelR: 0.31, wheelX: 0.8, front: 1.32, rear: -1.3,
  },
}

function extrude(points: [number, number][], width: number, color: number): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(shapeFrom(points), {
    depth: width, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, steps: 1,
  })
  geo.translate(0, 0, -width / 2)
  const m = new THREE.Mesh(geo, lam(color))
  m.rotation.x = Math.PI / 2
  m.castShadow = true
  return m
}

function buildCarMesh(kind: BodyKind, color: number): THREE.Group {
  const g = new THREE.Group()
  const spec = SPECS[kind]
  g.add(extrude(spec.body, spec.width, color))
  g.add(extrude(spec.cabin, spec.width * 0.78, 0x394c60))
  const tire = new THREE.CylinderGeometry(spec.wheelR, spec.wheelR, 0.2, 16)
  const hub = new THREE.CylinderGeometry(spec.wheelR * 0.45, spec.wheelR * 0.45, 0.22, 10)
  for (const wx of [spec.wheelX, -spec.wheelX]) for (const wy of [spec.width / 2, -spec.width / 2]) {
    const t = new THREE.Mesh(tire, lam(0x22262a))
    t.position.set(wx, wy, spec.wheelR)
    t.castShadow = true
    g.add(t)
    const h = new THREE.Mesh(hub, lam(0xc8ccd0))
    h.position.set(wx, wy, spec.wheelR)
    g.add(h)
  }
  const bumpZ = kind === 'suv' ? 0.38 : 0.3
  for (const x of [spec.front - 0.02, spec.rear + 0.02]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, spec.width * 0.92, 0.14), lam(0x2e343a))
    b.position.set(x, 0, bumpZ)
    g.add(b)
  }
  const lightZ = kind === 'suv' ? 0.6 : 0.5
  for (const sy of [0.32, -0.32]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.1),
      new THREE.MeshLambertMaterial({ color: 0xfff2c9, emissive: 0xfff2c9, emissiveIntensity: 0.5 }))
    head.position.set(spec.front, sy * spec.width, lightZ)
    g.add(head)
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.09),
      new THREE.MeshLambertMaterial({ color: 0xd64545, emissive: 0xd64545, emissiveIntensity: 0.4 }))
    tail.position.set(spec.rear, sy * spec.width, lightZ + 0.04)
    g.add(tail)
  }
  return g
}

function liveSprite(text: string, accent: string): { sp: THREE.Sprite; set: (t: string) => void } {
  const c = document.createElement('canvas')
  c.width = 512; c.height = 192
  const ctx = c.getContext('2d')!
  const draw = (t: string) => {
    ctx.clearRect(0, 0, 512, 192)
    ctx.fillStyle = 'rgba(255,255,255,0.96)'
    ctx.strokeStyle = accent
    ctx.lineWidth = 14
    ctx.beginPath()
    ctx.roundRect(8, 8, 496, 176, 40)
    ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#1c2530'
    let fs = 76
    ctx.font = `800 ${fs}px -apple-system, sans-serif`
    while (fs > 34 && ctx.measureText(t).width > 448) {
      fs -= 4
      ctx.font = `800 ${fs}px -apple-system, sans-serif`
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(t, 256, 100)
  }
  draw(text)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, color: 0xdedede }))
  sp.scale.set(2.6, 0.98, 1)
  return { sp, set: (t: string) => { draw(t); tex.needsUpdate = true } }
}

function textSprite(text: string, accent: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 512; c.height = 192
  const ctx = c.getContext('2d')!
  ctx.fillStyle = 'rgba(255,255,255,0.96)'
  ctx.strokeStyle = accent
  ctx.lineWidth = 14
  ctx.beginPath()
  ctx.roundRect(8, 8, 496, 176, 40)
  ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#1c2530'
  let fs = 76
  ctx.font = `800 ${fs}px -apple-system, sans-serif`
  while (fs > 34 && ctx.measureText(text).width > 448) {
    fs -= 4
    ctx.font = `800 ${fs}px -apple-system, sans-serif`
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(text, 256, 100)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, color: 0xdedede }))
  sp.scale.set(2.6, 0.98, 1)
  return sp
}

function emojiSprite(emoji: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 128; c.height = 128
  const ctx = c.getContext('2d')!
  ctx.font = '100px -apple-system, sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(emoji, 64, 70)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }))
  sp.scale.set(1.15, 1.15, 1)
  return sp
}

import { ModelLib, cloneModel, CAR_FILES } from './models'

export class Car {
  group: THREE.Group
  kind: CarKind
  demandType: FuelType
  demandAmount: number
  demandLiters: number
  demandKwh: number
  maxPatience: number
  patience: number
  phase: CarPhase = 'transit'
  lane: 'near' | 'far' | null = null
  wantsEnter = false
  converted = false
  wantsMarket: boolean
  wantsToilet: boolean
  wantsWash: boolean
  wantsOil: boolean
  wantsCoffee: boolean
  wantsFood: boolean
  wantsAir: boolean
  filled = 0
  nozzle: FuelType | null = null
  targetAmount = 0
  /** pompa bu araca aktif dolum yapıyor (pompalar bağımsız çalışır) */
  filling = false
  /** FULLE modu: gizli depo ihtiyacına kadar doldurulur */
  fullMode = false
  /** müşteri özellikle t('FULLE') istiyor (tutar girilemez) */
  wantsFull = false
  /** EV: kademeli şarj sürüyor */
  charging = false
  chargedKwh = 0
  /** EV: şarjı bitti ama tesisleri gezmeye gitti — üniteyi işgal ediyor */
  squatting = false
  /** tır/kamyonet mi (dizel ağırlıklı, tır parkını kullanır) */
  isTruck = false
  wantsTruckPark = false
  truckSlot = -1
  stayT = 0
  /** geri geri park manevrası sürüyor */
  reversing = false
  private solidStuckT = 0
  truckStagePos: THREE.Vector3 | null = null
  /** aracın gizli yakıt ihtiyacı (litre) — tipine göre: binek/SUV/kamyon */
  hiddenNeedL = 30
  slotIndex = -1
  /** rezerve edilen bekleme noktası (yoksa -1) */
  waitIndex = -1
  /** öndeki araca çok yaklaştıysa bu karede bekle (üst üste binme yok) */
  hold = false
  holdTime = 0
  watchT = 0
  watchPos = new THREE.Vector3()
  hardStuckT = 0
  prevFramePos = new THREE.Vector3(NaN, 0, 0)
  /** sıkışma kurtarma penceresi: bu süre boyunca hold yok sayılır */
  overrideT = 0
  private barsOn = false
  wrongFuelHandled = false
  beingServed = false

  private path: THREE.Vector3[] = []
  private onArrive: (() => void) | null = null
  private bubble: THREE.Sprite | null = null
  private patienceBg: THREE.Sprite
  private patienceFill: THREE.Sprite
  private feedback: THREE.Sprite | null = null
  private feedbackT = 0

  private prices: Record<FuelType, number>

  constructor(scene: THREE.Scene, lib: ModelLib | null, kind: CarKind, prices: Record<FuelType, number> = FUEL_PRICE) {
    this.kind = kind
    this.prices = { ...prices }
    if (kind === 'ev') {
      if (lib?.evCar) {
        this.group = cloneModel(lib.evCar)
        // EV'ler tek renk gelmesin: gövdeyi rastgele tonla boya
        const EV_TINTS = [0xffffff, 0xffb9b9, 0xb9d4ff, 0xbdf5cd, 0xffe6a8, 0xe3c2ff, 0x9fe8f5]
        const tint = EV_TINTS[Math.floor(Math.random() * EV_TINTS.length)]
        this.group.traverse(o => {
          const m = o as THREE.Mesh
          if (m.isMesh && m.material) {
            m.material = (m.material as THREE.Material).clone()
            ;(m.material as THREE.MeshStandardMaterial).color?.setHex(tint)
          }
        })
      } else {
        this.group = buildCarMesh('hatch', 0x35c7d6)
      }
    } else if (lib && lib.cars.length > 0) {
      const idx = Math.floor(Math.random() * lib.cars.length)
      this.group = cloneModel(lib.cars[idx])
      const name = CAR_FILES[idx] ?? 'sedan'
      const cap = /van|delivery|truck/.test(name) ? 110 : /suv/.test(name) ? 65 : 45
      this.hiddenNeedL = Math.round(cap * (0.55 + Math.random() * 0.35))
      this.isTruck = /truck|delivery/.test(name)
    } else {
      const kinds: BodyKind[] = ['sedan', 'sedan', 'hatch', 'hatch', 'suv']
      const bk = kinds[Math.floor(Math.random() * kinds.length)]
      this.group = buildCarMesh(bk, CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)])
      this.hiddenNeedL = Math.round((bk === 'suv' ? 65 : 45) * (0.55 + Math.random() * 0.35))
    }
    this.group.userData.car = this
    const fr = Math.random()
    this.demandType = this.isTruck && Math.random() < 0.85
      ? 'dizel'
      : fr < 0.4 ? 'benzin' : fr < 0.8 ? 'dizel' : 'lpg'
    this.demandAmount = DEMAND_AMOUNTS[Math.floor(Math.random() * DEMAND_AMOUNTS.length)]
    this.demandLiters = this.demandAmount / this.prices[this.demandType]
    this.demandKwh = 20 + Math.floor(Math.random() * 9) * 5 // 20..60
    this.wantsFull = kind === 'fuel' && Math.random() < 0.10
    // FULLE isteyenler dolu depo boşaltır: ₺500-1000 arası (kusuratlı) yakıt alır
    if (this.wantsFull) this.hiddenNeedL = (250 + Math.random() * 250) / this.prices[this.demandType]
    this.maxPatience = kind === 'ev' ? 45 : 75
    this.patience = this.maxPatience
    this.wantsMarket = Math.random() < 0.35
    this.wantsToilet = Math.random() < 0.12
    this.wantsWash = kind === 'fuel' && Math.random() < 0.25
    this.wantsOil = kind === 'fuel' && Math.random() < 0.12
    this.wantsCoffee = Math.random() < 0.3
    this.wantsFood = Math.random() < 0.18
    this.wantsAir = kind === 'fuel' && Math.random() < 0.2
    scene.add(this.group)

    const mkBar = (c: number, z: number) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ color: c, depthTest: false }))
      sp.scale.set(1.5, 0.16, 1)
      sp.position.z = z
      sp.visible = false
      this.group.add(sp)
      return sp
    }
    this.patienceBg = mkBar(0x1c2530, 2.0)
    this.patienceFill = mkBar(0x4dc36b, 2.01)
  }

  get filledValue(): number {
    return this.nozzle ? this.filled * this.prices[this.nozzle] : 0
  }

  get patienceFrac(): number {
    return Math.max(0, this.patience) / this.maxPatience
  }

  setPath(points: THREE.Vector3[], onArrive?: () => void) {
    this.path = points.map(p => p.clone())
    this.onArrive = onArrive ?? null
  }

  showBars() { this.barsOn = true }

  hideBars() {
    this.barsOn = false
    this.patienceBg.visible = false
    this.patienceFill.visible = false
  }

  /** gidilen yönün birim vektörü (durunca null) */
  headingDir(): THREE.Vector3 | null {
    if (this.path.length === 0) return null
    const d = new THREE.Vector3().subVectors(this.path[0], this.group.position)
    d.z = 0
    return d.lengthSq() < 1e-6 ? null : d.normalize()
  }

  private bubbleSet: ((t: string) => void) | null = null

  showBubble() {
    if (this.bubble) return
    let made: { sp: THREE.Sprite; set: (t: string) => void }
    if (this.kind === 'ev') {
      made = liveSprite(`⚡ ${this.demandKwh} kWh`, '#35c7d6')
    } else {
      const accent = this.demandType === 'benzin' ? '#27a05a' : this.demandType === 'dizel' ? '#e8862e' : '#2f6fed'
      made = liveSprite(this.wantsFull
        ? t('FULLE {0}', FUEL_LABEL[this.demandType])
        : `₺${this.demandAmount} ${FUEL_LABEL[this.demandType]}`, accent)
    }
    this.bubble = made.sp
    this.bubbleSet = made.set
    this.bubble.position.z = 2.85
    this.group.add(this.bubble)
  }

  /** dolum/şarj sırasında balonu canlı sayaca çevirir */
  setCounter(t: string) { this.bubbleSet?.(t) }

  hideBubble() {
    if (this.bubble) { this.group.remove(this.bubble); this.bubble = null; this.bubbleSet = null }
  }

  showFeedback(emoji: string) {
    if (this.feedback) this.group.remove(this.feedback)
    this.feedback = emojiSprite(emoji)
    this.feedback.position.z = 2.6
    this.group.add(this.feedback)
    this.feedbackT = 2.5
  }

  /** ana döngü her karede doldurur: sert engeller (pompa, bina...) */
  static solids: { cx: number; cy: number; w: number; d: number }[] = []

  private static insideSolid(x: number, y: number): boolean {
    for (const o of Car.solids) {
      if (Math.abs(x - o.cx) < o.w / 2 + 0.45 && Math.abs(y - o.cy) < o.d / 2 + 0.45) return true
    }
    return false
  }

  update(dt: number) {
    if (this.path.length > 0 && !this.hold) {
      const pos = this.group.position
      const target = this.path[0]
      const d = new THREE.Vector3().subVectors(target, pos)
      d.z = 0
      const dist = d.length()
      const step = CAR_SPEED * dt * (this.reversing ? 0.45 : 1)
      if (dist <= step) {
        pos.copy(target)
        this.path.shift()
        if (this.path.length === 0 && this.onArrive) {
          const cb = this.onArrive
          this.onArrive = null
          cb()
        }
      } else {
        d.normalize()
        // sert engel: ileri adım bir objenin içine giriyorsa eksen eksen kaymayı dene
        const nx = pos.x + d.x * step
        const ny = pos.y + d.y * step
        let mx = pos.x, my = pos.y
        if (!Car.insideSolid(nx, ny)) { mx = nx; my = ny }
        else if (Math.abs(d.x) > 0.01 && !Car.insideSolid(nx, pos.y)) { mx = nx } // duvar boyunca x'te kay
        else if (Math.abs(d.y) > 0.01 && !Car.insideSolid(pos.x, ny)) { my = ny } // duvar boyunca y'de kay
        // ikisi de tıkalıysa bu kare bekle (asla içinden geçme)
        const movedDist = Math.hypot(mx - pos.x, my - pos.y)
        const moved = movedDist > 1e-9
        pos.set(mx, my, pos.z)
        // engele takıldıysa say; 1.6 sn ilerleyemezse başka yönden dolaş
        if (movedDist < step * 0.25) this.solidStuckT += dt
        else this.solidStuckT = 0
        if (this.solidStuckT > 1.6 && this.path.length < 12) {
          this.solidStuckT = 0
          const base = Math.atan2(target.y - pos.y, target.x - pos.x)
          let best: THREE.Vector3 | null = null
          let bestScore = Infinity
          for (const a of [50, -50, 90, -90, 130, -130, 180]) {
            const ang = base + a * Math.PI / 180
            const cx2 = pos.x + Math.cos(ang) * 2.2
            const cy2 = pos.y + Math.sin(ang) * 2.2
            if (Car.insideSolid(cx2, cy2)) continue
            if (Car.insideSolid(pos.x + Math.cos(ang) * 1.1, pos.y + Math.sin(ang) * 1.1)) continue
            const score = Math.hypot(target.x - cx2, target.y - cy2) + Math.abs(a) * 0.015
            if (score < bestScore) { bestScore = score; best = new THREE.Vector3(cx2, cy2, 0) }
          }
          if (best) this.path.unshift(best) // ara nokta: engelin öbür yanından dolan
        }
        if (moved) {
          const yaw = Math.atan2(d.y, d.x) + (this.reversing ? Math.PI : 0)
          let diff = yaw - this.group.rotation.z
          while (diff > Math.PI) diff -= Math.PI * 2
          while (diff < -Math.PI) diff += Math.PI * 2
          this.group.rotation.z += diff * Math.min(1, dt * 8)
        }
      }
    }

    if ((this.phase === 'waiting' || this.phase === 'atPump') && !this.beingServed) {
      this.patience -= dt
    }
    // sabır mekaniği görünmez işler: araç üstünde bar gösterilmez
    this.patienceBg.visible = false
    this.patienceFill.visible = false

    if (this.feedback) {
      this.feedbackT -= dt
      this.feedback.position.z += dt * 0.3
      if (this.feedbackT <= 0) {
        this.group.remove(this.feedback)
        this.feedback = null
      }
    }
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group)
    this.phase = 'gone'
  }
}

/** Sipariş gelince tank dolduran tanker kamyonu */
export class Tanker {
  group: THREE.Group
  private path: THREE.Vector3[] = []
  private stayTimer = 0
  private blockedTime = 0
  private leaving = false
  done = false
  unloading = false

  private outY: number
  constructor(scene: THREE.Scene, lib: ModelLib | null, fuel: FuelType = 'benzin', queueIdx = 0, target = new THREE.Vector3(TANK_POS.x, TANK_POS.y, 0), inY = APRON_IN_Y, outY = APRON_OUT_Y) {
    this.outY = outY
    const tint = fuel === 'benzin' ? 0xa8d6b8 : fuel === 'dizel' ? 0xe3c49b : 0xaccdf0
    let g: THREE.Group
    if (lib?.tankerBase) {
      g = new THREE.Group()
      g.add(cloneModel(lib.tankerBase))
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 16), lam(tint))
      tank.rotation.z = Math.PI / 2
      tank.position.set(-0.55, 0, 0.95)
      tank.castShadow = true
      g.add(tank)
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.15, 10), lam(0x8f979e))
      cap.rotation.x = Math.PI / 2
      cap.position.set(-0.55, 0, 1.5)
      g.add(cap)
      g.scale.setScalar(1.5)
    } else {
      g = new THREE.Group()
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.5, 1.5), lam(0xd64545))
      cab.position.set(1.9, 0, 0.95); cab.castShadow = true; g.add(cab)
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 3.4, 18), lam(tint))
      tank.rotation.z = Math.PI / 2
      tank.position.set(-0.6, 0, 1.15); tank.castShadow = true; g.add(tank)
      const chassis = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.4, 0.3), lam(0x2b2f33))
      chassis.position.set(0, 0, 0.45); g.add(chassis)
      const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.25, 14)
      for (const wx of [1.9, 0.2, -1.6]) for (const wy of [0.72, -0.72]) {
        const w = new THREE.Mesh(wheelGeo, lam(0x22262a))
        w.position.set(wx, wy, 0.32); g.add(w)
      }
    }
    g.position.set(ROAD_X, -44, 0)
    scene.add(g)
    this.group = g
    // tank nereye taşınırsa taşınsın: şeritten tank hizasına gel, en yakın kenara park et
    const parkY = target.y + [0, 2.4, -2.4][queueIdx % 3]
    const parkX = Math.min(Math.max(target.x + 3.2, 3.4), 4.0)
    this.path = [
      new THREE.Vector3(LANE_NEAR, inY - 3.5, 0),
      new THREE.Vector3(4.2, inY, 0),
      new THREE.Vector3(4.2, parkY, 0), // şerit boyunca hizaya
      new THREE.Vector3(parkX, parkY, 0), // en yakın kenardan boşaltım — içeri dalmaz
    ]
  }

  update(dt: number, isBlocked?: (pos: THREE.Vector3, dir: THREE.Vector3) => boolean): boolean {
    let delivered = false
    if (this.path.length > 0) {
      const pos = this.group.position
      const target = this.path[0]
      const d = new THREE.Vector3().subVectors(target, pos)
      const dist = d.length()
      const step = 8 * dt
      if (dist <= step) {
        pos.copy(target)
        this.path.shift()
        if (this.path.length === 0 && !this.leaving) {
          this.stayTimer = 4
          this.unloading = true
        }
      } else {
        d.normalize()
        // trafik nezaketi: önünde araç varsa tanker bekler (7 sn'den fazla sıkışırsa zorlar)
        if (this.blockedTime < 7 && isBlocked?.(pos, d)) {
          this.blockedTime += dt
          return delivered
        }
        if (this.blockedTime >= 7) this.blockedTime = Math.max(0, this.blockedTime - dt * 3)
        else this.blockedTime = 0
        pos.addScaledVector(d, step)
        this.group.rotation.z = Math.atan2(d.y, d.x)
      }
    } else if (!this.leaving) {
      this.stayTimer -= dt
      if (this.stayTimer <= 0) {
        delivered = true
        this.unloading = false
        this.leaving = true
        this.path = [
          new THREE.Vector3(4.2, this.group.position.y, 0), // düz doğuya, şeride çık
          new THREE.Vector3(4.2, this.outY, 0),             // şerit boyunca çıkışa
          new THREE.Vector3(LANE_NEAR, this.outY + 4, 0),
          new THREE.Vector3(LANE_NEAR, 44, 0),
        ]
      }
    } else {
      this.done = true
    }
    return delivered
  }
}

const WAIT_SPOTS = [
  new THREE.Vector3(3.4, -4.6, 0), new THREE.Vector3(3.4, -7.4, 0),
  new THREE.Vector3(3.4, -16.8, 0), new THREE.Vector3(3.4, -19.6, 0),
]
const PARK_LANE_Y = 4.8

export interface CarManagerOpts {
  pumpCount: () => number
  evCount: () => number
  entryChance: () => number
  evShare: () => number
  isPumpBroken: (i: number) => boolean
  isChargerBroken: (i: number) => boolean
  /** yerleştirilmiş otoparkın park noktaları (yoksa boş) */
  parkSpots: () => THREE.Vector3[]
  /** araçların kaçınacağı ek engeller (ör. tanker) */
  extraObstacles: () => THREE.Vector3[]
  /** güncel satış fiyatları (oyuncu belirler) */
  prices: () => Record<FuelType, number>
  /** dinamik servis noktaları — pompa/şarj taşınınca değişir */
  pumpSlot: (i: number) => THREE.Vector3
  evSlot: (i: number) => THREE.Vector3
  /** taşınabilir giriş/çıkış kapı y koordinatları */
  gateInY: () => number
  gateOutY: () => number
  /** işgalci yüzünden şarj bulamayıp giden EV müşterisi */
  onEvTurnedAway?: () => void
  /** tır parkı noktaları (park + manevra noktası) */
  truckSpots: () => { spot: THREE.Vector3; stage: THREE.Vector3 }[]
  /** tır park ücreti tahsilatı */
  onTruckParked?: (car: Car) => void
  onCarReady: (car: Car) => void
  onCarLost: (car: Car) => void
}

export class CarManager {
  cars: Car[] = []
  private nearTimer = 1
  private farTimer = 2.5
  private pumpOcc: (Car | null)[] = Array(8).fill(null)
  private evOcc: (Car | null)[] = Array(8).fill(null)
  private parkOcc: (Car | null)[] = []
  private waitOcc: (Car | null)[] = [null, null, null, null]

  constructor(private scene: THREE.Scene, private lib: ModelLib | null,
              private opts: CarManagerOpts) {}

  update(dt: number) {
    // yoldan geçen trafik
    this.nearTimer -= dt
    this.farTimer -= dt
    const transitCount = this.cars.filter(c => c.phase === 'transit').length
    // spawn noktası doluysa bekle (üst üste doğmasınlar)
    const spawnClear = (lane: 'near' | 'far') => !this.cars.some(c =>
      c.phase === 'transit' && c.lane === lane && Math.abs(c.group.position.y) > 35)
    if (this.nearTimer <= 0 && transitCount < 18) {
      if (spawnClear('near')) {
        this.spawnTransit('near')
        this.nearTimer = 1.5 + Math.random() * 1.8
      } else this.nearTimer = 0.5
    }
    if (this.farTimer <= 0 && transitCount < 18) {
      if (spawnClear('far')) {
        this.spawnTransit('far')
        this.farTimer = 2.0 + Math.random() * 2.4
      } else this.farTimer = 0.5
    }

    // çarpışma önleme: HİÇBİR araç bir diğerinin içinden geçmez.
    // Önümdeki koridorda (2.8 birim ileri, 1.25 yana) araç varsa dururum.
    const blockers = new Map<Car, Car>()
    for (const c of this.cars) c.hold = false
    for (const c of this.cars) {
      if (c.phase === 'gone' || c.phase === 'atPump' || c.phase === 'parked' || c.phase === 'waiting') continue
      const dir = c.headingDir()
      if (!dir) continue
      for (const o of this.cars) {
        if (o === c || o.phase === 'gone') continue
        // otopark içi: park etmiş komşu araçlar engel sayılmaz (dar aralıkta kilitlenme olmasın)
        if (o.phase === 'parked' && (c.phase === 'toPark' || c.phase === 'leaving')) continue
        const rel = new THREE.Vector3().subVectors(o.group.position, c.group.position)
        rel.z = 0
        const forward = rel.dot(dir)
        if (forward < 0.4 || forward > 3.6) continue
        const lateral = rel.addScaledVector(dir, -forward).length()
        if (lateral < 1.25) { c.hold = true; blockers.set(c, o); break }
      }
      if (!c.hold) {
        for (const ob of this.opts.extraObstacles()) {
          const rel = new THREE.Vector3().subVectors(ob, c.group.position)
          rel.z = 0
          const forward = rel.dot(dir)
          if (forward < 0.2 || forward > 3.8) continue
          if (rel.addScaledVector(dir, -forward).length() < 1.5) { c.hold = true; break }
        }
      }
    }
    // trafik kuralı: şeride çıkacak araç yaklaşan trafiğe YOL VERİR ve
    // öndeki araç takip mesafesi kadar (4.5 birim) açılmadan yola atlamaz
    for (const c of this.cars) {
      if (c.hold || c.phase !== 'leaving') continue
      const p = c.group.position
      const inMergeZone = p.x > 3.9 && p.x < LANE_NEAR - 0.25
      if (!inMergeZone) continue
      const laneBusy = this.cars.some(o => {
        if (o === c || o.lane === 'far') return false
        const oy = o.group.position.y
        // arkadan yaklaşan akan trafik
        if (o.phase === 'transit' && !o.hold && oy > p.y - 12 && oy < p.y + 1.5) return true
        // az önce şeride çıkmış öndeki araç yeterince uzaklaşmadıysa bekle
        if (o.phase === 'leaving' && o.group.position.x > 5.2 && oy > p.y - 1 && oy < p.y + 6) return true
        return false
      })
      if (laneBusy) c.hold = true
    }

    // karşılıklı kilitlenme: ikisi de birbirini bekliyorsa biri yol alır
    for (const [c, o] of blockers) {
      if (blockers.get(o) === c && c.hold && o.hold) o.hold = false
    }
    // zincir döngüleri (A→B→C→A): döngüdeki EN UZUN bekleyen tek araç serbest kalır.
    // İkisi birden değil — çift taraflı kaçış çarpışması bug'ının panzehiri.
    const resolved = new Set<Car>()
    for (const c of this.cars) {
      if (!c.hold || resolved.has(c)) continue
      const chainIdx = new Map<Car, number>()
      const chain: Car[] = []
      let cur: Car | undefined = c
      while (cur && !chainIdx.has(cur) && chain.length < 10) {
        chainIdx.set(cur, chain.length)
        chain.push(cur)
        cur = blockers.get(cur)
      }
      if (cur && chainIdx.has(cur)) {
        const cycle = chain.slice(chainIdx.get(cur)!)
        let winner = cycle[0]
        for (const x of cycle) if (x.holdTime > winner.holdTime) winner = x
        winner.hold = false
        winner.overrideT = Math.max(winner.overrideT, 1.0)
        for (const x of cycle) resolved.add(x)
      }
    }
    // uzun süre sıkışan araç kendini kurtarır (gridlock sigortası):
    // 5 sn beklerse 1.4 sn'lik gerçek bir kurtulma penceresi açılır
    for (const c of this.cars) {
      if (c.overrideT > 0) {
        c.overrideT -= dt
        c.hold = false
        // kaçarken bile başka aracın gövdesine GİRME — bindirme bug'ının kökü buydu
        const dir = c.headingDir()
        if (dir) {
          for (const o of this.cars) {
            if (o === c || o.phase === 'gone') continue
            const rel = new THREE.Vector3().subVectors(o.group.position, c.group.position)
            rel.z = 0
            const fwd = rel.dot(dir)
            if (fwd > 0.1 && fwd < 1.1 && rel.addScaledVector(dir, -fwd).length() < 0.95) {
              c.hold = true
              break
            }
          }
        }
        continue
      }
      if (c.hold) {
        c.holdTime += dt
        if (c.holdTime > 2.5) {
          c.holdTime = 0
          c.overrideT = 1.6
          c.hold = false
        }
      } else {
        c.holdTime = 0
      }
    }

    // giriş kararı
    for (const car of this.cars) {
      if (car.phase === 'transit' && car.lane === 'near' && !car.converted
          && car.group.position.y > DECISION_Y) {
        car.converted = true
        if (car.wantsEnter) this.tryEnter(car)
      }
    }

    // bekleyen yakıt müşterilerini boş (ve sağlam) pompaya yolla
    for (let i = 0; i < this.opts.pumpCount(); i++) {
      if (this.pumpOcc[i] || this.opts.isPumpBroken(i)) continue
      const waiting = this.cars.find(c => c.waitIndex >= 0 && c.slotIndex === -1 && c.patience > 0
        && (c.phase === 'waiting' || c.phase === 'driving'))
      if (waiting) this.sendToSlot(waiting, i)
    }

    for (const car of this.cars) {
      if (car.truckSlot >= 0 && car.phase === 'parked') {
        car.stayT -= dt
        if (car.stayT <= 0) this.leaveTruckPark(car)
      }
      // sıkışma bekçisi: hareket etmesi gereken araç 6 sn'dir yerindeyse kurtar
      if (car.phase === 'driving' || car.phase === 'toPark' || car.phase === 'leaving') {
        car.watchT += dt
        if (car.watchT >= 6) {
          if (car.group.position.distanceTo(car.watchPos) < 0.35) this.recoverStuck(car)
          car.watchPos.copy(car.group.position)
          car.watchT = 0
        }
      } else {
        car.watchT = 0
        car.watchPos.copy(car.group.position)
      }
      car.update(dt)
      // NİHAİ SİGORTA: hareket etmesi gereken araç 18 sn boyunca yerinden oynayamadıysa
      // sessizce sahneden çekilir — trafik ne olursa olsun kalıcı kilitlenemez.
      const movingPhase = car.phase === 'transit' || car.phase === 'driving'
        || car.phase === 'leaving' || car.phase === 'toPark'
      if (movingPhase) {
        const d2 = isNaN(car.prevFramePos.x) ? 1 : car.group.position.distanceToSquared(car.prevFramePos)
        if (d2 < 0.0006) car.hardStuckT += dt
        else car.hardStuckT = Math.max(0, car.hardStuckT - dt * 3)
        // giriş rampasında/manevrada tıkanan araç yolu tıkamasın: 7 sn'de çekilir; genelde 12 sn
        const atEntry = car.phase === 'driving' && car.group.position.x > 2.5 && car.slotIndex < 0
        if (car.hardStuckT > (atEntry ? 3.5 : 9)) this.evaporate(car)
      } else {
        car.hardStuckT = 0
      }
      car.prevFramePos.copy(car.group.position)
      if ((car.phase === 'waiting' || car.phase === 'atPump') && car.patience <= 0 && !car.beingServed) {
        car.showFeedback('😡')
        this.releaseCar(car)
        this.onLost(car)
      }
    }

    this.cars = this.cars.filter(c => {
      if (c.phase === 'gone') return false
      if ((c.phase === 'transit' || c.phase === 'leaving') && Math.abs(c.group.position.y) > 42.5) {
        c.dispose(this.scene)
        return false
      }
      return true
    })
  }

  private onLost(car: Car) { this.opts.onCarLost(car) }

  private spawnTransit(lane: 'near' | 'far') {
    const isEv = Math.random() < this.opts.evShare()
    const car = new Car(this.scene, this.lib, isEv ? 'ev' : 'fuel', this.opts.prices())
    car.lane = lane
    car.phase = 'transit'
    if (lane === 'near') {
      car.group.position.set(LANE_NEAR, -40, 0)
      car.group.rotation.z = Math.PI / 2
      car.setPath([new THREE.Vector3(LANE_NEAR, 44, 0)])
      car.wantsEnter = Math.random() < this.opts.entryChance()
      car.wantsTruckPark = car.isTruck && Math.random() < 0.4
    } else {
      car.group.position.set(LANE_FAR, 40, 0)
      car.group.rotation.z = -Math.PI / 2
      car.setPath([new THREE.Vector3(LANE_FAR, -44, 0)])
    }
    this.cars.push(car)
  }

  /** rampadan girip hedef noktaya giden yol */
  private entryPath(p: THREE.Vector3): THREE.Vector3[] {
    const apronY = this.opts.gateInY()
    return [
      new THREE.Vector3(LANE_NEAR, apronY - 3.5, 0),
      new THREE.Vector3(4.2, apronY, 0),
      new THREE.Vector3(3.2, p.y - 2.5, 0),
      p.clone(),
    ]
  }

  /** tıra boş tır parkı yeri bul ve gönder; başarılıysa true */
  sendTruckToPark(car: Car): boolean {
    const spots = this.opts.truckSpots()
    if (!spots.length) return false
    while (this.truckOcc.length < spots.length) this.truckOcc.push(null)
    let si = -1
    for (let i = 0; i < spots.length; i++) if (!this.truckOcc[i]) { si = i; break }
    if (si < 0) return false
    this.truckOcc[si] = car
    car.truckSlot = si
    car.phase = 'toPark'
    const { spot, stage } = spots[si]
    car.truckStagePos = stage.clone()
    const from = car.group.position
    const path: THREE.Vector3[] = []
    if (from.x > 5) { // yoldan geliyor: kapıdan gir
      path.push(new THREE.Vector3(LANE_NEAR, this.opts.gateInY() - 3.5, 0))
      path.push(new THREE.Vector3(4.2, this.opts.gateInY(), 0))
    }
    path.push(new THREE.Vector3(4.0, stage.y, 0))
    path.push(stage.clone())
    car.setPath(path, () => {
      // manevra noktasına geldi: geri geri yanaş (cool kısım)
      car.reversing = true
      car.setPath([spot.clone()], () => {
        car.reversing = false
        car.phase = 'parked'
        car.stayT = 14 + Math.random() * 18
        this.opts.onTruckParked?.(car)
      })
    })
    return true
  }

  /** pompadaki tırı slotu boşaltarak tır parkına yollar */
  sendTruckToParkFromPump(car: Car): boolean {
    if (car.slotIndex >= 0) {
      if (car.kind === 'ev') this.evOcc[car.slotIndex] = null
      else this.pumpOcc[car.slotIndex] = null
      car.slotIndex = -1
    }
    return this.sendTruckToPark(car)
  }

  private leaveTruckPark(car: Car) {
    if (car.truckSlot >= 0) this.truckOcc[car.truckSlot] = null
    car.truckSlot = -1
    car.phase = 'leaving'
    const out: THREE.Vector3[] = []
    if (car.truckStagePos) out.push(car.truckStagePos.clone()) // önce ileri çık
    out.push(new THREE.Vector3(4.2, this.opts.gateOutY(), 0))
    out.push(new THREE.Vector3(LANE_NEAR, this.opts.gateOutY() + 4, 0))
    out.push(new THREE.Vector3(LANE_NEAR, 44, 0))
    car.truckStagePos = null
    car.setPath(out)
  }

  private truckOcc: (Car | null)[] = []

  private tryEnter(car: Car) {
    if (this.opts.entryChance() <= 0) return // istasyon kapalı: kimse girmez
    if (car.wantsTruckPark && car.truckSlot < 0 && this.sendTruckToPark(car)) return
    // giriş rampasında (kapı ile pompalar arası) zaten manevra yapan araç varsa BEKLE —
    // aynı anda tek araç girer, apron'da yığılma/kilitlenme olmaz (oyuncu şikayeti fixi)
    const gy = this.opts.gateInY()
    const rampBusy = this.cars.some(o => o !== car && o.phase === 'driving'
      && o.group.position.x > 2.6 && o.group.position.x < 5.2
      && Math.abs(o.group.position.y - gy) < 6)
    if (rampBusy) return // bu araç yola devam eder, sonraki karar noktasında tekrar dener
    if (car.kind === 'ev') {
      let slot = -1
      for (let i = 0; i < this.opts.evCount(); i++) {
        if (!this.evOcc[i] && !this.opts.isChargerBroken(i)) { slot = i; break }
      }
      if (slot < 0) {
        if (this.evOcc.some(x => x?.squatting)) this.opts.onEvTurnedAway?.()
        return // şarj yeri yok, yoluna devam
      }
      this.evOcc[slot] = car
      car.slotIndex = slot
      car.phase = 'driving'
      car.setPath(this.entryPath(this.opts.evSlot(slot)), () => this.arriveAtSlot(car))
      car.showBars()
      return
    }
    // yakıt müşterisi
    let slot = -1
    for (let i = 0; i < this.opts.pumpCount(); i++) {
      if (!this.pumpOcc[i] && !this.opts.isPumpBroken(i)) { slot = i; break }
    }
    if (slot >= 0) {
      this.pumpOcc[slot] = car
      car.slotIndex = slot
      car.phase = 'driving'
      car.setPath(this.entryPath(this.opts.pumpSlot(slot)), () => this.arriveAtSlot(car))
      car.showBars()
      return
    }
    // boş bekleme noktası REZERVE edilir; hiç yer yoksa araç girmez, yoluna gider
    let wi = -1
    for (let i = 0; i < WAIT_SPOTS.length; i++) if (!this.waitOcc[i]) { wi = i; break }
    if (wi >= 0) {
      this.waitOcc[wi] = car
      car.waitIndex = wi
      car.phase = 'driving'
      car.setPath([
        new THREE.Vector3(LANE_NEAR, this.opts.gateInY() - 3.5, 0),
        new THREE.Vector3(4.2, this.opts.gateInY(), 0),
        WAIT_SPOTS[wi],
      ], () => {
        car.phase = 'waiting'
      })
      car.showBars()
    }
    // yer yoksa araba yoluna devam eder (kaçan müşteri)
  }

  private arriveAtSlot(car: Car) {
    car.phase = 'atPump'
    car.group.rotation.z = Math.PI / 2
    car.showBubble()
    this.opts.onCarReady(car)
  }

  private sendToSlot(car: Car, slot: number) {
    if (car.waitIndex >= 0) {
      this.waitOcc[car.waitIndex] = null
      car.waitIndex = -1
    }
    this.pumpOcc[slot] = car
    car.slotIndex = slot
    car.phase = 'driving'
    const p = this.opts.pumpSlot(slot)
    car.setPath([
      new THREE.Vector3(3.2, p.y - 2.5, 0),
      p,
    ], () => this.arriveAtSlot(car))
  }

  /** servis bitti, tesis kullanacak → otoparka çek. Otopark yok/dolu ise false. */
  sendToParking(car: Car): boolean {
    const spots = this.opts.parkSpots()
    if (spots.length === 0) return false
    while (this.parkOcc.length < spots.length) this.parkOcc.push(null)
    let spot = -1
    for (let i = 0; i < spots.length; i++) if (!this.parkOcc[i]) { spot = i; break }
    if (spot < 0) return false
    // pompayı/şarjı hemen boşalt ki sıradaki müşteri girsin
    if (car.slotIndex >= 0) {
      if (car.kind === 'ev') this.evOcc[car.slotIndex] = null
      else this.pumpOcc[car.slotIndex] = null
    }
    car.slotIndex = spot
    this.parkOcc[spot] = car
    car.phase = 'toPark'
    car.beingServed = false
    car.filling = false
    car.hideBubble()
    car.hideBars()
    const p = spots[spot].clone()
    p.z = 0
    car.setPath([
      new THREE.Vector3(3.0, car.group.position.y, 0),
      new THREE.Vector3(3.0, PARK_LANE_Y, 0),
      new THREE.Vector3(p.x, PARK_LANE_Y, 0),
      p,
    ], () => {
      car.phase = 'parked'
      car.group.rotation.z = -Math.PI / 2
    })
    return true
  }

  /** slotta duran ya da slota sürmekte olan araçları uğurla (ünite taşınırken) */
  evictSlot(kind: 'fuel' | 'ev', i: number) {
    for (const car of [...this.cars]) {
      if (car.slotIndex !== i) continue
      if (kind === 'ev' ? car.kind !== 'ev' : car.kind === 'ev') continue
      if (car.phase === 'driving' || car.phase === 'atPump') this.releaseCar(car)
    }
  }

  /** son çare: aracı sahneden sil, tuttuğu her yeri boşalt — hiçbir şey sonsuza dek tıkalı kalamaz */
  private evaporate(car: Car) {
    if (car.waitIndex >= 0) { this.waitOcc[car.waitIndex] = null; car.waitIndex = -1 }
    if (car.truckSlot >= 0) { this.truckOcc[car.truckSlot] = null; car.truckSlot = -1 }
    if (car.slotIndex >= 0) {
      if (car.phase === 'parked' || car.phase === 'toPark') this.parkOcc[car.slotIndex] = null
      else if (car.kind === 'ev') this.evOcc[car.slotIndex] = null
      else this.pumpOcc[car.slotIndex] = null
      car.slotIndex = -1
    }
    car.hideBubble()
    car.dispose(this.scene)
  }

  /** 6 sn kıpırdayamayan aracı ayır, katıdan çıkar, rotasını tazele */
  private recoverStuck(car: Car) {
    // üst üste binmiş araçları ayır
    for (const o of this.cars) {
      if (o === car || o.phase === 'gone') continue
      const d = car.group.position.distanceTo(o.group.position)
      if (d < 1.1) {
        const away = new THREE.Vector3().subVectors(car.group.position, o.group.position)
        away.z = 0
        if (away.lengthSq() < 1e-4) away.set(0.6, 0.6, 0)
        away.normalize()
        car.group.position.addScaledVector(away, 1.25 - d / 2)
      }
    }
    // katı cisme gömüldüyse en yakın kenardan dışarı it
    for (const s of Car.solids) {
      const dx = car.group.position.x - s.cx
      const dy = car.group.position.y - s.cy
      const px = s.w / 2 + 0.5 - Math.abs(dx)
      const py = s.d / 2 + 0.5 - Math.abs(dy)
      if (px > 0 && py > 0) {
        if (px < py) car.group.position.x += Math.sign(dx || 1) * px
        else car.group.position.y += Math.sign(dy || 1) * py
      }
    }
    car.holdTime = 0
    car.overrideT = 0
    // hedefe göre temiz rota
    if (car.phase === 'driving' && car.slotIndex >= 0 && car.kind !== 'ev') {
      const slot = this.opts.pumpSlot(car.slotIndex)
      car.setPath([new THREE.Vector3(3.2, slot.y - 2.5, 0), slot.clone()], () => this.arriveAtSlot(car))
    } else if (car.phase === 'driving' && car.slotIndex >= 0 && car.kind === 'ev') {
      const slot = this.opts.evSlot(car.slotIndex)
      car.setPath([new THREE.Vector3(3.2, slot.y - 2.5, 0), slot.clone()], () => this.arriveAtSlot(car))
    } else if (car.phase === 'toPark' && car.truckSlot >= 0) {
      this.leaveTruckPark(car)
    } else if (car.phase !== 'atPump' && car.phase !== 'parked' && car.phase !== 'waiting') {
      this.releaseCar(car)
    }
  }

  releaseCar(car: Car) {
    if (car.waitIndex >= 0) {
      this.waitOcc[car.waitIndex] = null
      car.waitIndex = -1
    }
    const fromPark = car.phase === 'parked' || car.phase === 'toPark'
    if (car.slotIndex >= 0) {
      if (fromPark) this.parkOcc[car.slotIndex] = null
      else if (car.kind === 'ev') this.evOcc[car.slotIndex] = null
      else this.pumpOcc[car.slotIndex] = null
    }
    car.slotIndex = -1
    car.phase = 'leaving'
    car.beingServed = false
    car.filling = false
    car.hideBubble()
    car.hideBars()
    const outY = this.opts.gateOutY()
    if (fromPark) {
      car.setPath([
        new THREE.Vector3(car.group.position.x, PARK_LANE_Y, 0),
        new THREE.Vector3(3.0, PARK_LANE_Y, 0),
        new THREE.Vector3(4.2, outY, 0),
        new THREE.Vector3(LANE_NEAR, outY + 4, 0),
        new THREE.Vector3(LANE_NEAR, 44, 0),
      ])
      return
    }
    const y = car.group.position.y
    car.setPath([
      new THREE.Vector3(3.4, Math.min(y + 3, outY - 1.8), 0),
      new THREE.Vector3(4.2, outY, 0),
      new THREE.Vector3(LANE_NEAR, outY + 4, 0),
      new THREE.Vector3(LANE_NEAR, 44, 0),
    ])
  }
}
