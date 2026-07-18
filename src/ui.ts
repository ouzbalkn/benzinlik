import { Car } from './cars'
import { FuelType, FUEL_LABEL, GameState, getShopItems, getMaintenanceItems } from './state'

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

export interface BuildingCard {
  icon: string
  name: string
  desc: string
  stats: [string, string, ('' | 'good' | 'bad')?][]
  action?: { label: string; maintId: string }
}

export class UI {
  activeCar: Car | null = null

  onNozzle: (car: Car, type: FuelType) => void = () => {}
  onStart: (car: Car, amount: number) => void = () => {}
  onChargeEV: (car: Car) => void = () => {}
  onOrder: () => void = () => {}
  onBuy: (id: string) => void = () => {}
  onMaint: (id: string) => void = () => {}
  onRename: (name: string) => void = () => {}
  onCardClose: () => void = () => {}
  batteryKwh: () => number = () => 0

  private money = el<HTMLSpanElement>('money')
  private tankL = el<HTMLSpanElement>('tankL')
  private tankFill = el<HTMLDivElement>('tankfill')
  private battChip = el<HTMLDivElement>('battchip')
  private battFill = el<HTMLDivElement>('battfill')
  private battKwh = el<HTMLSpanElement>('battkwh')
  private rep = el<HTMLSpanElement>('rep')
  private orderBtn = el<HTMLButtonElement>('orderbtn')
  private shopBtn = el<HTMLButtonElement>('shopbtn')
  private shopWrap = el<HTMLDivElement>('shopwrap')
  private shopList = el<HTMLDivElement>('shoplist')
  private maintHead = el<HTMLDivElement>('mainthead')
  private maintList = el<HTMLDivElement>('maintlist')
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
  private infoCard = el<HTMLDivElement>('infocard')
  private infoAction = el<HTMLButtonElement>('binfo-action')
  private currentAction: string | null = null

  private shopOpen = false
  private shopRenderT = 0

  constructor() {
    this.orderBtn.addEventListener('click', () => this.onOrder())

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

    const save = () => {
      this.onRename(nameInput.value)
      setWrap.classList.remove('show')
    }
    el<HTMLButtonElement>('stsave').addEventListener('click', save)
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') save() })

    // servis paneli
    this.nozBenzin.addEventListener('click', () => this.pickNozzle('benzin'))
    this.nozDizel.addEventListener('click', () => this.pickNozzle('dizel'))
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
    this.chargeBtn.addEventListener('click', () => {
      if (this.activeCar?.kind === 'ev') this.onChargeEV(this.activeCar)
    })

    // bina kartı
    el<HTMLButtonElement>('binfo-close').addEventListener('click', () => {
      this.hideBuildingCard()
      this.onCardClose()
    })
    this.infoAction.addEventListener('click', () => {
      if (this.currentAction) this.onMaint(this.currentAction)
    })

    // mağaza tıklamaları
    const shopClick = (e: Event) => {
      const btn = (e.target as HTMLElement).closest('button[data-buy], button[data-maint]') as HTMLButtonElement | null
      if (!btn) return
      if (btn.dataset.buy) this.onBuy(btn.dataset.buy)
      if (btn.dataset.maint) this.onMaint(btn.dataset.maint)
      this.shopRenderT = 0
    }
    this.shopList.addEventListener('click', shopClick)
    this.maintList.addEventListener('click', shopClick)
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

    if (car.kind === 'ev') {
      this.fuelCtl.style.display = 'none'
      this.evCtl.style.display = 'block'
      this.demand.textContent = `🔌 Elektrikli araç · İstek: ${car.demandKwh} kWh`
      const have = this.batteryKwh()
      const enough = have >= car.demandKwh
      this.chargeBtn.disabled = !enough
      this.chargeBtn.textContent = `⚡ HIZLI ŞARJ (${car.demandKwh} kWh)`
      this.evNote.textContent = enough
        ? 'Batarya hazır — anında şarj, müşteri hemen yola çıkar.'
        : `Bataryada yeterli enerji yok (${Math.floor(have)}/${car.demandKwh} kWh).`
      return
    }

    this.fuelCtl.style.display = 'block'
    this.evCtl.style.display = 'none'
    this.demand.textContent = `🚗 Müşteri isteği: ₺${car.demandAmount} ${FUEL_LABEL[car.demandType]}`
    this.nozBenzin.classList.toggle('sel', car.nozzle === 'benzin')
    this.nozDizel.classList.toggle('sel', car.nozzle === 'dizel')
    const locked = car.filled > 0 || car.filling
    this.nozBenzin.disabled = locked
    this.nozDizel.disabled = locked
    this.amount.disabled = car.filling
    const amt = Math.floor(Number(this.amount.value))
    this.startBtn.disabled = !car.nozzle || !(amt > 0) || car.filling || car.filled > 0
    if (!car.filling && car.filled === 0) this.progress.textContent = 'Tabanca seç, tutar gir, başlat'
  }

  // ---- bina bilgi kartı ----

