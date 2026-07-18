import { Car } from './cars'
import { FuelType, FUELS, FUEL_LABEL, GameState, getShopItems, getMaintenanceItems } from './state'
import { audio } from './audio'

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

/** UI'da emoji yok — metinlerden ayıkla (tasarım dili: ui-signage-design) */
function stripEmoji(s: string): string {
  return s.replace(/\p{Extended_Pictographic}/gu, '').replace(/️/g, '').replace(/\s{2,}/g, ' ').trim()
}

function icon(id: string, cls = 'ic'): string {
  return `<svg class="${cls}"><use href="#${id}"/></svg>`
}

export interface BuildingCard {
  icon: string // svg symbol id (i-...)
  name: string
  desc: string
  stats: [string, string, ('' | 'good' | 'bad')?][]
  action?: { label: string; maintId: string }
  move?: { label: string; id: string }
  /** karttan doğrudan yükseltme/satın alma */
  buy?: { label: string; id: string }
  /** ofis kartı: yakıt satış fiyatı kontrolleri */
  priceRows?: { f: FuelType; label: string; price: number; cost: number; canDown: boolean; canUp: boolean }[]
}

/** ikon kutusu renkleri — her kalem kendi kimliğinde */
const ICON_COLORS: Record<string, string> = {
  land: '#27a05a', pave: '#7a8290', pump: '#d64545', sign: '#2f6fed', tank: '#5a6b7c',
  airwater: '#1fa8bc', parking: '#2f6fed', market: '#e8862e', toilet: '#2f6fed', wash: '#2f9fd6',
  selfwash: '#1fa8bc', oil: '#b08a3f', coffee: '#8a5a3c', restaurant: '#c9484f', truckpark: '#5a6b7c',
  grid: '#e0a121', battery: '#27a05a', evcharger: '#1fa8bc', solar: '#e8862e', dieselgen: '#b08a3f', smr: '#d64545',
  'clean-solar': '#2f9fd6', 'maint-smr': '#d64545', 'order-uranium': '#27a05a',
}

function sicon(id: string, symbol: string): string {
  const c = ICON_COLORS[id] ?? (id.startsWith('fix-') ? '#d64545' : '#7a8290')
  return `<div class="sicon" style="color:${c};background:${c}1c;border-color:${c}44">${icon(symbol)}</div>`
}

/** yerleştirilebilirlerin kapladığı kare boyutu (görsel bilgi) */
const DIMS: Record<string, (s: GameState) => string> = {
  market: s => (s.marketLevel === 0 ? '5×6' : '6×8'),
  toilet: () => '3×4',
  battery: () => '3×2',
  solar: () => '5×7',
  dieselgen: () => '2×2',
  smr: () => '6×5',
  wash: () => '5×5',
  oil: () => '4×4',
  coffee: () => '3×3',
  restaurant: () => '6×6',
  truckpark: () => '8×6',
  airwater: () => '2×2',
  parking: () => '5×3',
  land: () => '12×14+',
}

/** inşaat sekmeleri */
const CATEGORY_MAP: Record<string, string> = {
  land: 'arsa', pave: 'arsa',
  pump: 'istasyon', sign: 'istasyon', tank: 'istasyon', airwater: 'istasyon', parking: 'istasyon',
  market: 'tesis', toilet: 'tesis', wash: 'tesis', selfwash: 'tesis', oil: 'tesis',
  coffee: 'tesis', restaurant: 'tesis', truckpark: 'tesis',
  grid: 'enerji', battery: 'enerji', evcharger: 'enerji', solar: 'enerji', dieselgen: 'enerji', smr: 'enerji',
}

export class UI {
  activeCar: Car | null = null

