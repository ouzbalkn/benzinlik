export type FuelType = 'benzin' | 'dizel'

export const FUEL_PRICE: Record<FuelType, number> = { benzin: 10, dizel: 9 }
export const FUEL_LABEL: Record<FuelType, string> = { benzin: 'BENZİN', dizel: 'DİZEL' }

export const FUEL_COST_PER_L = 6.5
export const ORDER_ETA = 25 // saniye
export const FILL_RATE = 7 // L/sn
export const SPILL_PENALTY_PER_L = 3
export const WRONG_FUEL_PENALTY = 300

export const TANK_CAPACITY = [800, 1500, 3000, 5000]
export const MAX_PUMPS = 4
export const MAX_EV = 4
export const BATTERY_CAP = [0, 100, 250, 600] // kWh
export const EV_PRICE_PER_KWH = 8
export const DIESEL_GEN_FUEL_PER_S = 0.25 // jeneratör çalışırken tanktaki mazot tüketimi (L/sn)

const PUMP_COSTS = [0, 5000, 8000, 12000]
const SIGN_COSTS = [1500, 4000, 9000]
const TANK_COSTS = [3000, 7000, 15000]
const MARKET_COSTS = [7000, 12000]
const TOILET_COSTS = [2500, 5000]
const LAND_COST = 6000
const GRID_COSTS = [8000, 15000]
const BATTERY_COSTS = [5000, 9000, 16000]
const EV_COSTS = [6000, 10000, 14000, 18000]
const SOLAR_COST = 9000
const DIESELGEN_COST = 4000
const SMR_COST = 40000
// Arsa haritası: sütun 0 = istasyon kolonu, 1-2 batıya doğru; 3-5 yolun KARŞI tarafı (doğu).
// Satır 0 = güney, 1 = orta, 2 = kuzey. Toplam 2 blok × 3×3.
export const PARCEL_COLS: [number, number][] = [
  [-6.5, 5], [-18, -6.5], [-29.5, -18],
  [10.9, 22.4], [22.4, 33.9], [33.9, 45.4],
]
export const PARCEL_ROWS: [number, number][] = [[-24, -10], [-10, 10], [10, 24]]
export const PAVE_COST = 2500
export function parcelKey(c: number, r: number) { return `${c},${r}` }
/**
 * Dinamik arsa fiyatı: istasyon geliştikçe emlak değerlenir.
 * Az iş yapan çıplak istasyonda taban fiyat, dolu istasyonda katlanır.
 */
export function parcelCost(c: number, _r: number, s?: GameState) {
  const base = c === 0 ? 6000 : (c === 1 || c === 3) ? 9000 : 14000
  if (!s) return base
  const mult = 1 + 0.12 * s.developmentScore()
  return Math.round(base * mult / 100) * 100
}
/** komşuluk: aynı blokta yan yana/alt alta; 0↔3 yol karşısı sayılır */
export function parcelsAdjacent(c1: number, r1: number, c2: number, r2: number): boolean {
  if (r1 === r2) {
    const sameBlock = (c1 < 3) === (c2 < 3)
    if (sameBlock && Math.abs(c1 - c2) === 1) return true
    if ((c1 === 0 && c2 === 3) || (c1 === 3 && c2 === 0)) return true // yolun karşısı
  }
  if (c1 === c2 && Math.abs(r1 - r2) === 1) return true
  return false
}

const WASH_COST = 8000
const OIL_COST = 12000
const COFFEE_COST = 7000
const RESTAURANT_COST = 15000
const TRUCKPARK_COST = 12000
const AIRWATER_COST = 1500
const SELFWASH_COST = 6000
const PARKING_COST = 1200
export const URANIUM_COST = 2500
export const URANIUM_ETA = 20 // saniye
const URANIUM_DRAIN_PER_S = 100 / 300 // tam yük ~5 dakika sürer

export class GameState {
  money = 4000
  tank = 400
  reputation = 3.0

