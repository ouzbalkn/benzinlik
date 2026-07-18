import * as THREE from 'three'
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
  ctx.font = '800 76px -apple-system, sans-serif'
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

import { ModelLib, cloneModel } from './models'

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
  slotIndex = -1
  /** rezerve edilen bekleme noktası (yoksa -1) */
  waitIndex = -1
  /** öndeki araca çok yaklaştıysa bu karede bekle (üst üste binme yok) */
  hold = false
  holdTime = 0
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

  constructor(scene: THREE.Scene, lib: ModelLib | null, kind: CarKind) {
    this.kind = kind
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
      this.group = cloneModel(lib.cars[Math.floor(Math.random() * lib.cars.length)])
    } else {
      const kinds: BodyKind[] = ['sedan', 'sedan', 'hatch', 'hatch', 'suv']
      const bk = kinds[Math.floor(Math.random() * kinds.length)]
      this.group = buildCarMesh(bk, CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)])
    }
    this.group.userData.car = this
    const fr = Math.random()
    this.demandType = fr < 0.4 ? 'benzin' : fr < 0.8 ? 'dizel' : 'lpg'
    this.demandAmount = DEMAND_AMOUNTS[Math.floor(Math.random() * DEMAND_AMOUNTS.length)]
    this.demandLiters = this.demandAmount / FUEL_PRICE[this.demandType]
    this.demandKwh = 20 + Math.floor(Math.random() * 9) * 5 // 20..60
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
    return this.nozzle ? this.filled * FUEL_PRICE[this.nozzle] : 0
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

  showBubble() {
    if (this.bubble) return
    if (this.kind === 'ev') {
      this.bubble = textSprite(`⚡ ${this.demandKwh} kWh`, '#35c7d6')
    } else {
      const accent = this.demandType === 'benzin' ? '#27a05a' : this.demandType === 'dizel' ? '#e8862e' : '#2f6fed'
      this.bubble = textSprite(`₺${this.demandAmount} ${FUEL_LABEL[this.demandType]}`, accent)
    }
    this.bubble.position.z = 2.85
    this.group.add(this.bubble)
  }

  hideBubble() {
    if (this.bubble) { this.group.remove(this.bubble); this.bubble = null }
  }

  showFeedback(emoji: string) {
    if (this.feedback) this.group.remove(this.feedback)
    this.feedback = emojiSprite(emoji)
    this.feedback.position.z = 2.6
    this.group.add(this.feedback)
    this.feedbackT = 2.5
  }

  update(dt: number) {
    if (this.path.length > 0 && !this.hold) {
      const pos = this.group.position
      const target = this.path[0]
      const d = new THREE.Vector3().subVectors(target, pos)
      d.z = 0
      const dist = d.length()
      const step = CAR_SPEED * dt
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
        pos.addScaledVector(d, step)
        const targetYaw = Math.atan2(d.y, d.x)
        let diff = targetYaw - this.group.rotation.z
        while (diff > Math.PI) diff -= Math.PI * 2
        while (diff < -Math.PI) diff += Math.PI * 2
        this.group.rotation.z += diff * Math.min(1, dt * 8)
      }
    }

    if ((this.phase === 'waiting' || this.phase === 'atPump') && !this.beingServed) {
      this.patience -= dt
    }
    const p = this.patienceFrac
    // bar yalnızca sabır gerçekten işlerken görünsün — balonun altında başıboş çizgi olmasın
    const showBar = this.barsOn && !this.beingServed && p <= 0.97
      && (this.phase === 'waiting' || this.phase === 'atPump')
    this.patienceBg.visible = showBar
    this.patienceFill.visible = showBar
    this.patienceFill.scale.x = 1.5 * p
    this.patienceFill.position.x = -(1.5 * (1 - p)) / 2
    const color = p > 0.5 ? 0x4dc36b : p > 0.25 ? 0xe0b13e : 0xd64545
    ;(this.patienceFill.material as THREE.SpriteMaterial).color.setHex(color)

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
  private leaving = false
  done = false
  unloading = false

  constructor(scene: THREE.Scene, lib: ModelLib | null, fuel: FuelType = 'benzin', queueIdx = 0) {
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
    const parkY = TANK_POS.y + [0, 2.4, -2.4][queueIdx % 3]
    this.path = [
      new THREE.Vector3(LANE_NEAR, APRON_IN_Y - 3.5, 0),
      new THREE.Vector3(4.2, APRON_IN_Y, 0),
      new THREE.Vector3(TANK_POS.x + 3.2, parkY, 0),
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
        // trafik nezaketi: önünde araç varsa tanker bekler
        if (isBlocked?.(pos, d)) return delivered
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
          new THREE.Vector3(3.6, -4.5, 0),
          new THREE.Vector3(4.2, APRON_OUT_Y, 0),
          new THREE.Vector3(LANE_NEAR, APRON_OUT_Y + 4, 0),
          new THREE.Vector3(LANE_NEAR, 44, 0),
        ]
      }
    } else {
      this.done = true
    }
    return delivered
  }
}