  onNozzle: (car: Car, type: FuelType) => void = () => {}
  onStart: (car: Car, amount: number) => void = () => {}
  onStartFull: (car: Car) => void = () => {}
  onChargeEV: (car: Car) => void = () => {}
  onDismiss: (car: Car) => void = () => {}
  onOrderFuel: (f: FuelType) => void = () => {}
  onBuy: (id: string) => void = () => {}
  onMaint: (id: string) => void = () => {}
  onRename: (name: string) => void = () => {}
  onCardClose: () => void = () => {}
  onMove: (id: string) => void = () => {}
  onReset: () => void = () => {}
  onToggleClosed: () => void = () => {}
  onPriceChange: (f: FuelType, delta: number) => void = () => {}
  onLogin: (email: string, pass: string) => void = () => {}
  onRegister: (email: string, pass: string) => void = () => {}
  onLogout: () => void = () => {}
  batteryKwh: () => number = () => 0
  /** canlı tanker durumu satırları (main bağlar) */
  tankerStatus: () => string[] = () => []
  /** gerçek 3D modelin PNG render'ı (main bağlar) */
  getThumb: (id: string) => string | null = () => null

  private money = el<HTMLSpanElement>('money')
  private day = el<HTMLSpanElement>('day')

  private battChip = el<HTMLDivElement>('battchip')
  private battFill = el<HTMLDivElement>('battfill')
  private battKwh = el<HTMLSpanElement>('battkwh')
  private rep = el<HTMLSpanElement>('rep')
  private orderBtn = el<HTMLButtonElement>('orderbtn')
  private orderLabel = el<HTMLSpanElement>('orderlabel')
  private shopBtn = el<HTMLButtonElement>('shopbtn')
  private shopLabel = el<HTMLSpanElement>('shoplabel')
  private closeBtn = el<HTMLButtonElement>('closebtn')
  private closeLabel = el<HTMLSpanElement>('closelabel')
  private shopWrap = el<HTMLDivElement>('shopwrap')
  private shopList = el<HTMLDivElement>('shoplist')
  private maintBadge = el<HTMLSpanElement>('maintbadge')
  private panel = el<HTMLDivElement>('panel')
  private demand = el<HTMLHeadingElement>('demand')
  private fuelCtl = el<HTMLDivElement>('fuelctl')
  private evCtl = el<HTMLDivElement>('evctl')
  private evNote = el<HTMLDivElement>('evnote')
  private chargeBtn = el<HTMLButtonElement>('chargebtn')
  private progress = el<HTMLDivElement>('liters')
  private amount = el<HTMLInputElement>('amount')
  private startBtn = el<HTMLButtonElement>('startbtn')
  private nozBenzin = el<HTMLButtonElement>('noz-benzin')
  private nozDizel = el<HTMLButtonElement>('noz-dizel')
  private nozLpg = el<HTMLButtonElement>('noz-lpg')
  private infoCard = el<HTMLDivElement>('infocard')
  private infoAction = el<HTMLButtonElement>('binfo-action')
  private infoMove = el<HTMLButtonElement>('binfo-move')
  private currentAction: string | null = null
  private currentMove: string | null = null
  private currentBuy: string | null = null

  private shopOpen = false
  private shopRenderT = 0
  private shopCat = 'istasyon'