  pumps = 1
  signLevel = 0
  tankLevel = 0
  marketLevel = 0
  toiletLevel = 0

  // elektrik
  gridLevel = 0
  evChargers = 0
  batteryLevel = 0
  battery = 0 // kWh
  hasSolar = false
  hasDiesel = false
  hasSMR = false
  hasWash = false
  hasOil = false
  hasCoffee = false
  hasRestaurant = false
  hasTruckPark = false
  hasAirWater = false
  hasSelfWash = false
  hasParking = false
  /** istasyon kapalı: yeni müşteri girmez, itibar etkilenmez (bakım molası) */
  closed = false
  private truckTimer = 45
  private selfWashTimer = 30

  // arsa sistemi: 3×3 = 9 parsel; istasyon (0,1) baştan sahipli ve betonlu
  ownedParcels = new Set<string>([parcelKey(0, 1)])
  pavedParcels = new Set<string>([parcelKey(0, 1)])

  // ilerleme / bağlılık
  day = 1
  dayStartMoney = 4000
  achievements = new Set<string>()

  owns(c: number, r: number) { return this.ownedParcels.has(parcelKey(c, r)) }
  isPaved(c: number, r: number) { return this.pavedParcels.has(parcelKey(c, r)) }
  /** eski kilitler bu getter'ları kullanır: sahip + zemin döşeli sayılır */
  get landSouth() { return this.pavedParcels.has(parcelKey(0, 0)) }
  get landNorth() { return this.pavedParcels.has(parcelKey(0, 2)) }
  get landWest() { return this.pavedParcels.has(parcelKey(1, 1)) }
  get anyLand() { return this.ownedParcels.size > 1 }

  /** istasyonun ne kadar geliştiği (arsa fiyatlarını şişirir) */
  developmentScore(): number {
    return (this.pumps - 1) + this.evChargers + this.signLevel + this.tankLevel
      + this.marketLevel + this.toiletLevel + this.gridLevel + this.batteryLevel
      + [this.hasSolar, this.hasDiesel, this.hasSMR, this.hasWash, this.hasOil, this.hasCoffee,
         this.hasRestaurant, this.hasTruckPark, this.hasAirWater, this.hasSelfWash, this.hasParking]
        .filter(Boolean).length
  }

  parcelAdjacentToOwned(c: number, r: number): boolean {
    for (const key of this.ownedParcels) {
      const [oc, or] = key.split(',').map(Number)
      if (parcelsAdjacent(c, r, oc, or)) return true
    }
    return false
  }

  // bakım / arıza
  solarDirt = 0 // 0..1
  smrWear = 0 // 0..1
  uranium = 0 // % 0..100
  uraniumPending = false
  uraniumEta = 0
  brokenPumps = new Set<number>()
  brokenChargers = new Set<number>()
  /** tick sırasında biriken olay mesajları (main toast'a çevirir) */
  events: string[] = []
  exploded = false

  orderPending = false
  orderEta = 0
  orderLiters = 0
  orderArrived = false

  get tankCapacity() { return TANK_CAPACITY[this.tankLevel] }
  get batteryCapacity() { return BATTERY_CAP[this.batteryLevel] }

  /** jeneratör şu an gürültü yapıyor mu */
  dieselRunning() {
    return this.hasDiesel && this.tank > 0 && this.batteryLevel > 0
      && this.battery < this.batteryCapacity - 0.01
  }

  /** anlık üretim gücü kWh/sn (kir, yakıt vs. dahil) */
  genRate() {
    let r = 0
    if (this.hasSolar) r += 2 * (1 - 0.7 * this.solarDirt)
    if (this.dieselRunning()) r += 1.5
    if (this.hasSMR && this.uranium > 0) r += 8
    if (this.gridLevel >= 2) r *= 1.3
    return r
  }

