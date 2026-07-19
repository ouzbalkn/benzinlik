import * as THREE from 'three'
import { t } from './i18n'
import { StaticLib, fitModel } from './models'
import { PARCEL_COLS, PARCEL_ROWS } from './state'

// Koordinat sistemi: z yukarı, y sağa, x kameraya doğru.
// Ana arsa: x -6.5..5, y -10..10. Güney arsa y -24..-10, kuzey arsa y 10..24.
// Yol arsadan ayrı: arada yeşil bant (x 5..5.9) ve giriş/çıkış rampaları var.

export const ROAD_X = 7.9
export const LANE_NEAR = 6.95
export const LANE_FAR = 8.85
export const PUMP_SLOTS_POS = [
  new THREE.Vector3(1.8, -2.2, 0), new THREE.Vector3(1.8, 2.2, 0),
  new THREE.Vector3(1.8, -14, 0), new THREE.Vector3(1.8, -18, 0),
]
export const EV_SLOTS_POS = [
  new THREE.Vector3(1.8, 6.2, 0), new THREE.Vector3(1.8, 8.8, 0),
  new THREE.Vector3(1.8, -11.8, 0), new THREE.Vector3(1.8, -21.5, 0),
]
export const TANK_POS = new THREE.Vector3(-5.5, -6.5, 0)
/** araçların kullandığı giriş/çıkış rampaları */
export const APRON_IN_Y = -8
export const APRON_OUT_Y = 8
export const APRON_SOUTH_Y = -16

const lam = (color: number) => new THREE.MeshLambertMaterial({ color })

function glow(color: number, intensity: number) {
  return new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: intensity })
}

function box(w: number, d: number, h: number, color: number, x: number, y: number, z: number, parent: THREE.Object3D,
             mat?: THREE.Material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), mat ?? lam(color))
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  parent.add(m)
  return m
}

function cyl(r: number, len: number, color: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z', parent: THREE.Object3D) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16), lam(color))
  if (axis === 'x') m.rotation.z = Math.PI / 2
  if (axis === 'z') m.rotation.x = Math.PI / 2
  m.position.set(x, y, z)
  m.castShadow = true
  parent.add(m)
  return m
}

/** dir yönüne bakan (varsayılan +x), canvas'a çizilmiş pano */
function canvasPanel(w: number, h: number, px: number, py: number,
                     draw: (ctx: CanvasRenderingContext2D, W: number, H: number) => void,
                     dir?: THREE.Vector3): THREE.Mesh {
  const c = document.createElement('canvas')
  c.width = px; c.height = py
  draw(c.getContext('2d')!, px, py)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex, transparent: true }))
  m.lookAt(dir ?? new THREE.Vector3(1, 0, 0))
  return m
}

/** koyu pill üstüne beyaz yazı — bina isim etiketi */
function labelSprite(text: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 384; c.height = 96
  const ctx = c.getContext('2d')!
  let fs = 44
  ctx.font = `800 ${fs}px -apple-system, sans-serif`
  while (fs > 22 && ctx.measureText(text).width > 330) {
    fs -= 2
    ctx.font = `800 ${fs}px -apple-system, sans-serif`
  }
  const w = ctx.measureText(text).width + 56
  const x0 = (384 - w) / 2
  ctx.fillStyle = 'rgba(13, 18, 26, 0.88)'
  ctx.beginPath(); ctx.roundRect(x0, 14, w, 68, 34); ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 3; ctx.stroke()
  ctx.fillStyle = '#eef3f9'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(text, 192, 50)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, color: 0xdedede }))
  sp.scale.set(2.5, 0.62, 1)
  return sp
}

/** sarı para rozeti — tıklanınca kasaya toplanır */
function cashSprite(text: string, id: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 320; c.height = 104
  const ctx = c.getContext('2d')!
  ctx.font = '800 52px -apple-system, sans-serif'
  const w = ctx.measureText(text).width + 92
  const x0 = (320 - w) / 2
  ctx.fillStyle = '#e8b62e'
  ctx.beginPath(); ctx.roundRect(x0, 10, w, 84, 42); ctx.fill()
  ctx.strokeStyle = '#a8791a'; ctx.lineWidth = 6; ctx.stroke()
  // jeton
  ctx.fillStyle = '#f7dd8a'
  ctx.beginPath(); ctx.arc(x0 + 42, 52, 26, 0, 7); ctx.fill()
  ctx.strokeStyle = '#a8791a'; ctx.lineWidth = 5; ctx.stroke()
  ctx.fillStyle = '#7a5510'
  ctx.font = '800 34px -apple-system, sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText('₺', x0 + 42, 54)
  ctx.fillStyle = '#3a2c05'
  ctx.font = '800 52px -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(text, x0 + 76, 55)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, color: 0xe2e2e2 }))
  sp.scale.set(2.3, 0.75, 1)
  sp.userData.cashFor = id
  return sp
}

/** kırmızı uyarı pill'i — tıklanınca tamir/bakım yapılır */
function warnSprite(text: string, maintId: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 448; c.height = 104
  const ctx = c.getContext('2d')!
  let fs = 46
  ctx.font = `800 ${fs}px -apple-system, sans-serif`
  while (fs > 24 && ctx.measureText(text).width > 380) {
    fs -= 2
    ctx.font = `800 ${fs}px -apple-system, sans-serif`
  }
  const w = ctx.measureText(text).width + 60
  const x0 = (448 - w) / 2
  ctx.fillStyle = '#e5484d'
  ctx.beginPath(); ctx.roundRect(x0, 12, w, 80, 40); ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(text, 224, 54)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, color: 0xe2e2e2 }))
  sp.scale.set(3.1, 0.72, 1)
  sp.userData.warnFor = maintId
  return sp
}

/** hafif benekli zemin dokusu (AI dokusu yüklenemezse yedek) */
function noiseTex(base: string, specks: [string, number][], repeat: number): THREE.Texture {
  const size = 256
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  for (const [color, count] of specks) {
    ctx.fillStyle = color
    for (let i = 0; i < count; i++) {
      ctx.globalAlpha = 0.2 + Math.random() * 0.35
      const r = 0.6 + Math.random() * 1.8
      ctx.fillRect(Math.random() * size, Math.random() * size, r, r)
    }
  }
  ctx.globalAlpha = 1
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

interface NightMat { mat: THREE.MeshLambertMaterial; day: number; night: number; owner: string }

function buildPumpMesh(nightMats: NightMat[]): THREE.Group {
  const g = new THREE.Group()
  box(0.8, 1.15, 0.1, 0x8f979e, 0, 0, 0.05, g)
  box(0.6, 0.95, 1.3, 0xe04848, 0, 0, 0.75, g)
  box(0.64, 0.99, 0.1, 0xc23b3b, 0, 0, 1.45, g)
  box(0.62, 0.97, 0.16, 0xf0f0ec, 0, 0, 0.5, g)
  box(0.05, 0.66, 0.46, 0x1c2530, 0.3, 0, 1.12, g)
  const screen = glow(0xa8dcf0, 0.55)
  box(0.03, 0.54, 0.34, 0xa8dcf0, 0.33, 0, 1.12, g, screen)
  nightMats.push({ mat: screen, day: 0.55, night: 0.95, owner: 'pump' })
  for (const [sy, c] of [[0.52, 0x2fa05a], [-0.52, 0xe8862e]] as const) {
    box(0.34, 0.08, 0.5, 0x2b2f33, 0, sy, 1.0, g)
    box(0.12, 0.1, 0.3, c, 0.12, sy, 1.05, g)
    cyl(0.03, 0.35, 0x23272b, -0.1, sy, 0.8, 'z', g)
  }
  return g
}

function buildTreeProc(x: number, y: number, scale: number, parent: THREE.Object3D) {
  const g = new THREE.Group()
  cyl(0.14, 0.9, 0x7a5738, 0, 0, 0.45, 'z', g)
  const f1 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1), lam(0x5f9e4e))
  f1.position.z = 1.4; f1.castShadow = true; g.add(f1)
  const f2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), lam(0x6fb35a))
  f2.position.set(0.25, 0.2, 1.95); f2.castShadow = true; g.add(f2)
  g.position.set(x, y, 0)
  g.scale.setScalar(scale)
  parent.add(g)
}

function buildLampProc(x: number, y: number, parent: THREE.Object3D) {
  const g = new THREE.Group()
  cyl(0.06, 3.0, 0x59616b, 0, 0, 1.5, 'z', g)
  box(0.5, 0.14, 0.08, 0x59616b, 0.28, 0, 3.0, g)
  box(0.3, 0.2, 0.1, 0xfff3c4, 0.5, 0, 2.97, g, glow(0xfff3c4, 1.0))
  g.position.set(x, y, 0)
  parent.add(g)
}

function stain(x: number, y: number, r: number, parent: THREE.Object3D) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 18),
    new THREE.MeshLambertMaterial({ color: 0x2b2f33, transparent: true, opacity: 0.16 }))
  m.position.set(x, y, 0.03)
  parent.add(m)
}

export interface Building {
  id: string
  name: string
  group: THREE.Object3D
  label: THREE.Sprite
  warn: THREE.Sprite | null
  warnText: string | null
  cash: THREE.Sprite | null
  cashText: string | null
  labelZ: number
}

export class World {
  scene = new THREE.Scene()
  stationName = t('BENZİNLİK')
  private priceView: [number, number, number, number] = [10, 9, 6, 0]
  buildings: Building[] = []
  private closedFlag = false
  private signLevel = 0
  private signGroup: THREE.Group | null = null
  private marketGroup: THREE.Group | null = null
  private toiletGroup: THREE.Group | null = null
  private batteryGroup: THREE.Group | null = null
  private tankGroup: THREE.Group
  private concreteMat: THREE.MeshLambertMaterial
  private nightMats: NightMat[] = []
  private nightLights: THREE.PointLight[] = []
  private steam: { mesh: THREE.Mesh; offset: number; drift: number }[] = []
  private steamT = 0
  private sun: THREE.DirectionalLight
  private hemi: THREE.HemisphereLight
  private grid: THREE.GridHelper
  private batteryPos = new THREE.Vector2(-2.5, 8.2)