  constructor() {
    const fuelWrap = el<HTMLDivElement>('fuelwrap')
    this.orderBtn.addEventListener('click', () => fuelWrap.classList.add('show'))
    fuelWrap.addEventListener('pointerdown', e => { if (e.target === fuelWrap) fuelWrap.classList.remove('show') })
    for (const f of FUELS) {
      el<HTMLButtonElement>(`fbtn-${f}`).addEventListener('click', () => this.onOrderFuel(f))
    }
    this.closeBtn.addEventListener('click', () => this.onToggleClosed())
    const accWrap = el<HTMLDivElement>('accwrap')
    el<HTMLButtonElement>('accbtn').addEventListener('click', () => accWrap.classList.add('show'))
    accWrap.addEventListener('pointerdown', e => { if (e.target === accWrap) accWrap.classList.remove('show') })
    el<HTMLButtonElement>('acclogout').addEventListener('click', () => this.onLogout())

    // modallar
    const setWrap = el<HTMLDivElement>('setwrap')
    const nameInput = el<HTMLInputElement>('stname')
    el<HTMLButtonElement>('setbtn').addEventListener('click', () => setWrap.classList.add('show'))
    this.shopBtn.addEventListener('click', () => {
      this.shopOpen = true
      this.shopWrap.classList.add('show')
      this.shopRenderT = 0
    })
    for (const btn of document.querySelectorAll<HTMLButtonElement>('.mclose')) {
      btn.addEventListener('click', () => {
        el<HTMLDivElement>(btn.dataset.close!).classList.remove('show')
        if (btn.dataset.close === 'shopwrap') this.shopOpen = false
      })
    }
    for (const wrap of [this.shopWrap, setWrap]) {
      wrap.addEventListener('pointerdown', e => {
        if (e.target === wrap) {
          wrap.classList.remove('show')
          if (wrap === this.shopWrap) this.shopOpen = false
        }
      })
    }

    // sekmeler
    for (const tab of document.querySelectorAll<HTMLButtonElement>('#shoptabs .tab')) {
      tab.addEventListener('click', () => {
        this.shopCat = tab.dataset.cat!
        for (const t of document.querySelectorAll('#shoptabs .tab')) t.classList.toggle('active', t === tab)
        this.shopRenderT = 0
      })
    }

    const save = () => {
      this.onRename(nameInput.value)
      setWrap.classList.remove('show')
    }
    el<HTMLButtonElement>('stsave').addEventListener('click', save)
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') save() })
    el<HTMLButtonElement>('resetbtn').addEventListener('click', () => {
      if (confirm('Tüm ilerleme silinecek. Emin misin?')) this.onReset()
    })

    // ses ayarları
    const musicBtn = el<HTMLButtonElement>('musicbtn')
    const sfxBtn = el<HTMLButtonElement>('sfxbtn')
    const syncAudioLabels = () => {
      musicBtn.textContent = `Müzik: ${audio.musicOn ? 'Açık' : 'Kapalı'}`
      sfxBtn.textContent = `Efektler: ${audio.sfxOn ? 'Açık' : 'Kapalı'}`
    }
    syncAudioLabels()
    musicBtn.addEventListener('click', () => { audio.toggleMusic(); syncAudioLabels() })
    sfxBtn.addEventListener('click', () => { audio.toggleSfx(); syncAudioLabels() })
    const notifBtn = el<HTMLButtonElement>('notifbtn')
    const syncNotif = () => {
      const p = 'Notification' in window ? Notification.permission : 'unsupported'
      notifBtn.textContent = p === 'granted' ? 'Bildirimler: Açık' : p === 'denied' ? 'Bildirimler: Engelli' : 'Bildirimlere İzin Ver'
      notifBtn.disabled = p === 'granted' || p === 'denied' || p === 'unsupported'
    }
    syncNotif()
    notifBtn.addEventListener('click', async () => {
      if ('Notification' in window) await Notification.requestPermission()
      syncNotif()
    })

    // hesap
    const accEmail = el<HTMLInputElement>('accemail')
    const accPass = el<HTMLInputElement>('accpass')
    el<HTMLButtonElement>('loginbtn').addEventListener('click', () => this.onLogin(accEmail.value, accPass.value))
    el<HTMLButtonElement>('registerbtn').addEventListener('click', () => this.onRegister(accEmail.value, accPass.value))
    el<HTMLButtonElement>('logoutbtn').addEventListener('click', () => this.onLogout())

    // servis paneli
    this.nozBenzin.addEventListener('click', () => this.pickNozzle('benzin'))
    this.nozDizel.addEventListener('click', () => this.pickNozzle('dizel'))
    this.nozLpg.addEventListener('click', () => this.pickNozzle('lpg'))
    for (const b of document.querySelectorAll<HTMLButtonElement>('.quick')) {
      b.addEventListener('click', () => {
        this.amount.value = b.dataset.amt ?? ''
        this.refreshPanel()
      })
    }
    this.amount.addEventListener('input', () => this.refreshPanel())
    this.startBtn.addEventListener('click', () => {
      const car = this.activeCar
      const amt = Math.floor(Number(this.amount.value))
      if (!car || !car.nozzle || !(amt > 0) || car.filling || car.filled > 0) return
      this.onStart(car, amt)
      this.refreshPanel()
    })
    el<HTMLButtonElement>('fullbtn').addEventListener('click', () => {
      const car = this.activeCar
      if (!car || !car.nozzle || car.filling || car.filled > 0) return
      this.onStartFull(car)
      this.refreshPanel()
    })
    this.chargeBtn.addEventListener('click', () => {
      if (this.activeCar?.kind === 'ev') this.onChargeEV(this.activeCar)
    })
    el<HTMLButtonElement>('dismissbtn').addEventListener('click', () => {
      if (this.activeCar) this.onDismiss(this.activeCar)
    })

    // bina kartı
    el<HTMLButtonElement>('binfo-close').addEventListener('click', () => {
      this.hideBuildingCard()
      this.onCardClose()
    })
    this.infoAction.addEventListener('click', () => {
      if (this.currentAction) this.onMaint(this.currentAction)
    })
    this.infoMove.addEventListener('click', () => {
      if (this.currentMove) this.onMove(this.currentMove)
    })
    el<HTMLButtonElement>('binfo-buy').addEventListener('click', () => {
      if (this.currentBuy) this.onBuy(this.currentBuy)
    })
    el<HTMLDivElement>('binfo-prices').addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest('button[data-pf]') as HTMLButtonElement | null
      if (btn) this.onPriceChange(btn.dataset.pf as FuelType, Number(btn.dataset.pd))
    })

    // mağaza tıklamaları
    this.shopList.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest('button[data-buy], button[data-maint]') as HTMLButtonElement | null
      if (!btn) return
      if (btn.dataset.buy) this.onBuy(btn.dataset.buy)
      if (btn.dataset.maint) this.onMaint(btn.dataset.maint)
      this.shopRenderT = 0
    })
  }

  private pickNozzle(type: FuelType) {
    if (!this.activeCar || this.activeCar.filled > 0 || this.activeCar.filling) return
    this.onNozzle(this.activeCar, type)
    this.refreshPanel()
  }

  closeShop() {
    this.shopOpen = false
    this.shopWrap.classList.remove('show')
  }

  selectCar(car: Car | null) {
    this.activeCar = car
    this.amount.value = ''
    this.refreshPanel()
  }

  refreshPanel() {
    const car = this.activeCar
    if (!car || car.phase !== 'atPump') {
      this.panel.classList.remove('show')
      return
    }
    this.panel.classList.add('show')
    el<HTMLButtonElement>('dismissbtn').disabled = car.filling || car.filled > 0

    if (car.kind === 'ev') {
      this.fuelCtl.style.display = 'none'
      this.evCtl.style.display = 'block'
      this.demand.innerHTML = `<span class="dlabel">MÜŞTERİ İSTEĞİ</span>` +
        `<span class="fpill" style="background:#1fa8bc">ELEKTRİK</span><span class="damt">${car.demandKwh} kWh</span>`
      const have = this.batteryKwh()
      const enough = have >= car.demandKwh
      this.chargeBtn.disabled = !enough
      this.chargeBtn.textContent = `HIZLI ŞARJ (${car.demandKwh} kWh)`
      this.evNote.textContent = enough
        ? 'Batarya hazır — anında şarj, müşteri hemen yola çıkar.'
        : `Bataryada yeterli enerji yok (${Math.floor(have)}/${car.demandKwh} kWh).`
      return
    }

    this.fuelCtl.style.display = 'block'
    this.evCtl.style.display = 'none'
    const fc = car.demandType === 'benzin' ? '#27a05a' : car.demandType === 'dizel' ? '#e8862e' : '#2f6fed'
    this.demand.innerHTML = `<span class="dlabel">MÜŞTERİ İSTEĞİ</span>` +
      `<span class="fpill" style="background:${fc}">${FUEL_LABEL[car.demandType]}</span><span class="damt">₺${car.demandAmount}</span>`
    this.nozBenzin.classList.toggle('sel', car.nozzle === 'benzin')
    this.nozDizel.classList.toggle('sel', car.nozzle === 'dizel')
    this.nozLpg.classList.toggle('sel', car.nozzle === 'lpg')
    const locked = car.filled > 0 || car.filling
    this.nozBenzin.disabled = locked
    this.nozDizel.disabled = locked
    this.nozLpg.disabled = locked
    this.amount.disabled = car.filling
    const amt = Math.floor(Number(this.amount.value))
    this.startBtn.disabled = !car.nozzle || !(amt > 0) || car.filling || car.filled > 0
    el<HTMLButtonElement>('fullbtn').disabled = !car.nozzle || car.filling || car.filled > 0
    if (!car.filling && car.filled === 0) this.progress.textContent = 'Tabanca seç; tutar gir ya da FULLE'
  }

  // ---- bina bilgi kartı ----

  showBuildingCard(card: BuildingCard) {
    el<HTMLDivElement>('binfo-icon').innerHTML = icon(card.icon)
    el<HTMLDivElement>('binfo-name').textContent = stripEmoji(card.name)
    el<HTMLDivElement>('binfo-desc').textContent = stripEmoji(card.desc)
    el<HTMLDivElement>('binfo-stats').innerHTML = card.stats.map(([k, v, cls]) =>
      `<div class="stat"><span class="k">${stripEmoji(k)}</span><span class="v ${cls ?? ''}">${stripEmoji(v)}</span></div>`).join('')
    el<HTMLDivElement>('binfo-prices').innerHTML = (card.priceRows ?? []).map(r =>
      `<div class="prow"><span class="pl">${r.label}</span><span class="pc">alış ₺${r.cost}</span>` +
      `<button class="btn pbtn" data-pf="${r.f}" data-pd="-0.5" ${r.canDown ? '' : 'disabled'}>−</button>` +
      `<span class="pv">₺${r.price.toFixed(1)}</span>` +
      `<button class="btn pbtn" data-pf="${r.f}" data-pd="0.5" ${r.canUp ? '' : 'disabled'}>+</button></div>`).join('')
    if (card.action) {
      this.infoAction.style.display = 'flex'
      this.infoAction.textContent = stripEmoji(card.action.label)
      this.currentAction = card.action.maintId
    } else {
      this.infoAction.style.display = 'none'
      this.currentAction = null
    }
    if (card.move) {
      this.infoMove.style.display = 'flex'
      this.infoMove.textContent = stripEmoji(card.move.label)
      this.currentMove = card.move.id
    } else {
      this.infoMove.style.display = 'none'
      this.currentMove = null
    }
    const buyBtn = el<HTMLButtonElement>('binfo-buy')
    if (card.buy) {
      buyBtn.style.display = 'flex'
      buyBtn.textContent = stripEmoji(card.buy.label)
      this.currentBuy = card.buy.id
    } else {
      buyBtn.style.display = 'none'
      this.currentBuy = null
    }
    this.infoCard.classList.add('show')
  }

  private accountEmail: string | null = null

  /** hesap durumunu ayarlar panelinde göster */
  syncAccount(email: string | null) {
    this.accountEmail = email
    el<HTMLDivElement>('accstatus').textContent = email
      ? `Giriş yapıldı: ${email} — kaydın buluta senkronlanıyor.`
      : 'Giriş gerekli — oturum kapandı, sayfayı yenile.'
    el<HTMLInputElement>('accemail').style.display = email ? 'none' : 'block'
    el<HTMLInputElement>('accpass').style.display = email ? 'none' : 'block'
    el<HTMLButtonElement>('loginbtn').style.display = email ? 'none' : 'flex'
    el<HTMLButtonElement>('registerbtn').style.display = email ? 'none' : 'flex'
    el<HTMLButtonElement>('logoutbtn').style.display = email ? 'flex' : 'none'
  }

  hideBuildingCard() {
    this.infoCard.classList.remove('show')
    this.currentAction = null
    this.currentMove = null
  }

  get buildingCardVisible() {
    return this.infoCard.classList.contains('show')
  }

  // ---- mağaza ----

  private renderShop(state: GameState) {
    if (this.shopCat === 'bakim') {
      const maint = getMaintenanceItems(state)
      this.shopList.innerHTML = maint.length === 0
        ? `<div class="sd" style="text-align:center; padding:18px 0">Her şey yolunda — bakım gereken bir şey yok.</div>`
        : maint.map(r => {
          const cls = r.urgent ? 'shoprow urgent' : 'shoprow'
          const disabled = r.disabled || state.money < r.cost
          return `<div class="${cls}">
            ${sicon(r.id, r.icon)}
            <div class="sinfo"><div class="st">${stripEmoji(r.title)}</div></div>
            <button class="btn sbuy ${r.urgent ? 'danger' : ''}" data-maint="${r.id}" ${disabled ? 'disabled' : ''}>₺${r.cost.toLocaleString('tr-TR')}</button></div>`
        }).join('')
      return
    }
    const rows = getShopItems(state).filter(r => CATEGORY_MAP[r.id] === this.shopCat)
    this.shopList.innerHTML = '<div class="shopgrid">' + rows.map(r => {
      const cls = r.status === 'maxed' ? 'card maxed' : r.status === 'locked' ? 'card locked' : 'card'
      let btn: string
      if (r.status === 'maxed') btn = `<button class="btn cbuy" disabled>MAKS</button>`
      else if (r.status === 'locked') btn = `<button class="btn cbuy" disabled>KİLİTLİ</button>`
      else {
        const afford = state.money >= (r.cost ?? 0)
        btn = `<button class="btn cbuy ${afford ? 'good' : ''}" data-buy="${r.id}" ${afford ? '' : 'disabled'}>₺${r.cost?.toLocaleString('tr-TR')}</button>`
      }
      const thumb = this.getThumb(r.id)
      const visual = thumb
        ? `<img src="${thumb}" alt="">`
        : `<span style="color:#7a8290">${icon(r.icon, 'ic cbig')}</span>`
      const lock = r.status === 'locked' ? `<div class="slock">${stripEmoji(r.note)}</div>` : ''
      const dims = DIMS[r.id] ? `<span class="stat-badge dim">${DIMS[r.id](state)}</span>` : ''
      return `<div class="${cls}">
        <div class="cthumb">${visual}</div>
        <div class="cname">${stripEmoji(r.title)}</div>
        <div class="cbadges"><span class="stat-badge">${stripEmoji(r.stat)}</span>${dims}</div>
        <div class="cdesc">${stripEmoji(r.desc)}</div>${lock}
        ${btn}</div>`
    }).join('') + '</div>'
  }

  update(state: GameState, dt: number) {
    this.money.textContent = Math.round(state.money).toLocaleString('tr-TR')
    this.day.textContent = `${state.day}`
    this.rep.textContent = state.reputation.toFixed(1)
    el<HTMLSpanElement>('quest').textContent = state.dailyDone ? 'TAMAM' : `${state.dailyServed}/15`
    const ts = this.tankerStatus()
    const tpanel = el<HTMLDivElement>('tankerpanel')
    tpanel.style.display = ts.length ? 'flex' : 'none'
    if (ts.length) {
      tpanel.innerHTML = ts.map(t =>
        `<div class="trow">${icon('i-truck')} <span>${t}</span></div>`).join('')
    }
    el<HTMLDivElement>('acc-email').textContent = this.accountEmail ?? '—'
    el<HTMLDivElement>('acc-streak').textContent = `Giriş serisi: ${state.loginStreak} gün · Oyun günü: ${state.day}`
    el<HTMLDivElement>('acc-ach').textContent = `Başarımlar: ${state.achievements.size}/8 · Görev: ${state.dailyDone ? 'tamamlandı' : state.dailyServed + '/15'}`

    // yakıt türü başına tank barları + sipariş modalı satırları
    let anyLow = false
    for (const f of FUELS) {
      const lvl = state.tanks[f]
      if (lvl < state.tankCapacity * 0.15) anyLow = true
      el<HTMLDivElement>(`fill-${f}`).style.width = `${(lvl / state.tankCapacity) * 100}%`
      el<HTMLSpanElement>(`lvl-${f}`).textContent = `${Math.round(lvl)}L`
      const o = state.orders[f]
      const need = state.orderNeed(f)
      const btn = el<HTMLButtonElement>(`fbtn-${f}`)
      const info = el<HTMLDivElement>(`fneed-${f}`)
      if (o.pending) {
        info.textContent = `Tanker yolda — ${Math.ceil(o.eta)} sn`
        btn.textContent = 'Yolda'
        btn.disabled = true
      } else if (need < 100) {
        info.textContent = 'Tank dolu'
        btn.textContent = 'Dolu'
        btn.disabled = true
      } else {
        info.textContent = `${Math.round(state.tanks[f])} / ${state.tankCapacity}L — ${need}L eksik`
        btn.textContent = `₺${state.orderCost(f).toLocaleString('tr-TR')}`
        btn.disabled = !state.canOrder(f)
      }
    }

    this.closeLabel.textContent = state.closed ? 'KAPALI' : 'Açık'
    this.closeBtn.classList.toggle('danger', state.closed)

    if (state.batteryLevel > 0) {
      this.battChip.style.display = 'flex'
      this.battFill.style.width = `${(state.battery / state.batteryCapacity) * 100}%`
      this.battKwh.textContent = `${Math.floor(state.battery)}/${state.batteryCapacity}`
    }

    this.orderLabel.textContent = 'Yakıt Siparişi'
    this.orderBtn.classList.toggle('danger', anyLow)
    this.orderBtn.classList.toggle('warn', !anyLow)

    const maintCount = getMaintenanceItems(state).filter(m => !m.disabled).length
    this.shopBtn.classList.toggle('danger', maintCount > 0)
    this.shopBtn.classList.toggle('primary', maintCount === 0)
    this.maintBadge.style.display = maintCount > 0 ? 'inline-block' : 'none'
    this.maintBadge.textContent = `${maintCount}`
    const dot = el<HTMLSpanElement>('shopdot')
    dot.style.display = maintCount > 0 ? 'flex' : 'none'
    dot.textContent = `${maintCount}`

    if (this.shopOpen) {
      this.shopRenderT -= dt
      if (this.shopRenderT <= 0) {
        this.renderShop(state)
        this.shopRenderT = 0.4
      }
    }

    const car = this.activeCar
    if (car && car.phase === 'atPump' && car.kind === 'fuel' && (car.filling || car.filled > 0)) {
      this.progress.textContent = car.fullMode
        ? `${car.filled.toFixed(1)}L · ₺${car.filledValue.toFixed(0)} / FULL`
        : `${car.filled.toFixed(1)}L · ₺${car.filledValue.toFixed(0)} / ₺${car.targetAmount}`
    }
  }

  toast(msg: string, kind: 'good' | 'bad' | '' = '', silent = false) {
    if (!silent) {
      if (kind === 'good') audio.cash()
      else if (kind === 'bad') audio.bad()
    }
    const box = el<HTMLDivElement>('toasts')
    while (box.children.length >= 4) box.firstElementChild?.remove()
    const t = document.createElement('div')
    t.className = `toast ${kind}`
    t.textContent = stripEmoji(msg)
    box.appendChild(t)
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s' }, 3000)
    setTimeout(() => t.remove(), 3500)
  }

  showBoom() {
    el<HTMLDivElement>('boom').classList.add('show')
  }
}