  tick(dt: number) {
    if (this.orderPending) {
      this.orderEta -= dt
      if (this.orderEta <= 0) {
        this.orderPending = false
        this.orderArrived = true
      }
    }
    // batarya şarjı
    if (this.batteryLevel > 0 && this.battery < this.batteryCapacity) {
      this.battery = Math.min(this.batteryCapacity, this.battery + this.genRate() * dt)
      if (this.dieselRunning()) {
        this.tank = Math.max(0, this.tank - DIESEL_GEN_FUEL_PER_S * dt)
      }
    }
    // kirlenme / yıpranma
    if (this.hasSolar && this.solarDirt < 1) {
      const before = this.solarDirt
      this.solarDirt = Math.min(1, this.solarDirt + 0.0045 * dt)
      if (before < 0.6 && this.solarDirt >= 0.6) this.events.push('🧽 Güneş panelleri iyice kirlendi, üretim düşüyor!')
    }
    // uranyum: sipariş takibi + üretim sırasında tükenme
    if (this.uraniumPending) {
      this.uraniumEta -= dt
      if (this.uraniumEta <= 0) {
        this.uraniumPending = false
        this.uranium = 100
        this.events.push('☢️ Uranyum teslim edildi — reaktör tam güçte!')
      }
    }
    if (this.hasSMR && this.uranium > 0 && this.batteryLevel > 0 && this.battery < this.batteryCapacity) {
      const before = this.uranium
      this.uranium = Math.max(0, this.uranium - URANIUM_DRAIN_PER_S * dt)
      if (before > 20 && this.uranium <= 20) this.events.push('☢️ Uranyum azalıyor! Yeni çubuk sipariş et.')
      if (before > 0 && this.uranium === 0) this.events.push('🚨 Uranyum bitti — reaktör üretimi DURDU!')
    }
    if (this.hasSMR) {
      const before = this.smrWear
      this.smrWear = Math.min(1, this.smrWear + 0.004 * dt)
      if (before < 0.5 && this.smrWear >= 0.5) this.events.push('☢️ Reaktör bakım istiyor!')
      if (before < 0.75 && this.smrWear >= 0.75) this.events.push('🚨 REAKTÖR KRİTİK! Hemen bakım yap yoksa patlayacak!')
      if (this.smrWear > 0.7 && Math.random() < dt * 0.012 * (this.smrWear - 0.7) / 0.3) {
        this.exploded = true
      }
    }
    // pasif gelirler
    if (this.hasTruckPark) {
      this.truckTimer -= dt
      if (this.truckTimer <= 0) {
        this.truckTimer = 35 + Math.random() * 20
        const m = 90 + Math.floor(Math.random() * 70)
        this.money += m
        this.events.push(`🚛 Tır parkı geliri: +₺${m}`)
      }
    }
    if (this.hasSelfWash) {
      this.selfWashTimer -= dt
      if (this.selfWashTimer <= 0) {
        this.selfWashTimer = 25 + Math.random() * 20
        const m = 30 + Math.floor(Math.random() * 30)
        this.money += m
        this.events.push(`🧽 Self yıkama: köpük/su satışı +₺${m}`)
      }
    }

    // rastgele arızalar — Murphy kanunu: para azken arıza olasılığı katlanır
    const stress = this.money < 1000 ? 4 : this.money < 3000 ? 2.5 : this.money < 6000 ? 1.5 : 1
    const brokenCount = this.brokenPumps.size + this.brokenChargers.size
    if (brokenCount < 2) {
      for (let i = 0; i < this.pumps; i++) {
        if (!this.brokenPumps.has(i) && Math.random() < (dt / 900) * stress) {
          this.brokenPumps.add(i)
          this.events.push(`🔧 Pompa #${i + 1} arıza yaptı! Bakım menüsünden tamir et.`)
          break
        }
      }
      for (let i = 0; i < this.evChargers; i++) {
        if (!this.brokenChargers.has(i) && Math.random() < (dt / 1000) * stress) {
          this.brokenChargers.add(i)
          this.events.push(`🔌 Şarj ünitesi #${i + 1} arızalandı!`)
          break
        }
      }
    }
  }