  constructor(private statics: StaticLib | null) {
    const s = this.scene
    s.background = new THREE.Color(0xbfe0ee)

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1)
    s.add(this.hemi)
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2)
    this.sun = sun
    sun.position.set(18, -12, 26)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024) // performans: geniş harita + yumuşak gölgede 1024 yeterli
    const cam = sun.shadow.camera
    cam.left = -55; cam.right = 55; cam.top = 55; cam.bottom = -55; cam.far = 140
    s.add(sun)

    // yerleştirme modu grid'i (1 birimlik kareler)
    this.grid = new THREE.GridHelper(110, 110, 0xffffff, 0xffffff)
    this.grid.rotation.x = Math.PI / 2
    this.grid.position.z = 0.04
    ;(this.grid.material as THREE.Material).transparent = true
    ;(this.grid.material as THREE.Material).opacity = 0.14
    this.grid.visible = false
    s.add(this.grid)

    // dokulu zeminler: nano banana PNG'leri; yüklenemezse prosedürel benek
    const aiGround = (url: string, rx: number, ry: number, fallback: THREE.Texture) => {
      const mat = new THREE.MeshLambertMaterial({ map: fallback })
      new THREE.TextureLoader().load(url, t => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping
        t.repeat.set(rx, ry)
        t.colorSpace = THREE.SRGBColorSpace
        mat.map = t
        mat.needsUpdate = true
      }, undefined, () => {})
      return mat
    }
    const grassMat = aiGround('/gen/ground_grass.png', 18, 20,
      noiseTex('#86b06a', [['#79a25e', 900], ['#93bd77', 900], ['#6d9454', 300]], 30))
    this.concreteMat = aiGround('/gen/ground_concrete.png', 2.5, 4.5,
      noiseTex('#9aa1a9', [['#8d949c', 700], ['#a8afb7', 700], ['#7e858d', 200]], 8))
    const roadMat = aiGround('/gen/ground_asphalt.png', 1.5, 38,
      noiseTex('#4a5058', [['#555c66', 800], ['#3f454c', 800], ['#606874', 200]], 6))

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(190, 170), grassMat)
    ground.position.x = 8
    ground.receiveShadow = true
    s.add(ground)

    const lot = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 20), this.concreteMat)
    lot.position.set(-0.75, 0, 0.015)
    lot.receiveShadow = true
    s.add(lot)
    this.paveJoints(-6.5, 5, -10, 10)
    this.kerbs.set('0,1:W', box(0.25, 20.4, 0.16, 0xd8dbde, -6.55, 0, 0.08, s))

    // yol (arada yeşil bant kalır) + şerit çizgileri
    // gidiş-geliş yol: çift sarı orta çizgi + şerit içi beyaz kesikler + kenar çizgileri
    const road = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 100), roadMat)
    road.position.set(ROAD_X, 0, 0.01)
    road.receiveShadow = true
    s.add(road)
    for (const off of [-0.1, 0.1]) {
      const center = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 100), lam(0xe0b13e))
      center.position.set(ROAD_X + off, 0, 0.022)
      s.add(center)
    }
    for (const off of [-2.16, 2.16]) {
      const edgeLine = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 100), lam(0xe8e4d8))
      edgeLine.position.set(ROAD_X + off, 0, 0.02)
      s.add(edgeLine)
    }
    for (let y = -48; y < 49; y += 5) {
      for (const off of [-1.1, 1.1]) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 1.5), lam(0xd9d5c9))
        dash.position.set(ROAD_X + off, y, 0.02)
        s.add(dash)
      }
    }


    this.buildOffice()
    this.buildGate('in')
    this.buildGate('out')

    // ana yakıt tankı (küre) + borular
    this.tankGroup = new THREE.Group()
    s.add(this.tankGroup)
    this.buildTankCluster(0)
    this.register('tank', t('YAKIT TANKI'), this.tankGroup, 3.8)

    // çevre
    this.placeTree(-9.5, -13, 1.2)
    this.placeTree(-10.5, 2, 1.0)
    this.placeTree(-8.5, 12.5, 1.3)
    this.placeTree(-9, 20, 1.0)
    this.placeTree(12.4, -16, 1.1)
    this.placeTree(12.7, 9, 1.2)
    this.placeTree(12.1, 22, 1.0)
    // lambalar yol-istasyon arasındaki yeşil bantta (araç rotalarının tamamen dışında)
    this.placeLamp(5.45, -5.5)
    this.placeLamp(5.45, 5.5)
    stain(1.9, -1.6, 0.45, s)
    stain(1.5, -3.0, 0.3, s)
    stain(2.2, 2.8, 0.4, s)
    stain(-2.5, 6.5, 0.5, s)

    // çim dokusuna hayat: taşlar ve çiçekler
    const rockGeo = new THREE.IcosahedronGeometry(0.22, 0)
    const rockMat = lam(0x9aa1a9)
    for (const [rx, ry, rs] of [[-8.2, -16.5, 1], [-10.8, 7.6, 1.3], [12.6, -12.2, 0.9], [13.4, 15.8, 1.1],
      [-8.9, 16.8, 0.8], [12.1, 2.3, 1.2], [-11.6, -5.2, 1]] as const) {
      const rock = new THREE.Mesh(rockGeo, rockMat)
      rock.position.set(rx, ry, 0.12 * rs)
      rock.scale.set(rs, rs, rs * 0.6)
      rock.rotation.z = rx * 2.1
      rock.castShadow = true
      s.add(rock)
      this.decor.push({ obj: rock, x: rx, y: ry })
    }
    const flowerColors = [0xe8e6e1, 0xf2c14e, 0xe08bb0]
    for (const [fx, fy] of [[-9.8, -11.4], [-8.4, 14.2], [12.9, -17.6], [11.8, 12.4], [-11.2, 1.2],
      [13.6, 6.7], [-9.1, 22.4], [12.3, 20.2], [-10.4, -20.8]] as const) {
      const fm = lam(flowerColors[Math.floor((fx * fy * 7.13 % 1 + 1) * 3) % 3])
      for (let k = 0; k < 3; k++) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), fm)
        p.position.set(fx + Math.sin(k * 2.4 + fx) * 0.5, fy + Math.cos(k * 1.9 + fy) * 0.5, 0.09)
        s.add(p)
        this.decor.push({ obj: p, x: p.position.x, y: p.position.y })
      }
    }

    this.buildCountryside()
    this.setSign(0)
    this.addPump(0)
  }

  /** çevre dolgusu: tarlalar, bağ-bahçe, balyalar, çitler, gölet */
  private buildCountryside() {
    const s = this.scene
    const soil = lam(0x8a6b45)
    const soilDark = lam(0x775a39)
    const crop = lam(0x5f9e4e)
    const vine = lam(0x4a7d3f)

    const field = (cx: number, cy: number, w: number, d: number, planted: boolean) => {
      const base = new THREE.Mesh(new THREE.PlaneGeometry(w, d), soil)
      base.position.set(cx, cy, 0.012)
      base.receiveShadow = true
      s.add(base)
      for (let fy = -d / 2 + 0.8; fy < d / 2 - 0.4; fy += 1.6) {
        const furrow = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.8, 0.55), soilDark)
        furrow.position.set(cx, cy + fy, 0.018)
        s.add(furrow)
        if (planted) {
          for (let fx = -w / 2 + 1.2; fx < w / 2 - 0.8; fx += 1.5) {
            const p = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 5), crop)
            p.position.set(cx + fx, cy + fy, 0.24)
            p.scale.z = 0.75
            s.add(p)
          }
        }
      }
      // ahşap çit (yol tarafı hariç çevre)
      const rail = lam(0x8a6a48)
      for (const [rx, ry, rw, rd] of [
        [cx, cy + d / 2, w, 0.14], [cx, cy - d / 2, w, 0.14],
        [cx - w / 2, cy, 0.14, d], [cx + w / 2, cy, 0.14, d],
      ] as const) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(rw, rd, 0.1), rail)
        m.position.set(rx, ry, 0.42)
        s.add(m)
      }
      for (let px = -w / 2; px <= w / 2; px += 3) {
        cyl(0.07, 0.5, 0x77593c, cx + px, cy - d / 2, 0.25, 'z', s)
        cyl(0.07, 0.5, 0x77593c, cx + px, cy + d / 2, 0.25, 'z', s)
      }
    }

    // bağ: sıra sıra asma
    const vineyard = (cx: number, cy: number, rows: number, len: number) => {
      for (let r0 = 0; r0 < rows; r0++) {
        const ry = cy + r0 * 2 - rows
        for (let vx = -len / 2; vx < len / 2; vx += 1.3) {
          const v = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.9), vine)
          v.position.set(cx + vx, ry, 0.45)
          v.castShadow = true
          s.add(v)
        }
      }
    }

    // meyve bahçesi
    const orchard = (cx: number, cy: number, cols: number, rows: number) => {
      for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
        this.placeTree(cx + a * 3.4, cy + b * 3.4, 0.85 + ((a * 7 + b * 3) % 4) * 0.08)
      }
    }

    // saman balyaları
    const bales = (cx: number, cy: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const bale = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.9, 12), lam(0xd9b86a))
        bale.rotation.z = Math.PI / 2
        bale.position.set(cx + i * 1.9 + (i % 2) * 0.5, cy + (i % 2) * 1.4, 0.55)
        bale.castShadow = true
        s.add(bale)
      }
    }

    // gölet
    const pond = (cx: number, cy: number, r: number) => {
      const w = new THREE.Mesh(new THREE.CircleGeometry(r, 26), lam(0x5f9fc4))
      w.position.set(cx, cy, 0.014)
      w.scale.y = 0.72
      s.add(w)
      const rim = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.5, 26), lam(0xc9bfa5))
      rim.position.set(cx, cy, 0.013)
      rim.scale.y = 0.72
      s.add(rim)
      for (let i = 0; i < 5; i++) {
        const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), lam(0x9aa1a9))
        rock.position.set(cx + Math.cos(i * 1.9) * (r + 0.4), cy + Math.sin(i * 1.9) * (r + 0.4) * 0.72, 0.2)
        rock.castShadow = true
        s.add(rock)
      }
    }

    // yerleşim: parseller x -29.5..45.4 / y -24..24, yol x 5.6..10.2 — hepsi dışarıda
    field(-42, 10, 16, 11, true)
    field(-41, -13, 14, 10, false)
    field(57, -4, 15, 12, true)
    field(20, 34, 18, 10, false)
    field(-8, -34, 18, 10, true)
    field(34, -34, 14, 9, false)
    vineyard(-42, 30, 4, 14)
    vineyard(56, 18, 3, 12)
    orchard(48, 28, 3, 3)
    orchard(-52, -30, 4, 2)
    orchard(-56, 16, 2, 4)
    bales(-38, -25.5, 4)
    bales(52, -20, 3)
    pond(-36, -30 + 60, 4) // kuzeybatı gölet (y=30)
    pond(30, -30, 3.2)
  }

  /** oyuncu fiyat değiştirince tabela güncellenir */
  setPrices(benzin: number, dizel: number, lpg: number, elec = 0) {
    this.priceView = [benzin, dizel, lpg, elec]
    this.setSign(this.signLevel)
  }

  /** istasyon kapalı/açık — tabela yeniden çizilir */
  setClosed(v: boolean) {
    this.closedFlag = v
    this.setSign(this.signLevel)
  }

  // ---- kayıt / etiket / uyarı ----

  private register(id: string, name: string, group: THREE.Object3D, labelZ: number) {
    const label = labelSprite(name)
    label.position.z = labelZ
    label.visible = false // isim sadece bina seçilince görünür
    group.add(label)
    group.userData.buildingId = id
    this.buildings.push({ id, name, group, label, warn: null, warnText: null, cash: null, cashText: null, labelZ })
  }

  /** seçili binanın isim etiketini gösterir, diğerlerini gizler */
  setSelected(id: string | null) {
    for (const b of this.buildings) b.label.visible = b.id === id
  }

  /** binaya gece yanan sıcak pencere ışıkları ekler */
  private facadeLights(g: THREE.Object3D, positions: [number, number, number][], w = 0.9, h = 0.55) {
    for (const [x, y, z] of positions) {
      const m = glow(0xffd989, 0.03)
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m)
      p.lookAt(new THREE.Vector3(1, 0, 0))
      p.position.set(x, y, z)
      g.add(p)
      this.nightMats.push({ mat: m, day: 0.03, night: 1.05, owner: 'bldg' })
    }
  }

  /** 0 = gündüz, 1 = gece — ışıklar geceleri yanar */
  setNight(f: number) {
    this.sun.intensity = 2.2 - 1.55 * f
    this.sun.color.setHex(f > 0.5 ? 0xb8c8ff : 0xfff0d8)
    this.hemi.intensity = 1.1 - 0.5 * f
    const day = new THREE.Color(0xbfe0ee)
    const night = new THREE.Color(0x1a2a44)
    ;(this.scene.background as THREE.Color).copy(day.lerp(night, f))
    for (const n of this.nightMats) {
      n.mat.emissiveIntensity = n.day + (n.night - n.day) * f
    }
    for (const l of this.nightLights) l.intensity = 17 * f
  }

  showGrid(v: boolean) {
    this.grid.visible = v
  }

  /** her kare çağrılır: buhar animasyonu vb. */
  update(dt: number) {
    this.steamT += dt
    for (const p of this.steam) {
      const t = (this.steamT * 0.3 + p.offset) % 1
      p.mesh.position.set(p.drift * t, p.drift * t * 0.6, 4.8 + t * 2.4)
      const sc = 0.55 + t * 1.1
      p.mesh.scale.setScalar(sc)
      ;(p.mesh.material as THREE.MeshLambertMaterial).opacity = 0.7 * (1 - t)
    }
  }

  private unregister(id: string) {
    this.buildings = this.buildings.filter(b => b.id !== id)
  }

  /** kumbara rozetleri: id → tutar; tıklanınca toplanır */
  syncCash(list: Map<string, number>) {
    for (const b of this.buildings) {
      const amt = list.get(b.id)
      const text = amt ? `₺${Math.round(amt)}` : null
      if (text && b.cashText !== text) {
        if (b.cash) b.group.remove(b.cash)
        b.cash = cashSprite(text, b.id)
        b.cash.position.z = b.labelZ + 0.85
        b.group.add(b.cash)
        b.cashText = text
      } else if (!text && b.cash) {
        b.group.remove(b.cash)
        b.cash = null
        b.cashText = null
      }
    }
  }

  /** main her karede çağırır: id → uyarı metni (tıklanınca maintId tetiklenir) */
  syncWarnings(list: Map<string, { text: string; maintId: string }>) {
    for (const b of this.buildings) {
      const want = list.get(b.id)
      if (want && b.warnText !== want.text) {
        if (b.warn) b.group.remove(b.warn)
        b.warn = warnSprite(want.text, want.maintId)
        b.warn.position.z = b.labelZ + 0.8
        b.group.add(b.warn)
        b.warnText = want.text
      } else if (!want && b.warn) {
        b.group.remove(b.warn)
        b.warn = null
        b.warnText = null
      }
    }
  }

  private makeApron(y: number) {
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 3.4), this.concreteMat)
    apron.position.set(5.5, y, 0.014)
    apron.receiveShadow = true
    this.scene.add(apron)
    return apron
  }

  /** yol kenarı bordürü + rampalar: kapılar nereye taşınırsa boşluk oraya gelir */
  private roadEdgeMeshes: THREE.Object3D[] = []
  private buildRoadEdge() {
    for (const o of this.roadEdgeMeshes) this.scene.remove(o)
    this.roadEdgeMeshes = []
    // bordür kaplanan cepheler: istasyon şeridi + betonlanmış kuzey/güney parseller
    const ranges: [number, number][] = [[-10, 10]]
    if (this.isPavedFn(0, 0)) ranges.push([-24, -10])
    if (this.isPavedFn(0, 2)) ranges.push([10, 24])
    const gaps = [this.gateIn.y, this.gateOut.y]
      .map(y => [y - 1.75, y + 1.75] as [number, number])
      .sort((a, b) => a[0] - b[0])
    for (const [ra, rb] of ranges) {
      const segs: [number, number][] = []
      let cursor = ra
      for (const [g0, g1] of gaps) {
        if (g1 < ra || g0 > rb) continue
        if (g0 > cursor) segs.push([cursor, Math.min(g0, rb)])
        cursor = Math.max(cursor, g1)
      }
      if (cursor < rb) segs.push([cursor, rb])
      for (const [a, b] of segs) {
        if (b - a < 0.3) continue
        this.roadEdgeMeshes.push(box(0.18, b - a, 0.14, 0xd8dbde, 5.02, (a + b) / 2, 0.07, this.scene))
      }
    }
    this.roadEdgeMeshes.push(this.makeApron(this.gateIn.y))
    this.roadEdgeMeshes.push(this.makeApron(this.gateOut.y))
  }

  private addSphereTank(x: number, y: number, R = 1.15, bandColor = 0xd64545) {
    const g = new THREE.Group()
    const sp = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 18), lam(0xdfe3e8))
    sp.position.z = R + 0.55
    sp.castShadow = true
    g.add(sp)
    const band = new THREE.Mesh(new THREE.TorusGeometry(R * 0.97, 0.05, 8, 28), lam(bandColor))
    band.position.z = R + 0.55
    g.add(band)
    for (const [lx, ly] of [[0.6, 0.6], [0.6, -0.6], [-0.6, 0.6], [-0.6, -0.6]] as const) {
      cyl(0.09, R + 0.35, 0x8f979e, lx * (R / 1.15), ly * (R / 1.15), (R + 0.35) / 2, 'z', g)
    }
    cyl(0.05, 0.45, 0x8f979e, 0, 0, R * 2 + 0.6, 'z', g)
    g.position.set(x, y, 0)
    this.tankGroup.add(g)
  }

  /** seviye arttıkça küre sayısı, boyutu ve kuşak rengi değişir */
  buildTankCluster(level: number) {
    this.tankLevelNow = level
    for (const ch of [...this.tankGroup.children]) {
      if (!(ch as THREE.Sprite).isSprite) this.tankGroup.remove(ch)
    }
    this.tankGroup.position.set(this.tankAnchor.x, this.tankAnchor.y, 0)
    const spots: [number, number][] = [[0, 0], [0, 0.9], [0.9, 0], [0.9, 0.9]]
    const R = 0.4 + level * 0.04
    const bandColor = [0xd64545, 0x2f6fed, 0xe8862e, 0x39424e][level]
    for (let i = 0; i <= level; i++) this.addSphereTank(spots[i][0], spots[i][1], R, bandColor)
  }

  /** tank kümesini taşı (merkezden çapaya çevirir) */
  moveTank(center: THREE.Vector2) {
    this.tankAnchor.set(center.x - 0.45, center.y - 0.45)
    this.buildTankCluster(this.tankLevelNow)
  }

  private placeTree(x: number, y: number, scale: number) {
    const proto = scale >= 1.1 ? this.statics?.treeLarge : (this.statics?.treeSmall ?? this.statics?.treeLarge)
    if (proto) {
      const t = fitModel(proto, 1.6 * scale, 'z')
      t.position.set(x, y, 0)
      t.rotation.z = Math.random() * Math.PI * 2
      t.traverse(m => { m.castShadow = true })
      this.scene.add(t)
      this.decor.push({ obj: t, x, y })
    } else {
      const g = new THREE.Group()
      buildTreeProc(0, 0, scale, g)
      g.position.set(x, y, 0)
      this.scene.add(g)
      this.decor.push({ obj: g, x, y })
    }
  }

  private placeLamp(x: number, y: number) {
    if (this.statics?.lamp) {
      const l = fitModel(this.statics.lamp, 3.4, 'z')
      l.position.set(x, y, 0)
      l.rotation.z = Math.PI
      l.traverse(m => { m.castShadow = true })
      this.scene.add(l)
    } else {
      buildLampProc(x, y, this.scene)
    }
    // gece yanan ampul + gerçek ışık kaynağı
    const bulbMat = glow(0xfff3c4, 0.05)
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), bulbMat)
    bulb.position.set(x + 0.6, y, 3.0)
    this.scene.add(bulb)
    this.nightMats.push({ mat: bulbMat, day: 0.05, night: 1.3, owner: 'lamp' })
    const light = new THREE.PointLight(0xffd9a0, 0, 18, 1.7)
    light.position.set(x + 0.6, y, 3.2)
    this.scene.add(light)
    this.nightLights.push(light)
  }

  private placePlanter(x: number, y: number) {
    if (!this.statics?.planter) return
    const p = fitModel(this.statics.planter, 1.3)
    p.position.set(x, y, 0)
    this.scene.add(p)
  }

  private ownedMarks = new Map<string, THREE.Group>()
  /** dinamik servis noktaları: pompa/şarj taşınınca araçlar yeni yere gelir */
  pumpSlots: THREE.Vector3[] = Array.from({ length: 8 }, (_, i) => (PUMP_SLOTS_POS[i] ?? PUMP_SLOTS_POS[3]).clone())
  evSlots: THREE.Vector3[] = Array.from({ length: 8 }, (_, i) => (EV_SLOTS_POS[i] ?? EV_SLOTS_POS[3]).clone())
  tankAnchor = new THREE.Vector2(TANK_POS.x, TANK_POS.y)
  /** taşınabilir giriş/çıkış noktaları (yol kenarı şeridi) */
  gateIn = new THREE.Vector2(4.2, APRON_IN_Y)
  gateOut = new THREE.Vector2(4.2, APRON_OUT_Y)
  private tankLevelNow = 0

  /** beton derzleri: hepsi YOLA DİK (x ekseni boyunca), dünya gridine hizalı —
   *  komşu betonlarda çizgi aynı hizada devam eder, bütünlük bozulmaz */
  private paveJoints(x0: number, x1: number, y0: number, y1: number) {
    const SPACING = 5
    const yStart = Math.ceil((y0 + 0.5) / SPACING) * SPACING
    for (let y = yStart; y <= y1 - 0.5; y += SPACING) {
      const joint = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 0.4, 0.06), lam(0x7e858d))
      joint.position.set((x0 + x1) / 2, y, 0.02)
      this.scene.add(joint)
    }
  }
  /** arsa kenarı bordürleri: komşu betonlanınca aradaki otomatik kalkar */
  private kerbs = new Map<string, THREE.Mesh>()
  /** main bağlar: parsel betonlu mu? */
  isPavedFn: (c: number, r: number) => boolean = () => false
  /** arsalara denk gelebilecek doğal dekor (ağaç/taş/çiçek) — beton dökülünce temizlenir */
  private decor: { obj: THREE.Object3D; x: number; y: number }[] = []

  /** satın alınan (henüz betonsuz) arsayı ahşap kazık + ip sınırla işaretle */
  markOwned(c: number, r: number) {
    const [x0, x1] = PARCEL_COLS[c]
    const [y0, y1] = PARCEL_ROWS[r]
    const g = new THREE.Group()
    const rope = new THREE.MeshLambertMaterial({ color: 0xe0b13e })
    const stake = (px: number, py: number) => cyl(0.07, 0.65, 0x8a6a48, px, py, 0.32, 'z', g)
    // köşe + ara kazıklar
    const xs: number[] = []
    for (let x = x0 + 0.3; x <= x1 - 0.29; x += (x1 - x0 - 0.6) / 3) xs.push(x)
    const ys: number[] = []
    for (let y = y0 + 0.3; y <= y1 - 0.29; y += (y1 - y0 - 0.6) / 3) ys.push(y)
    for (const x of xs) { stake(x, y0 + 0.3); stake(x, y1 - 0.3) }
    for (const y of ys) { stake(x0 + 0.3, y); stake(x1 - 0.3, y) }
    // gergin ip (ince sarı şerit)
    const line = (px: number, py: number, w: number, d: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, 0.03), rope)
      m.position.set(px, py, 0.55)
      g.add(m)
    }
    line((x0 + x1) / 2, y0 + 0.3, x1 - x0 - 0.6, 0.05)
    line((x0 + x1) / 2, y1 - 0.3, x1 - x0 - 0.6, 0.05)
    line(x0 + 0.3, (y0 + y1) / 2, 0.05, y1 - y0 - 0.6)
    line(x1 - 0.3, (y0 + y1) / 2, 0.05, y1 - y0 - 0.6)
    // köşede küçük t("SAHİBİNDEN ALINDI") kazığı yerine tabela çivisi
    const plate = canvasPanel(1.1, 0.5, 220, 100, (ctx, w, h) => {
      ctx.fillStyle = '#f5f4ef'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 14); ctx.fill()
      ctx.strokeStyle = '#27a05a'; ctx.lineWidth = 7; ctx.stroke()
      ctx.fillStyle = '#27a05a'; ctx.font = '800 36px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('ARSAN', w / 2, h / 2 + 2)
    })
    plate.position.set(x0 + 0.6, y0 + 0.9, 0.9)
    g.add(plate)
    this.scene.add(g)
    this.ownedMarks.set(`${c},${r}`, g)
  }

  /** arsaya beton döşe (yapı kurmanın ön şartı) — kazık/ip sınırları kaldırılır */
  paveParcel(c: number, r: number) {
    const mark = this.ownedMarks.get(`${c},${r}`)
    if (mark) {
      this.scene.remove(mark)
      this.ownedMarks.delete(`${c},${r}`)
    }
    {
      const [dx0, dx1] = PARCEL_COLS[c]
      const [dy0, dy1] = PARCEL_ROWS[r]
      this.decor = this.decor.filter(d => {
        const inside = d.x >= dx0 && d.x <= dx1 && d.y >= dy0 && d.y <= dy1
        if (inside) this.scene.remove(d.obj)
        return !inside
      })
    }
    const [x0, x1] = PARCEL_COLS[c]
    const [y0, y1] = PARCEL_ROWS[r]
    const w = x1 - x0, d = y1 - y0
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.concreteMat)
    lot.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0.015)
    lot.receiveShadow = true
    this.scene.add(lot)
    // beton derz çizgileri: dünya-hizalı ↗ çaprazlar, komşu betonlarla kesintisiz
    this.paveJoints(x0, x1, y0, y1)
    // çevre bordürü: yola bakan kenarlar hariç; betonlu komşuya bakan kenarda
    // bordür KONMAZ ve komşunun o kenardaki bordürü de sökülür (kesintisiz beton)
    const kerbKey = (cc: number, rr: number, e: string) => `${cc},${rr}:${e}`
    const findCol = (edgeX: number, side: 0 | 1): number | null => {
      for (let i = 0; i < PARCEL_COLS.length; i++) {
        if (Math.abs(PARCEL_COLS[i][side] - edgeX) < 0.01) return i
      }
      return null
    }
    const addKerbEdge = (e: 'N' | 'S' | 'W' | 'E') => {
      let mesh: THREE.Mesh
      if (e === 'W') mesh = box(0.18, d - 0.1, 0.13, 0xd8dbde, x0 + 0.1, (y0 + y1) / 2, 0.065, this.scene)
      else if (e === 'E') mesh = box(0.18, d - 0.1, 0.13, 0xd8dbde, x1 - 0.1, (y0 + y1) / 2, 0.065, this.scene)
      else if (e === 'S') mesh = box(w - 0.1, 0.18, 0.13, 0xd8dbde, (x0 + x1) / 2, y0 + 0.1, 0.065, this.scene)
      else mesh = box(w - 0.1, 0.18, 0.13, 0xd8dbde, (x0 + x1) / 2, y1 - 0.1, 0.065, this.scene)
      this.kerbs.set(kerbKey(c, r, e), mesh)
    }
    const tryEdge = (e: 'N' | 'S' | 'W' | 'E', nb: [number, number] | null, opp: string, roadFacing: boolean) => {
      if (roadFacing) return
      if (nb && this.isPavedFn(nb[0], nb[1])) {
        const nk = this.kerbs.get(kerbKey(nb[0], nb[1], opp))
        if (nk) {
          this.scene.remove(nk)
          this.kerbs.delete(kerbKey(nb[0], nb[1], opp))
        }
        return
      }
      addKerbEdge(e)
    }
    const wc = findCol(x0, 1) // batımdaki komşu (onun doğu kenarı = benim batım)
    const ec = findCol(x1, 0) // doğumdaki komşu
    tryEdge('W', wc !== null ? [wc, r] : null, 'E', c === 3)
    tryEdge('E', ec !== null ? [ec, r] : null, 'W', c === 0)
    tryEdge('N', r < 2 ? [c, r + 1] : null, 'S', false)
    tryEdge('S', r > 0 ? [c, r - 1] : null, 'N', false)
    // istasyon kolonunun yol tarafı: dinamik bordür kapı boşluklarını kendisi açar
    if (c === 0 && r === 0) {
      this.placeLamp(5.45, -20)
      this.buildRoadEdge()
    } else if (c === 0 && r === 2) {
      this.placeLamp(5.45, 19)
      this.buildRoadEdge()
    }
  }

  /** yerleştirmede seçilen yöne döndür (90° adımlar) */
  rotateBuilding(id: string, rot: number) {
    const b = this.buildings.find(x => x.id === id)
    if (b) (b.group as THREE.Group).rotation.z = rot * Math.PI / 2
  }

  /** istasyon giriş/çıkış kapısı — oyuncu yerini belirler, trafik buna uyar */
  buildGate(kind: 'in' | 'out', pos?: THREE.Vector2) {
    const id = kind === 'in' ? 'gatein' : 'gateout'
    const v = kind === 'in' ? this.gateIn : this.gateOut
    if (pos) v.set(4.2, pos.y)
    this.removeBuildingGroup(id)
    const g = new THREE.Group()
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.4), lam(0x565e66))
    pad.position.z = 0.024
    pad.receiveShadow = true
    g.add(pad)
    // yön oku: giriş istasyona (-x), çıkış yola (+x) bakar
    const dir = kind === 'in' ? -1 : 1
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.34), lam(0xe8e4d8))
    shaft.position.set(-dir * 0.35, 0, 0.03)
    g.add(shaft)
    const tri = new THREE.Shape()
    tri.moveTo(0, -0.5); tri.lineTo(0.62, 0); tri.lineTo(0, 0.5); tri.closePath()
    const tip = new THREE.Mesh(new THREE.ShapeGeometry(tri), lam(0xe8e4d8))
    tip.position.set(dir * 0.15, 0, 0.03)
    if (dir < 0) tip.rotation.z = Math.PI
    g.add(tip)
    // mini tabela
    cyl(0.05, 1.5, 0x8f979e, 0, 1.45, 0.75, 'z', g)
    const label = canvasPanel(1.3, 0.44, 220, 76, (ctx, cw, ch) => {
      ctx.fillStyle = kind === 'in' ? '#27a05a' : '#d64545'
      ctx.beginPath(); ctx.roundRect(0, 0, cw, ch, 14); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '800 44px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(kind === 'in' ? t('GİRİŞ') : t('ÇIKIŞ'), cw / 2, ch / 2 + 2)
    })
    label.position.set(0, 1.45, 1.62)
    g.add(label)
    g.position.set(v.x, v.y, 0)
    this.scene.add(g)
    this.register(id, kind === 'in' ? t('GİRİŞ') : t('ÇIKIŞ'), g, 2.1)
    this.buildRoadEdge()
  }

  /** ofis binası — taşınabilir (düzenleme modu) */
  buildOffice(pos?: THREE.Vector2) {
    const at = pos ?? new THREE.Vector2(-5.0, 4.5)
    const officeGroup = new THREE.Group()
    let officeFx = 1.7 // cephe x'i (girişin oturacağı yüz)
    if (this.statics?.office) {
      const o = fitModel(this.statics.office, 4.4)
      o.traverse(m => { m.castShadow = true })
      officeGroup.add(o)
      officeFx = new THREE.Box3().setFromObject(o).max.x
    } else {
      box(3.2, 4.2, 2.4, 0xdfd8c8, 0, 0, 1.2, officeGroup)
      box(3.4, 4.4, 0.25, 0x9c5b3c, 0, 0, 2.5, officeGroup)
    }
    // zemin kat girişi: basamak + çerçeveli cam kapı + kırmızı saçak + yan camlar
    box(0.55, 1.7, 0.1, 0xb8bec4, officeFx + 0.32, 0, 0.05, officeGroup) // alt basamak
    box(0.34, 1.35, 0.2, 0xc7ccd1, officeFx + 0.2, 0, 0.1, officeGroup)  // üst basamak
    box(0.1, 1.2, 1.7, 0x39424e, officeFx + 0.02, 0, 0.95, officeGroup)   // kapı çerçevesi
    box(0.04, 0.95, 1.5, 0x9fb0b8, officeFx + 0.01, 0, 0.92, officeGroup)  // füme cam kapı (gömülü)
    box(0.03, 0.06, 1.4, 0x39424e, officeFx + 0.05, 0, 0.92, officeGroup)  // kapı ortası çıta
    // saçak + direkler
    box(0.95, 1.9, 0.1, 0xd64545, officeFx + 0.42, 0, 1.98, officeGroup)
    box(0.99, 1.94, 0.05, 0xb23434, officeFx + 0.42, 0, 2.05, officeGroup)
    cyl(0.05, 1.95, 0x8f979e, officeFx + 0.82, -0.85, 0.98, 'z', officeGroup)
    cyl(0.05, 1.95, 0x8f979e, officeFx + 0.82, 0.85, 0.98, 'z', officeGroup)
    // zemin kat yan pencereleri: küçük, gömülü, füme — cephe sakinledi
    for (const wy of [-1.45, 1.45]) {
      box(0.06, 0.62, 0.72, 0x39424e, officeFx, wy, 1.05, officeGroup)
      box(0.04, 0.5, 0.6, 0x9fb0b8, officeFx - 0.01, wy, 1.05, officeGroup)
    }
    // saçak üstü OFİS plakası
    const officePlate = canvasPanel(1.0, 0.38, 220, 84, (ctx, w, h) => {
      ctx.fillStyle = '#d64545'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 14); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '800 52px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('OFİS', w / 2, h / 2 + 2)
    })
    officePlate.position.set(officeFx + 0.9, 0, 2.28)
    officeGroup.add(officePlate)
    // kapı yanı yeşillikler
    for (const by of [-1.2, 1.2]) {
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 1), lam(0x6fb35a))
      bush.position.set(officeFx + 0.55, by, 0.26)
      bush.castShadow = true
      officeGroup.add(bush)
      box(0.4, 0.4, 0.18, 0x9c5b3c, officeFx + 0.55, by, 0.09, officeGroup)
    }
    officeGroup.position.set(at.x, at.y, 0)
    this.facadeLights(officeGroup, [[officeFx + 0.01, -0.9, 2.6], [officeFx + 0.01, 0.9, 2.6]])
    this.scene.add(officeGroup)
    this.register('office', t('OFİS'), officeGroup, 5.6)
    cyl(0.22, 0.6, 0x3f6f56, 1.7, 2.3, 0.3, 'z', officeGroup)

  }

  /** kart görselleri için özel örnek modeller (build fonksiyonu olmayan kalemler) */
  thumbSource(id: string): THREE.Group | null {
    if (id === 'sign' && this.signGroup) {
      const g = this.signGroup.clone(true)
      g.position.set(0, 0, 0)
      return g
    }
    if (id === 'tank') {
      const g = this.tankGroup.clone(true)
      g.position.set(0, 0, 0)
      g.traverse(o => { if ((o as THREE.Sprite).isSprite) o.visible = false })
      return g
    }
    if (id === 'grid') {
      const g = new THREE.Group()
      cyl(0.1, 3.6, 0x59616b, 0, 0, 1.8, 'z', g)
      box(1.7, 0.13, 0.13, 0x59616b, 0, 0, 3.2, g)
      box(1.2, 0.11, 0.11, 0x59616b, 0, 0, 2.6, g)
      for (const sx of [-0.6, 0.6]) cyl(0.04, 0.5, 0x2b2f33, sx, 0, 2.95, 'z', g)
      box(0.5, 0.35, 0.7, 0xc7ccd1, 0, 0, 0.35, g)
      return g
    }
    if (id === 'land' || id === 'pave') {
      const g = new THREE.Group()
      const mat = id === 'land' ? lam(0x86b06a) : this.concreteMat
      const tile = new THREE.Mesh(new THREE.BoxGeometry(4.4, 4.4, 0.3), mat)
      tile.position.z = 0.15
      tile.castShadow = true
      g.add(tile)
      if (id === 'land') {
        buildTreeProc(1.1, 1.1, 0.7, g)
        const board = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.7), lam(0xf0f0ec))
        board.position.set(-1, -1, 0.95)
        g.add(board)
        cyl(0.06, 0.7, 0x8a6a48, -1, -1, 0.55, 'z', g)
      } else {
        for (const k of [-1.1, 0, 1.1]) box(4.2, 0.06, 0.02, 0x7e858d, 0, k, 0.31, g)
      }
      return g
    }
    return null
  }

  /** yerleştirme önizlemesi: az önce kurulan binayı kayıttan düşüp grubunu döndürür */
  detachPreview(id: string): THREE.Group | null {
    const b = this.buildings.find(x => x.id === id)
    if (!b) return null
    this.buildings = this.buildings.filter(x => x.id !== id)
    if (id === 'smr') {
      this.steam = this.steam.filter(s => {
        let o: THREE.Object3D | null = s.mesh.parent
        while (o) { if (o === b.group) return false; o = o.parent }
        return true
      })
    }
    return b.group as THREE.Group
  }

  /** taşıma için: kayıtlı binayı sahneden kaldır */
  removeBuildingGroup(id: string) {
    const b = this.buildings.find(x => x.id === id)
    if (!b) return
    this.scene.remove(b.group as THREE.Group)
    this.unregister(id)
    if (id === 'smr') this.steam = []
    if (id === 'market') this.marketGroup = null
    if (id === 'toilet') this.toiletGroup = null
    if (id === 'battery') this.batteryGroup = null
  }

  addPump(index: number, at?: THREE.Vector2) {
    const base = at ?? new THREE.Vector2(0, PUMP_SLOTS_POS[Math.min(index, 3)].y)
    this.pumpSlots[index] = new THREE.Vector3(base.x + 1.8, base.y, 0)
    const g = new THREE.Group()
    box(1.7, 3.4, 0.2, 0xc7ccd1, 0, 0, 0.1, g)
    box(1.75, 3.45, 0.05, 0xe0b13e, 0, 0, 0.02, g)
    cyl(0.09, 0.55, 0xe0b13e, 0, -1.5, 0.45, 'z', g)
    cyl(0.09, 0.55, 0xe0b13e, 0, 1.5, 0.45, 'z', g)
    const p = buildPumpMesh(this.nightMats)
    p.position.z = 0.2
    g.add(p)
    g.position.set(base.x, base.y, 0)
    this.scene.add(g)
    this.register(`pump-${index}`, t('POMPA #{0}', index + 1), g, 2.5)
  }

  movePump(index: number, at: THREE.Vector2) {
    this.removeBuildingGroup(`pump-${index}`)
    this.addPump(index, at)
  }

  addEvCharger(index: number, at?: THREE.Vector2) {
    const base = at ?? new THREE.Vector2(0.7, EV_SLOTS_POS[Math.min(index, 3)].y)
    this.evSlots[index] = new THREE.Vector3(base.x + 1.1, base.y, 0)
    const g = new THREE.Group()
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.9), new THREE.MeshLambertMaterial({
      color: 0x2f8fd6, transparent: true, opacity: 0.28,
    }))
    pad.position.set(1.1, 0, 0.025)
    g.add(pad)
    box(1.0, 1.6, 0.14, 0xc7ccd1, 0, 0, 0.07, g)
    box(0.35, 0.55, 1.5, 0xf0f0ec, 0, 0, 0.85, g)
    const stripe = glow(0x35c7d6, 0.8)
    box(0.37, 0.57, 0.22, 0x35c7d6, 0, 0, 1.35, g, stripe)
    this.nightMats.push({ mat: stripe, day: 0.8, night: 1.15, owner: 'charger' })
    box(0.04, 0.34, 0.3, 0x1c2530, 0.19, 0, 1.0, g)
    cyl(0.03, 0.5, 0x23272b, 0.15, 0.3, 0.6, 'z', g)
    box(0.1, 0.08, 0.2, 0x35c7d6, 0.15, 0.3, 0.35, g)
    g.position.set(base.x, base.y, 0)
    this.scene.add(g)
    this.register(`charger-${index}`, t('DC ŞARJ #{0}', index + 1), g, 2.3)
  }

  moveCharger(index: number, at: THREE.Vector2) {
    this.removeBuildingGroup(`charger-${index}`)
    this.addEvCharger(index, at)
  }

  setStationName(name: string) {
    this.stationName = (name.trim() || t('BENZİNLİK')).toLocaleUpperCase('tr-TR').slice(0, 14)
    this.setSign(this.signLevel)
  }

  setSign(level: number) {
    this.signLevel = level
    if (this.signGroup) this.scene.remove(this.signGroup)
    const g = new THREE.Group()
    const H = [2.4, 3.2, 4.2, 5.4][level]
    const pw = [1.5, 1.9, 2.4, 3.0][level]
    const ph = [1.6, 2.0, 2.4, 2.8][level]
    box(level >= 2 ? 0.9 : 0.5, 0.24, H, 0x39424e, 0, 0, H / 2, g)
    this.nightMats = this.nightMats.filter(n => n.owner !== 'sign')
    let backMat: THREE.Material
    if (level >= 1) {
      const gm = glow(level >= 3 ? 0xd64545 : 0xf0f0ec, level >= 2 ? 0.35 : 0.05)
      this.nightMats.push({ mat: gm, day: level >= 2 ? 0.35 : 0.05, night: 0.9, owner: 'sign' })
      backMat = gm
    } else {
      backMat = lam(0xf0f0ec)
    }
    box(pw + 0.1, 0.2, ph + 0.1, 0, 0, 0, H + ph / 2, g, backMat)
    const drawFace = (ctx: CanvasRenderingContext2D, W: number, H2: number) => {
      ctx.fillStyle = '#f5f4ef'; ctx.fillRect(0, 0, W, H2)
      ctx.fillStyle = '#d64545'; ctx.fillRect(0, 0, W, 84)
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      let fs = 44
      ctx.font = `800 ${fs}px -apple-system, sans-serif`
      while (fs > 16 && ctx.measureText(this.stationName).width > W - 16) {
        fs -= 2
        ctx.font = `800 ${fs}px -apple-system, sans-serif`
      }
      ctx.fillText(this.stationName, W / 2, 44)
      const hasElec = this.priceView[3] > 0
      const rows: [string, string, string][] = [
        [t('BENZİN'), this.priceView[0].toFixed(1), '#1c2530'],
        [t('DİZEL'), this.priceView[1].toFixed(1), '#1c2530'],
        [t('LPG'), this.priceView[2].toFixed(1), '#1c2530'],
      ]
      if (hasElec) rows.push(['kWh', this.priceView[3].toFixed(1), '#2b7fb8'])
      const rowFs = hasElec ? 26 : 29
      const y0 = hasElec ? 112 : 122
      const dy = hasElec ? 38 : 46
      ctx.font = `700 ${rowFs}px -apple-system, sans-serif`
      rows.forEach(([label, val, col], i) => {
        ctx.fillStyle = col
        ctx.textAlign = 'left'; ctx.fillText(label, 18, y0 + dy * i)
        ctx.textAlign = 'right'; ctx.fillText(val, W - 18, y0 + dy * i)
      })
      if (this.closedFlag) {
        ctx.fillStyle = '#d64545'
        ctx.fillRect(0, 238, W, 50)
        ctx.fillStyle = '#fff'; ctx.font = '800 32px -apple-system, sans-serif'
        ctx.textAlign = 'center'; ctx.fillText('KAPALI', W / 2, 263)
      } else if (level >= 1) {
        ctx.fillStyle = '#27a05a'; ctx.font = '700 26px -apple-system, sans-serif'
        ctx.textAlign = 'center'; ctx.fillText('★ 7/24 AÇIK ★', W / 2, 262)
      }
    }
    for (const sy of [1, -1]) {
      const panel = canvasPanel(pw, ph, 256, 288, drawFace, new THREE.Vector3(0, sy, 0))
      panel.position.set(0, sy * 0.12, H + ph / 2)
      g.add(panel)
    }
    if (level >= 3) box(pw + 0.3, 0.22, 0.18, 0xe0b13e, 0, 0, H + ph + 0.15, g)
    g.position.set(4.0, -11.5, 0)
    this.scene.add(g)
    this.signGroup = g
  }

  buildMarket(level: number, pos?: THREE.Vector2) {
    const at = pos ?? new THREE.Vector2(-3.8, 15.5)
    if (this.marketGroup) { this.scene.remove(this.marketGroup); this.unregister('market') }
    const g = new THREE.Group()
    const proto = level >= 2 ? (this.statics?.market2 ?? this.statics?.market1) : this.statics?.market1
    let H = level >= 2 ? 3.0 : 2.5
    if (proto) {
      const b = fitModel(proto, level >= 2 ? 7.0 : 4.6)
      const bb = new THREE.Box3().setFromObject(b)
      H = bb.max.z
      b.traverse(m => { m.castShadow = true })
      g.add(b)
    } else {
      const W = level >= 2 ? 5.5 : 4.2
      const D = level >= 2 ? 7.5 : 5.0
      box(W, D, H, 0xe8e2d4, 0, 0, H / 2, g)
      box(W + 0.3, D + 0.3, 0.25, 0x8a5a3c, 0, 0, H + 0.12, g)
    }
    const sign = canvasPanel(2.6, 0.6, 420, 100, (ctx, w, h) => {
      ctx.fillStyle = '#d64545'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 18); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '800 58px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('MARKET', w / 2, h / 2 + 2)
    })
    sign.position.set(level >= 2 ? 1.7 : 1.4, 0, H + 0.35)
    g.add(sign)
    const fx = level >= 2 ? 2.3 : 1.6
    this.facadeLights(g, [[fx, -1.1, 1.0], [fx, 1.1, 1.0]], 1.2, 0.8)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.marketGroup = g
    this.register('market', t('MARKET'), g, H + 1.0)
  }

  buildToilet(level: number, pos?: THREE.Vector2) {
    const at = pos ?? new THREE.Vector2(2.0, 12.8)
    if (this.toiletGroup) { this.scene.remove(this.toiletGroup); this.unregister('toilet') }
    const g = new THREE.Group()
    let H = level >= 2 ? 2.4 : 2.1
    if (this.statics?.toilet) {
      const b = fitModel(this.statics.toilet, level >= 2 ? 3.4 : 2.6)
      const bb = new THREE.Box3().setFromObject(b)
      H = bb.max.z
      b.traverse(m => { m.castShadow = true })
      g.add(b)
    } else {
      const W = level >= 2 ? 2.8 : 2.1
      const D = level >= 2 ? 3.4 : 2.6
      box(W, D, H, level >= 2 ? 0x9fc4b8 : 0xa8bfd0, 0, 0, H / 2, g)
    }
    const sign = canvasPanel(0.9, 0.5, 180, 100, (ctx, w, h) => {
      ctx.fillStyle = '#2f6fed'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 16); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '800 56px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('WC', w / 2, h / 2 + 2)
    })
    sign.position.set(1.0, 0, H + 0.3)
    g.add(sign)
    this.facadeLights(g, [[1.05, 0, 1.0]], 0.6, 0.4)
    if (level >= 2) {
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 1), lam(0x6fb35a))
      bush.position.set(1.4, -1.6, 0.3); bush.castShadow = true; g.add(bush)
      const bush2 = bush.clone(); bush2.position.y = 1.6; g.add(bush2)
    }
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.toiletGroup = g
    this.register('toilet', t('TUVALET'), g, H + 0.85)
  }

  upgradeTankVisual(level: number) {
    this.buildTankCluster(level)
  }

  buildBattery(level: number, pos?: THREE.Vector2) {
    if (pos) this.batteryPos.copy(pos)
    if (this.batteryGroup) { this.scene.remove(this.batteryGroup); this.unregister('battery') }
    const g = new THREE.Group()
    const colors = [0x3f8f5f, 0x3f6f8f, 0xb08a3f]
    for (let i = 0; i < level; i++) {
      box(2.2, 1.3, 1.15, colors[i], 0, 0, 0.6 + i * 1.2, g)
      for (let k = -2; k <= 2; k++) box(2.24, 0.05, 1.1, 0x2b2f33, 0, k * 0.28, 0.6 + i * 1.2, g)
      // yan yüzde büyük pil işareti — ne olduğu uzaktan belli olsun
      const battDecal = canvasPanel(1.0, 1.0, 160, 160, (ctx, w, h) => {
        ctx.fillStyle = 'rgba(255,255,255,0.92)'
        ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 8, 0, 7); ctx.fill()
        ctx.font = '96px -apple-system, sans-serif'
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText('🔋', w / 2, h / 2 + 8)
      })
      battDecal.position.set(1.14, 0, 0.62 + i * 1.2)
      g.add(battDecal)
      // ön yüze şarj çubukları
      const barsDecal = canvasPanel(0.8, 0.5, 160, 100, (ctx, w, h) => {
        ctx.fillStyle = '#0f1a14'
        ctx.beginPath(); ctx.roundRect(0, 0, w, h, 14); ctx.fill()
        for (let b = 0; b < 4; b++) {
          ctx.fillStyle = b < 3 ? '#37c97e' : 'rgba(255,255,255,0.25)'
          ctx.fillRect(14 + b * 34, 18, 24, h - 36)
        }
      }, new THREE.Vector3(0, -1, 0))
      barsDecal.position.set(0, -0.68, 0.62 + i * 1.2)
      g.add(barsDecal)
    }
    const warn = canvasPanel(0.9, 0.45, 180, 90, (ctx, w, h) => {
      ctx.fillStyle = '#e0b13e'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 12); ctx.fill()
      ctx.fillStyle = '#1c2530'; ctx.font = '800 40px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('⚡ DEPO', w / 2, h / 2)
    })
    warn.position.set(1.13, 0, 0.9)
    g.add(warn)
    g.position.set(this.batteryPos.x, this.batteryPos.y, 0)
    this.scene.add(g)
    this.batteryGroup = g
    this.register('battery', t('BATARYA DEPOSU'), g, level * 1.2 + 1.1)
  }

  buildSolar(side: 'north' | 'south', pos?: THREE.Vector2, regId = 'solar') {
    const g = new THREE.Group()
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.1),
        new THREE.MeshLambertMaterial({ color: 0x1e3a5f, side: THREE.DoubleSide }))
      p.position.set(-1 + r * 2.0, -2.4 + c * 2.4, 0.75)
      p.rotation.y = -0.55
      p.castShadow = true
      g.add(p)
      box(0.08, 0.08, 0.55, 0x8f979e, -1 + r * 2.0, -2.4 + c * 2.4, 0.28, g)
    }
    box(0.7, 0.5, 0.5, 0x59616b, 1.6, 2.6, 0.25, g)
    const at = pos ?? new THREE.Vector2(-4, side === 'south' ? -20 : 20)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register(regId, t('GÜNEŞ SANTRALİ'), g, 2.4)
  }

  buildDiesel(pos?: THREE.Vector2) {
    const at = pos ?? new THREE.Vector2(-5.7, -9.2)
    const g = new THREE.Group()
    box(1.3, 0.9, 0.9, 0xe0b13e, 0, 0, 0.5, g)
    box(1.34, 0.94, 0.12, 0x2b2f33, 0, 0, 1.0, g)
    cyl(0.06, 0.6, 0x59616b, 0.4, 0.25, 1.3, 'z', g)
    box(0.3, 0.2, 0.25, 0x2b2f33, -0.4, 0, 1.1, g)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register('dieselgen', t('JENERATÖR'), g, 2.2)
  }

  buildWash(pos?: THREE.Vector2) {
    const at = pos ?? new THREE.Vector2(-4.7, -12.6)
    const g = new THREE.Group()
    // tünel yıkama: iki yan duvar + tonozlu çatı, iki ucu açık
    box(0.3, 4.6, 2.4, 0x8fb8d8, 1.85, 0, 1.2, g)
    box(0.3, 4.6, 2.4, 0x8fb8d8, -1.85, 0, 1.2, g)
    box(4.0, 4.6, 0.28, 0x2f6fed, 0, 0, 2.62, g)
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 4.4, 20, 1, true, 0, Math.PI),
      new THREE.MeshLambertMaterial({ color: 0x7ec8e3, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }))
    arch.position.z = 2.55
    arch.rotation.z = Math.PI / 2
    arch.scale.set(1, 1, 0.45)
    g.add(arch)
    // dalga şeridi duvarlarda
    box(0.06, 4.6, 0.3, 0x2f6fed, 2.02, 0, 1.7, g)
    box(0.06, 4.6, 0.3, 0x2f6fed, -2.02, 0, 1.7, g)
    // içerideki fırçalar (renkli silindirler) + üst rulo
    cyl(0.42, 2.0, 0xd64545, 1.1, -0.7, 1.15, 'z', g)
    cyl(0.42, 2.0, 0x2f6fed, -1.1, -0.7, 1.15, 'z', g)
    cyl(0.42, 2.0, 0xe0b13e, 1.1, 0.9, 1.15, 'z', g)
    cyl(0.42, 2.0, 0x37c97e, -1.1, 0.9, 1.15, 'z', g)
    cyl(0.38, 2.8, 0xe8e6e1, 0, 0, 2.1, 'x', g)
    // köpük baloncukları + giriş paspası
    for (const [bx, by, bz, br] of [[1.2, 2.0, 0.35, 0.22], [0.6, 2.25, 0.2, 0.16], [-0.9, 2.1, 0.3, 0.19]] as const) {
      const bub = new THREE.Mesh(new THREE.SphereGeometry(br, 10, 8),
        new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }))
      bub.position.set(bx, by, bz)
      g.add(bub)
    }
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(1.4, 20),
      new THREE.MeshLambertMaterial({ color: 0x7ec8e3, transparent: true, opacity: 0.3 }))
    puddle.position.set(0, 2.9, 0.03)
    g.add(puddle)
    const sign = canvasPanel(3.2, 0.6, 460, 90, (ctx, w, h) => {
      ctx.fillStyle = '#2f6fed'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 18); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '800 52px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('🚿 OTO YIKAMA', w / 2, h / 2 + 2)
    })
    sign.position.set(2.1, 0, 2.25)
    g.add(sign)
    this.facadeLights(g, [[2.02, -1.6, 1.1]], 0.7, 0.5)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register('wash', t('OTO YIKAMA'), g, 3.6)
  }

  buildCoffee(pos?: THREE.Vector2) {
    const at = pos ?? new THREE.Vector2(-9.5, 3)
    const g = new THREE.Group()
    box(2.8, 2.8, 2.3, 0xe8dcc8, 0, 0, 1.15, g)
    box(3.0, 3.0, 0.2, 0x7a5738, 0, 0, 2.4, g)
    box(0.05, 1.2, 1.0, 0x7ec8e3, 1.41, -0.5, 1.1, g)
    box(0.05, 0.7, 1.5, 0x5b4632, 1.41, 0.8, 0.75, g)
    // tente
    for (let i = 0; i < 4; i++) box(0.5, 0.7, 0.06, i % 2 ? 0x7a5738 : 0xf0f0ec, 1.6, -1.05 + i * 0.7, 1.85, g)
    const sign = canvasPanel(1.9, 0.5, 320, 84, (ctx, w, h) => {
      ctx.fillStyle = '#7a5738'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 16); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '800 50px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('☕ KAHVE', w / 2, h / 2 + 2)
    })
    sign.position.set(1.55, 0, 2.05)
    g.add(sign)
    this.facadeLights(g, [[1.44, -0.5, 1.2]], 0.9, 0.6)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register('coffee', t('KAHVECİ'), g, 3.0)
  }

  buildRestaurant(pos?: THREE.Vector2) {
    const at = pos ?? new THREE.Vector2(-13.5, 5)
    const g = new THREE.Group()
    box(4.8, 5.4, 2.8, 0xdfd0b8, 0, 0, 1.4, g)
    box(5.0, 5.6, 0.25, 0x9c3b3b, 0, 0, 2.9, g)
    box(0.05, 3.6, 1.2, 0x7ec8e3, 2.41, 0, 1.3, g)
    box(0.05, 0.9, 1.7, 0x5b4632, 2.41, 2.1, 0.85, g)
    // kırmızı-beyaz tente
    for (let i = 0; i < 6; i++) box(0.6, 0.85, 0.07, i % 2 ? 0xd64545 : 0xf0f0ec, 2.65, -2.15 + i * 0.86, 2.15, g)
    // baca
    cyl(0.14, 0.8, 0x8f979e, -1.6, -1.8, 3.2, 'z', g)
    const sign = canvasPanel(3.2, 0.6, 480, 90, (ctx, w, h) => {
      ctx.fillStyle = '#9c3b3b'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 18); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '800 50px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('🍽️ RESTORAN', w / 2, h / 2 + 2)
    })
    sign.position.set(2.55, 0, 2.55)
    g.add(sign)
    this.facadeLights(g, [[2.44, -1.3, 1.4], [2.44, 1.0, 1.4]], 1.1, 0.7)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register('restaurant', t('RESTORAN'), g, 3.6)
  }

  buildTruckPark(pos?: THREE.Vector2) {
    const at = pos ?? new THREE.Vector2(-12.5, -4.5)
    const g = new THREE.Group()
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 5.6), lam(0x565e66))
    pad.position.z = 0.02
    pad.receiveShadow = true
    g.add(pad)
    for (let i = 0; i < 4; i++) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 0.12), lam(0xe8e4d8))
      line.position.set(0, -2.1 + i * 1.4, 0.03)
      g.add(line)
    }
    const sign = canvasPanel(2.6, 0.55, 420, 84, (ctx, w, h) => {
      ctx.fillStyle = '#39424e'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 16); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '800 48px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('🚛 TIR PARKI', w / 2, h / 2 + 2)
    })
    sign.position.set(3.9, 0, 1.8)
    g.add(sign)
    cyl(0.08, 1.8, 0x59616b, 3.9, 0, 0.9, 'z', g)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register('truckpark', t('TIR PARKI'), g, 2.6)
  }

  buildSelfWash(pos?: THREE.Vector2, regId = 'selfwash') {
    const at = pos ?? new THREE.Vector2(-10.5, -6.5)
    const g = new THREE.Group()
    // iki açık bölmeli self yıkama
    for (const by of [-1.5, 1.5]) {
      box(0.25, 0.25, 2.2, 0x8f979e, 2.0, by - 1.4, 1.1, g)
      box(0.25, 0.25, 2.2, 0x8f979e, -2.0, by - 1.4, 1.1, g)
      box(0.25, 0.25, 2.2, 0x8f979e, 2.0, by + 1.4, 1.1, g)
      box(0.25, 0.25, 2.2, 0x8f979e, -2.0, by + 1.4, 1.1, g)
      // bölme arası duvar + köpük tabancası
      box(0.2, 2.9, 1.6, 0x9fc8e8, 0, by, 0.8, g)
      cyl(0.05, 1.0, 0xe0b13e, 1.6, by, 1.2, 'z', g)
      box(0.25, 0.15, 0.2, 0xd64545, 1.6, by, 1.8, g)
    }
    box(4.6, 6.4, 0.25, 0x2f6fed, 0, 0, 2.35, g) // ortak çatı
    // jeton/köpük otomatı
    box(0.5, 0.7, 1.3, 0xe0b13e, -2.6, 0, 0.75, g)
    box(0.52, 0.72, 0.12, 0x2b2f33, -2.6, 0, 1.45, g)
    const sign = canvasPanel(2.9, 0.55, 460, 84, (ctx, w, h) => {
      ctx.fillStyle = '#2f8fd6'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 16); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '800 44px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('🧽 SELF YIKAMA', w / 2, h / 2 + 2)
    })
    sign.position.set(2.35, 0, 2.7)
    g.add(sign)
    this.facadeLights(g, [[0.12, -1.5, 1.3], [0.12, 1.5, 1.3]], 0.7, 0.4)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register(regId, t('SELF YIKAMA'), g, 3.4)
  }

  buildParking(pos?: THREE.Vector2, regId = 'parking') {
    const at = pos ?? new THREE.Vector2(0.4, -0.2)
    const g = new THREE.Group()
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 3.1), lam(0x6b7480))
    pad.position.z = 0.02
    pad.receiveShadow = true
    g.add(pad)
    // çizgili park yerleri (4 kapasite, kompakt)
    for (let i = 0; i <= 4; i++) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 2.8), lam(0xe8e4d8))
      line.position.set(-2.04 + i * 1.02, 0, 0.03)
      g.add(line)
    }
    for (let i = 0; i < 4; i++) {
      box(0.62, 0.13, 0.1, 0xd8dbde, -1.53 + i * 1.02, -1.2, 0.05, g) // teker stoperi
    }
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register(regId, t('OTOPARK'), g, 2.2)
  }

  /** yerleştirilen otoparkın dünya koordinatındaki park noktaları */
  getParkingSpots(): THREE.Vector3[] {
    const spots: THREE.Vector3[] = []
    for (const b of this.buildings) {
      if (!(b.id === 'parking' || b.id.startsWith('parking#'))) continue
      const g = b.group as THREE.Group
      g.updateMatrixWorld(true)
      for (let i = 0; i < 4; i++) {
        const local = new THREE.Vector3(-1.53 + i * 1.02, -0.1, 0)
        spots.push(local.applyMatrix4(g.matrixWorld))
      }
    }
    return spots
  }

  /** tır parkı: park noktası + manevra (yanaşma) noktası çiftleri */
  getTruckSpots(): { spot: THREE.Vector3; stage: THREE.Vector3 }[] {
    const b = this.buildings.find(x => x.id === 'truckpark')
    if (!b) return []
    const g = b.group as THREE.Group
    g.updateMatrixWorld(true)
    return [-1.4, 0, 1.4].map(ly => ({
      spot: new THREE.Vector3(0, ly, 0).applyMatrix4(g.matrixWorld),
      stage: new THREE.Vector3(5.4, ly, 0).applyMatrix4(g.matrixWorld),
    }))
  }

  buildAirWater(pos?: THREE.Vector2, regId = 'airwater') {
    const at = pos ?? new THREE.Vector2(-4.5, 0.2)
    const g = new THREE.Group()
    box(1.0, 1.4, 0.12, 0xc7ccd1, 0, 0, 0.06, g)
    box(0.55, 0.7, 1.4, 0x37c97e, 0, 0, 0.82, g)
    box(0.57, 0.72, 0.1, 0x2b8f5c, 0, 0, 1.55, g)
    cyl(0.035, 0.7, 0x23272b, 0.3, 0.42, 0.7, 'z', g)
    cyl(0.035, 0.7, 0x2f6fed, 0.3, -0.42, 0.7, 'z', g)
    const sign = canvasPanel(1.1, 0.4, 220, 74, (ctx, w, h) => {
      ctx.fillStyle = '#37c97e'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 14); ctx.fill()
      ctx.fillStyle = '#06281a'; ctx.font = '800 40px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('HAVA · SU', w / 2, h / 2 + 2)
    })
    sign.position.set(0.31, 0, 1.85)
    g.add(sign)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register(regId, t('HAVA-SU ÜNİTESİ'), g, 2.3)
  }

  buildOil(pos?: THREE.Vector2) {
    const at = pos ?? new THREE.Vector2(-4.7, -16.8)
    const g = new THREE.Group()
    box(3.4, 3.0, 2.4, 0xb8bec4, 0, 0, 1.2, g)
    box(3.6, 3.2, 0.22, 0x39424e, 0, 0, 2.5, g)
    box(0.06, 2.2, 1.7, 0x4a5560, 1.71, 0, 0.85, g) // garaj kapısı
    for (let k = 0; k < 4; k++) box(0.02, 2.2, 0.06, 0x39424e, 1.75, 0, 0.3 + k * 0.42, g)
    // yağ varilleri
    cyl(0.3, 0.8, 0x2b2f33, 0.9, -1.9, 0.4, 'z', g)
    cyl(0.3, 0.8, 0xe0b13e, 0.25, -1.95, 0.4, 'z', g)
    cyl(0.3, 0.8, 0x2b2f33, 0.55, -1.6, 1.15, 'z', g)
    const sign = canvasPanel(2.9, 0.55, 480, 90, (ctx, w, h) => {
      ctx.fillStyle = '#e0b13e'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 18); ctx.fill()
      ctx.fillStyle = '#1c2530'; ctx.font = '800 50px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('🔧 YAĞ DEĞİŞİMİ', w / 2, h / 2 + 2)
    })
    sign.position.set(1.85, 0, 2.15)
    g.add(sign)
    this.facadeLights(g, [[1.74, 0, 1.6]], 1.4, 0.4)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register('oil', t('YAĞ DEĞİŞİMİ'), g, 3.3)
  }

  buildSMR(side: 'north' | 'south', pos?: THREE.Vector2) {
    const g = new THREE.Group()
    // hiperboloit soğutma kulesi
    const pts: THREE.Vector2[] = []
    for (let i = 0; i <= 16; i++) {
      const t = i / 16
      const z = t * 4.6
      const r = 0.95 * Math.sqrt(1 + Math.pow((z - 3.2) / 1.9, 2))
      pts.push(new THREE.Vector2(r, z))
    }
    const tower = new THREE.Mesh(new THREE.LatheGeometry(pts, 30),
      new THREE.MeshLambertMaterial({ color: 0xe8e6e1, side: THREE.DoubleSide }))
    tower.rotation.x = Math.PI / 2
    tower.castShadow = true
    g.add(tower)
    // kule içi su yüzeyi (üstten bakınca içi boş görünmesin)
    const water = new THREE.Mesh(new THREE.CircleGeometry(1.05, 24), lam(0x2e4a66))
    water.position.z = 3.9
    g.add(water)
    // hareketli buhar (update() içinde yükselir/kaybolur)
    for (let i = 0; i < 4; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10),
        new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }))
      puff.position.set(0, 0, 4.8)
      g.add(puff)
      this.steam.push({ mesh: puff, offset: i / 4, drift: (Math.random() - 0.5) * 0.6 })
    }
    // reaktör çekirdek binası
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.7, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), lam(0xdfe3e8))
    dome.position.set(2.2, -0.8, 0.9)
    dome.castShadow = true
    g.add(dome)
    cyl(0.7, 0.9, 0xdfe3e8, 2.2, -0.8, 0.45, 'z', g)
    box(1.0, 0.7, 0.7, 0x59616b, 2.2, 0.9, 0.35, g)
    const sign = canvasPanel(0.7, 0.7, 128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#e0b13e'; ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 4, 0, 7); ctx.fill()
      ctx.font = '70px -apple-system, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('☢️', w / 2, h / 2 + 4)
    })
    sign.position.set(2.92, -0.8, 0.9)
    g.add(sign)
    const at = pos ?? new THREE.Vector2(1.8, side === 'south' ? -20.5 : 20.5)
    g.position.set(at.x, at.y, 0)
    this.scene.add(g)
    this.register('smr', t('REAKTÖR'), g, 7.0)
  }
}