  showBuildingCard(card: BuildingCard) {
    el<HTMLDivElement>('binfo-icon').textContent = card.icon
    el<HTMLDivElement>('binfo-name').textContent = card.name
    el<HTMLDivElement>('binfo-desc').textContent = card.desc
    el<HTMLDivElement>('binfo-stats').innerHTML = card.stats.map(([k, v, cls]) =>
      `<div class="stat"><span class="k">${k}</span><span class="v ${cls ?? ''}">${v}</span></div>`).join('')
    if (card.action) {
      this.infoAction.style.display = 'block'
      this.infoAction.textContent = card.action.label
      this.currentAction = card.action.maintId
    } else {
      this.infoAction.style.display = 'none'
      this.currentAction = null
    }
    this.infoCard.classList.add('show')
  }

  hideBuildingCard() {
    this.infoCard.classList.remove('show')
    this.currentAction = null
  }

  get buildingCardVisible() {
    return this.infoCard.classList.contains('show')
  }

  // ---- mağaza ----

  private renderShop(state: GameState) {
    const rows = getShopItems(state)
    this.shopList.innerHTML = rows.map(r => {
      const cls = r.status === 'maxed' ? 'shoprow maxed' : 'shoprow'
      let btn: string
      if (r.status === 'maxed') btn = `<button class="btn sbuy" disabled>MAKS</button>`
      else if (r.status === 'locked') btn = `<button class="btn sbuy" disabled>🔒</button>`
      else {
        const afford = state.money >= (r.cost ?? 0)
        btn = `<button class="btn sbuy ${afford ? 'good' : ''}" data-buy="${r.id}" ${afford ? '' : 'disabled'}>₺${r.cost?.toLocaleString('tr-TR')}</button>`
      }
      const lock = r.status === 'locked' ? `<div class="slock">🔒 ${r.note}</div>` : ''
      return `<div class="${cls}">
        <div class="sicon">${r.icon}</div>
        <div class="sinfo">
          <div class="st">${r.title} <span class="stat-badge">${r.stat}</span></div>
          <div class="sd">${r.desc}</div>${lock}
        </div>${btn}</div>`
    }).join('')

    const maint = getMaintenanceItems(state)
    this.maintHead.style.display = maint.length ? 'block' : 'none'
    this.maintList.innerHTML = maint.map(r => {
      const cls = r.urgent ? 'shoprow urgent' : 'shoprow'
      const disabled = r.disabled || state.money < r.cost
      return `<div class="${cls}">
        <div class="sicon">${r.icon}</div>
        <div class="sinfo"><div class="st">${r.title}</div></div>
        <button class="btn sbuy ${r.urgent ? 'danger' : ''}" data-maint="${r.id}" ${disabled ? 'disabled' : ''}>₺${r.cost.toLocaleString('tr-TR')}</button></div>`
    }).join('')
  }

  update(state: GameState, dt: number) {
    this.money.textContent = Math.round(state.money).toLocaleString('tr-TR')
    this.tankL.textContent = `${Math.round(state.tank)}L`
    this.tankFill.style.width = `${(state.tank / state.tankCapacity) * 100}%`
    this.rep.textContent = state.reputation.toFixed(1)

    if (state.batteryLevel > 0) {
      this.battChip.style.display = 'flex'
      this.battFill.style.width = `${(state.battery / state.batteryCapacity) * 100}%`
      this.battKwh.textContent = `${Math.floor(state.battery)}/${state.batteryCapacity}`
    }

    if (state.orderPending) {
      this.orderBtn.textContent = `🚛 Yolda · ${Math.ceil(state.orderEta)}sn`
      this.orderBtn.disabled = true
    } else {
      const need = state.orderNeed()
      this.orderBtn.textContent = need < 100
        ? '🚛 Tank dolu'
        : `🚛 Sipariş · ${need}L · ₺${state.orderCost().toLocaleString('tr-TR')}`
      this.orderBtn.disabled = !state.canOrder()
    }

    const maintCount = getMaintenanceItems(state).filter(m => !m.disabled).length
    this.shopBtn.textContent = maintCount > 0 ? `🏗️ İnşaat ❗${maintCount}` : '🏗️ İnşaat'
    this.shopBtn.classList.toggle('danger', maintCount > 0)
    this.shopBtn.classList.toggle('primary', maintCount === 0)

    if (this.shopOpen) {
      this.shopRenderT -= dt
      if (this.shopRenderT <= 0) {
        this.renderShop(state)
        this.shopRenderT = 0.4
      }
    }

    const car = this.activeCar
    if (car && car.phase === 'atPump' && car.kind === 'fuel' && (car.filling || car.filled > 0)) {
      this.progress.textContent = `⛽ ${car.filled.toFixed(1)}L · ₺${car.filledValue.toFixed(0)} / ₺${car.targetAmount}`
    }
  }

  toast(msg: string, kind: 'good' | 'bad' | '' = '') {
    const box = el<HTMLDivElement>('toasts')
    while (box.children.length >= 4) box.firstElementChild?.remove()
    const t = document.createElement('div')
    t.className = `toast ${kind}`
    t.textContent = msg
    box.appendChild(t)
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s' }, 3000)
    setTimeout(() => t.remove(), 3500)
  }

  showBoom() {
    el<HTMLDivElement>('boom').classList.add('show')
  }
}