  /** yoldan geçen bir aracın istasyona girme olasılığı */
  entryChance() {
    if (this.closed) return 0
    const c = 0.32 + 0.1 * this.signLevel + 0.05 * (this.reputation - 3)
      + 0.04 * this.marketLevel + 0.02 * this.toiletLevel + 0.02 * this.evChargers
      + (this.hasWash ? 0.03 : 0) + (this.hasOil ? 0.03 : 0)
      + (this.hasCoffee ? 0.02 : 0) + (this.hasRestaurant ? 0.03 : 0)
      + (this.hasTruckPark ? 0.02 : 0) + (this.hasAirWater ? 0.02 : 0)
      + (this.hasSelfWash ? 0.02 : 0)
    return Math.min(0.95, Math.max(0.08, c))
  }

  orderNeed() { return Math.floor(this.tankCapacity - this.tank) }
  orderCost() { return Math.ceil(this.orderNeed() * FUEL_COST_PER_L) }

  canOrder() {
    return !this.orderPending && this.orderNeed() >= 100 && this.money >= this.orderCost()
  }

  placeOrder() {
    if (!this.canOrder()) return false
    this.money -= this.orderCost()
    this.orderLiters = this.orderNeed()
    this.orderPending = true
    this.orderEta = ORDER_ETA
    return true
  }

  deliverFuel() {
    this.tank = Math.min(this.tankCapacity, this.tank + this.orderLiters)
    this.orderLiters = 0
  }

  addRep(d: number) {
    this.reputation = Math.max(0, Math.min(5, this.reputation + d))
  }
}

// ---- İnşaat kataloğu ----

export interface ShopRow {
  id: string
  icon: string
  title: string
  desc: string
  /** öne çıkan sayısal değer rozeti */
  stat: string
  cost: number | null
  status: 'buy' | 'locked' | 'maxed'
  note: string
}