const WAIT_SPOTS = [new THREE.Vector3(3.4, -4.6, 0), new THREE.Vector3(3.4, -7.4, 0)]
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
  onCarReady: (car: Car) => void
  onCarLost: (car: Car) => void
}

export class CarManager {
  cars: Car[] = []
  private nearTimer = 1
  private farTimer = 2.5
  private pumpOcc: (Car | null)[] = [null, null, null, null]
  private evOcc: (Car | null)[] = [null, null, null, null]
  private parkOcc: (Car | null)[] = []
  private waitOcc: (Car | null)[] = [null, null]

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
        const rel = new THREE.Vector3().subVectors(o.group.position, c.group.position)
        rel.z = 0
        const forward = rel.dot(dir)
        if (forward < 0.4 || forward > 2.8) continue
        const lateral = rel.addScaledVector(dir, -forward).length()
        if (lateral < 1.25) { c.hold = true; blockers.set(c, o); break }
      }
      if (!c.hold) {
        for (const ob of this.opts.extraObstacles()) {
          const rel = new THREE.Vector3().subVectors(ob, c.group.position)
          rel.z = 0
          const forward = rel.dot(dir)
          if (forward < 0.2 || forward > 3.2) continue
          if (rel.addScaledVector(dir, -forward).length() < 1.5) { c.hold = true; break }
        }
      }
    }
    // karşılıklı kilitlenme: ikisi de birbirini bekliyorsa biri yol alır
    for (const [c, o] of blockers) {
      if (blockers.get(o) === c && c.hold && o.hold) o.hold = false
    }
    // uzun süre sıkışan araç kendini kurtarır (gridlock sigortası)
    for (const c of this.cars) {
      if (c.hold) {
        c.holdTime += dt
        if (c.holdTime > 6) { c.hold = false; c.holdTime = 4 }
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
      car.update(dt)
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
    const car = new Car(this.scene, this.lib, isEv ? 'ev' : 'fuel')
    car.lane = lane
    car.phase = 'transit'
    if (lane === 'near') {
      car.group.position.set(LANE_NEAR, -40, 0)
      car.group.rotation.z = Math.PI / 2
      car.setPath([new THREE.Vector3(LANE_NEAR, 44, 0)])
      car.wantsEnter = Math.random() < this.opts.entryChance()
    } else {
      car.group.position.set(LANE_FAR, 40, 0)
      car.group.rotation.z = -Math.PI / 2
      car.setPath([new THREE.Vector3(LANE_FAR, -44, 0)])
    }
    this.cars.push(car)
  }

  /** rampadan girip hedef noktaya giden yol */
  private entryPath(p: THREE.Vector3): THREE.Vector3[] {
    const apronY = p.y < -10 ? APRON_SOUTH_Y : APRON_IN_Y
    return [
      new THREE.Vector3(LANE_NEAR, apronY - 3.5, 0),
      new THREE.Vector3(4.2, apronY, 0),
      new THREE.Vector3(3.2, p.y - 2.5, 0),
      p.clone(),
    ]
  }

  private tryEnter(car: Car) {
    if (car.kind === 'ev') {
      let slot = -1
      for (let i = 0; i < this.opts.evCount(); i++) {
        if (!this.evOcc[i] && !this.opts.isChargerBroken(i)) { slot = i; break }
      }
      if (slot < 0) return // şarj yeri yok, yoluna devam
      this.evOcc[slot] = car
      car.slotIndex = slot
      car.phase = 'driving'
      car.setPath(this.entryPath(EV_SLOTS_POS[slot]), () => this.arriveAtSlot(car))
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
      car.setPath(this.entryPath(PUMP_SLOTS_POS[slot]), () => this.arriveAtSlot(car))
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
        new THREE.Vector3(LANE_NEAR, APRON_IN_Y - 3.5, 0),
        new THREE.Vector3(4.2, APRON_IN_Y, 0),
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
    const p = PUMP_SLOTS_POS[slot]
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
    if (fromPark) {
      car.setPath([
        new THREE.Vector3(car.group.position.x, PARK_LANE_Y, 0),
        new THREE.Vector3(3.0, PARK_LANE_Y, 0),
        new THREE.Vector3(4.2, APRON_OUT_Y, 0),
        new THREE.Vector3(LANE_NEAR, APRON_OUT_Y + 4, 0),
        new THREE.Vector3(LANE_NEAR, 44, 0),
      ])
      return
    }
    const y = car.group.position.y
    car.setPath([
      new THREE.Vector3(3.4, Math.min(y + 3, APRON_OUT_Y - 1.8), 0),
      new THREE.Vector3(4.2, APRON_OUT_Y, 0),
      new THREE.Vector3(LANE_NEAR, APRON_OUT_Y + 4, 0),
      new THREE.Vector3(LANE_NEAR, 44, 0),
    ])
  }
}