export function getShopItems(s: GameState): ShopRow[] {
  const rows: ShopRow[] = []
  const row = (id: string, icon: string, title: string, stat: string, desc: string,
               cost: number | null, locked: string | null) => {
    if (cost === null) rows.push({ id, icon, title, desc, stat, cost: null, status: 'maxed', note: 'MAKS' })
    else if (locked) rows.push({ id, icon, title, desc, stat, cost, status: 'locked', note: locked })
    else rows.push({ id, icon, title, desc, stat, cost, status: 'buy', note: '' })
  }
  const hasUnpaved = s.ownedParcels.size > s.pavedParcels.size

  row('land', 'i-land', `Arsa Satın Al (${s.ownedParcels.size}/18)`, '2 blok 3×3',
    'Bitişik arsalardan birini seç — istasyon geliştikçe emlak fiyatları artar',
    s.ownedParcels.size >= 18 ? null : parcelCost(0, 0, s), null)
  row('pave', 'i-pave', 'Zemin Betonu', 'arsa başı',
    'Çimen arsana beton döşe (yapı kurmak için şart, güneş paneli hariç)',
    PAVE_COST, hasUnpaved ? null : 'Betonsuz arsan yok')
  row('pump', 'i-fuel', `Pompa #${Math.min(s.pumps + 1, MAX_PUMPS)}`, '+1 pompa', 'Aynı anda bir müşteri daha alırsın',
    s.pumps >= MAX_PUMPS ? null : PUMP_COSTS[s.pumps], null)
  row('sign', 'i-sign', `Tabela Sv.${Math.min(s.signLevel + 1, 3)}`, '+%10 trafik', 'Yoldan geçenlerin uğrama şansı artar',
    s.signLevel >= 3 ? null : SIGN_COSTS[s.signLevel], null)
  row('tank', 'i-tank', 'Yakıt Tankı', s.tankLevel >= 3 ? `${TANK_CAPACITY[3]}L` : `${TANK_CAPACITY[s.tankLevel + 1]}L`,
    'Depo büyür, daha seyrek sipariş verirsin',
    s.tankLevel >= 3 ? null : TANK_COSTS[s.tankLevel], null)
  row('airwater', 'i-air', 'Hava-Su Ünitesi', '+₺10-20', 'Lastik havası ve su — ucuz ama müşteri çeker',
    s.hasAirWater ? null : AIRWATER_COST, null)
  row('parking', 'i-parking', 'Otopark', '4 araç', 'Çizgili park alanı — müşteriler park edip tesisleri kullanır',
    s.hasParking ? null : PARKING_COST, null)

  row('market', 'i-market', s.marketLevel === 0 ? 'Market' : 'Market Sv.2', `+₺${25 * (s.marketLevel + 1)}-${60 * (s.marketLevel + 1)}`,
    'Müşteriler ekstra alışveriş yapar',
    s.marketLevel >= 2 ? null : MARKET_COSTS[s.marketLevel], null)
  row('toilet', 'i-toilet', s.toiletLevel === 0 ? 'Tuvalet' : 'Tuvalet Sv.2', '+moral',
    'Müşteri memnuniyetini ve itibarı artırır',
    s.toiletLevel >= 2 ? null : TOILET_COSTS[s.toiletLevel], null)
  row('wash', 'i-wash', 'Oto Yıkama', '+₺60-120', "Müşterilerin ~%25'i araç yıkatır, ekstra gelir",
    s.hasWash ? null : WASH_COST, null)
  row('oil', 'i-oil', 'Yağ Değişimi', '+₺150-250', "Müşterilerin ~%12'si yağ değiştirtir, güçlü ek gelir",
    s.hasOil ? null : OIL_COST, null)
  row('selfwash', 'i-selfwash', 'Self Yıkama', '+₺30-60/dk', 'Araçlar kendisi yıkar; köpük ve su otomatik satılır',
    s.hasSelfWash ? null : SELFWASH_COST, null)
  row('coffee', 'i-coffee', 'Kahveci', '+₺20-45', 'Yolcular kahve molası verir',
    s.hasCoffee ? null : COFFEE_COST, null)
  row('restaurant', 'i-food', 'Restoran', '+₺80-160', 'Uzun yol müşterisi yemek molası verir',
    s.hasRestaurant ? null : RESTAURANT_COST, null)
  row('truckpark', 'i-truck', 'Tır Parkı', '+₺90-160/dk', 'Tırcılar konaklar — düzenli pasif gelir',
    s.hasTruckPark ? null : TRUCKPARK_COST, null)

  // elektrik zinciri (teknoloji sırası korunur, arsa şartı yok)
  row('grid', 'i-bolt', `Elektrik Altyapısı Sv.${Math.min(s.gridLevel + 1, 2)}`,
    s.gridLevel === 0 ? 'temel' : '+%30 üretim',
    s.gridLevel === 0 ? 'Şarj ve enerji yapılarının önünü açar' : 'Tüm üretimi güçlendirir, yeni yapılar açılır',
    s.gridLevel >= 2 ? null : GRID_COSTS[s.gridLevel], null)
  row('battery', 'i-batt', `Batarya Deposu Sv.${Math.min(s.batteryLevel + 1, 3)}`,
    `${BATTERY_CAP[Math.min(s.batteryLevel + 1, 3)]} kWh`,
    'Üretilen elektriği biriktirir, araçlar buradan anında şarj olur',
    s.batteryLevel >= 3 ? null : BATTERY_COSTS[s.batteryLevel],
    s.gridLevel < 1 ? 'Elektrik altyapısı gerekli' : null)
  row('evcharger', 'i-charger', `DC Şarj Ünitesi #${Math.min(s.evChargers + 1, MAX_EV)}`, '+1 ünite',
    'Elektrikli araç müşterileri gelmeye başlar; ünite arttıkça EV trafiği artar',
    s.evChargers >= MAX_EV ? null : EV_COSTS[s.evChargers],
    s.gridLevel < 1 ? 'Elektrik altyapısı gerekli'
      : s.batteryLevel < 1 ? 'Önce batarya deposu kur' : null)
  row('solar', 'i-solar', 'Güneş Santrali', '+2 kWh/sn',
    'Bedava üretim — ama kirlenir, düzenli temizlik ister',
    s.hasSolar ? null : SOLAR_COST,
    s.gridLevel < 1 ? 'Elektrik altyapısı gerekli' : null)
  row('dieselgen', 'i-gen', 'Dizel Jeneratör', '+1.5 kWh/sn',
    'Tanktan mazot yakar — gürültüsü şarjdaki müşterileri kaçırır',
    s.hasDiesel ? null : DIESELGEN_COST,
    s.gridLevel < 1 ? 'Elektrik altyapısı gerekli' : null)
  row('smr', 'i-reactor', 'Modüler Reaktör', '+8 kWh/sn',
    'Dev üretim — bakımsız kalırsa PATLAR, her şey sıfırlanır',
    s.hasSMR ? null : SMR_COST,
    s.gridLevel < 2 ? 'Altyapı Sv.2 gerekli' : null)

  return rows
}

// ---- Bakım & Onarım ----

export interface MaintRow {
  id: string
  icon: string
  title: string
  cost: number
  urgent: boolean
  disabled: boolean
}

export function getMaintenanceItems(s: GameState): MaintRow[] {
  const rows: MaintRow[] = []
  if (s.hasSolar) {
    rows.push({
      id: 'clean-solar', icon: 'i-clean',
      title: `Panel Temizliği (kir %${Math.round(s.solarDirt * 100)})`,
      cost: 300, urgent: s.solarDirt > 0.6, disabled: s.solarDirt < 0.15,
    })
  }
  if (s.hasSMR) {
    rows.push({
      id: 'maint-smr', icon: 'i-reactor',
      title: `Reaktör Bakımı (yıpranma %${Math.round(s.smrWear * 100)})`,
      cost: 1500, urgent: s.smrWear > 0.6, disabled: s.smrWear < 0.1,
    })
    rows.push({
      id: 'order-uranium', icon: 'i-uranium',
      title: s.uraniumPending
        ? `Uranyum yolda (${Math.ceil(s.uraniumEta)}sn)`
        : `Uranyum Siparişi (%${Math.round(s.uranium)} kaldı)`,
      cost: URANIUM_COST, urgent: s.uranium <= 15 && !s.uraniumPending,
      disabled: s.uraniumPending || s.uranium > 60,
    })
  }
  for (const i of s.brokenPumps) {
    rows.push({ id: `fix-pump-${i}`, icon: 'i-wrench', title: `Pompa #${i + 1} Tamiri`, cost: 800, urgent: true, disabled: false })
  }
  for (const i of s.brokenChargers) {
    rows.push({ id: `fix-charger-${i}`, icon: 'i-wrench', title: `Şarj #${i + 1} Tamiri`, cost: 1000, urgent: true, disabled: false })
  }
  return rows
}

// ---- Başarımlar ----

const ACHIEVEMENTS: [string, string, (s: GameState) => boolean][] = [
  ['first-10k', 'İlk ₺10.000 — Esnaf oldun!', s => s.money >= 10000],
  ['rich-100k', '₺100.000 — Patron!', s => s.money >= 100000],
  ['five-star', '5 yıldız itibar — Efsane istasyon!', s => s.reputation >= 4.95],
  ['full-pumps', '4 pompa — Tam kadro!', s => s.pumps >= 4],
  ['electric-age', 'Elektrik çağı — İlk şarj ünitesi!', s => s.evChargers >= 1],
  ['atomic', 'Atom karıncası — Reaktör kuruldu!', s => s.hasSMR],
  ['landlord', 'Toprak ağası — 9 arsanın tamamı!', s => s.ownedParcels.size >= 9],
  ['week-one', '7. gün — Bir haftadır ayaktasın!', s => s.day >= 7],
]

export function checkAchievements(s: GameState) {
  for (const [id, title, cond] of ACHIEVEMENTS) {
    if (!s.achievements.has(id) && cond(s)) {
      s.achievements.add(id)
      s.events.push(`🏆 Başarım: ${title}`)
    }
  }
}

// ---- Kayıt ----

const SAVE_FIELDS = [
  'money', 'tank', 'reputation', 'pumps', 'signLevel', 'tankLevel', 'marketLevel', 'toiletLevel',
  'gridLevel', 'evChargers', 'batteryLevel', 'battery', 'hasSolar', 'hasDiesel', 'hasSMR',
  'hasWash', 'hasOil', 'hasCoffee', 'hasRestaurant', 'hasTruckPark', 'hasAirWater', 'hasSelfWash', 'hasParking',
  'solarDirt', 'smrWear', 'uranium', 'day', 'dayStartMoney', 'closed',
] as const

export function serializeState(s: GameState): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of SAVE_FIELDS) out[f] = (s as any)[f]
  out.ownedParcels = [...s.ownedParcels]
  out.pavedParcels = [...s.pavedParcels]
  out.achievements = [...s.achievements]
  return out
}

export function hydrateState(s: GameState, data: Record<string, unknown>) {
  for (const f of SAVE_FIELDS) {
    if (f in data) (s as any)[f] = data[f]
  }
  if (Array.isArray(data.ownedParcels)) s.ownedParcels = new Set(data.ownedParcels as string[])
  if (Array.isArray(data.pavedParcels)) s.pavedParcels = new Set(data.pavedParcels as string[])
  if (Array.isArray(data.achievements)) s.achievements = new Set(data.achievements as string[])
}

export function doMaintenance(s: GameState, id: string): boolean {
  const item = getMaintenanceItems(s).find(r => r.id === id)
  if (!item || item.disabled || s.money < item.cost) return false
  s.money -= item.cost
  if (id === 'clean-solar') s.solarDirt = 0
  else if (id === 'maint-smr') s.smrWear = 0
  else if (id === 'order-uranium') { s.uraniumPending = true; s.uraniumEta = URANIUM_ETA }
  else if (id.startsWith('fix-pump-')) s.brokenPumps.delete(Number(id.slice(9)))
  else if (id.startsWith('fix-charger-')) s.brokenChargers.delete(Number(id.slice(12)))
  return true
}

/** Satın alma dener; başarılıysa true. Görsel güncellemeleri çağıran taraf yapar. */
export function buyItem(s: GameState, id: string): boolean {
  const item = getShopItems(s).find(r => r.id === id)
  if (!item || item.status !== 'buy' || item.cost === null || s.money < item.cost) return false
  s.money -= item.cost
  switch (id) {
    case 'pump': s.pumps++; break
    case 'sign': s.signLevel++; break
    case 'tank': s.tankLevel++; break
    case 'market': s.marketLevel++; break
    case 'toilet': s.toiletLevel++; break
    case 'grid': s.gridLevel++; break
    case 'battery': s.batteryLevel++; break
    case 'evcharger': s.evChargers++; break
    case 'solar': s.hasSolar = true; break
    case 'dieselgen': s.hasDiesel = true; break
    case 'smr': s.hasSMR = true; s.uranium = 100; break
    case 'wash': s.hasWash = true; break
    case 'oil': s.hasOil = true; break
    case 'coffee': s.hasCoffee = true; break
    case 'restaurant': s.hasRestaurant = true; break
    case 'truckpark': s.hasTruckPark = true; break
    case 'airwater': s.hasAirWater = true; break
    case 'selfwash': s.hasSelfWash = true; break
    case 'parking': s.hasParking = true; break
    default: return false
  }
  return true
}
