/**
 * Web Audio tabanlı ses sistemi — dosya yok, her şey sentez.
 * İlk kullanıcı dokunuşunda ensure() ile açılır (tarayıcı autoplay kuralı).
 */
class AudioMan {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private musicGain: GainNode | null = null
  private musicTimer: number | null = null
  private bar = 0
  sfxOn = localStorage.getItem('benzinlik-sfx') !== '0'
  musicOn = localStorage.getItem('benzinlik-music') !== '0'

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume()
      return
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    this.ctx = new AC()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.9
    this.master.connect(this.ctx.destination)
    this.musicGain = this.ctx.createGain()
    this.musicGain.gain.value = this.musicOn ? 1 : 0
    this.musicGain.connect(this.master)
    this.startMusic()
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, dest?: AudioNode) {
    if (!this.ctx || !this.master) return
    const t0 = this.ctx.currentTime + when
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(vol, t0 + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur)
    osc.connect(g)
    g.connect(dest ?? this.master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.05)
  }

  // ---- efektler ----
  private canSfx() { return this.sfxOn && !!this.ctx }

  click() { if (this.canSfx()) this.tone(660, 0.07, 'triangle', 0.12) }

  cash() {
    if (!this.canSfx()) return
    this.tone(880, 0.09, 'sine', 0.16)
    this.tone(1320, 0.14, 'sine', 0.14, 0.07)
  }

  bad() {
    if (!this.canSfx()) return
    this.tone(180, 0.16, 'sawtooth', 0.055)
    this.tone(140, 0.2, 'sawtooth', 0.05, 0.07)
  }

  /** kaçan müşteri: sinir bozmayan, kısık "of ya" iniltisi */
  miss() {
    if (!this.canSfx()) return
    this.tone(330, 0.12, 'sine', 0.05)
    this.tone(262, 0.18, 'sine', 0.045, 0.1)
  }

  /** başarım fanfarı */
  achieve() {
    if (!this.canSfx()) return
    const notes = [523.3, 659.3, 784.0, 1046.5]
    notes.forEach((n, i) => this.tone(n, 0.28, 'triangle', 0.12, i * 0.09))
  }

  build() {
    if (!this.canSfx()) return
    this.tone(200, 0.1, 'square', 0.1)
    this.tone(320, 0.12, 'triangle', 0.12, 0.09)
    this.tone(420, 0.16, 'triangle', 0.1, 0.18)
  }

  boom() {
    if (!this.ctx || !this.master) return
    const t0 = this.ctx.currentTime
    const len = this.ctx.sampleRate * 1.4
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2)
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    const g = this.ctx.createGain()
    g.gain.value = 0.5
    const lp = this.ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(900, t0)
    lp.frequency.exponentialRampToValueAtTime(90, t0 + 1.2)
    src.connect(lp); lp.connect(g); g.connect(this.master)
    src.start(t0)
  }

  // ---- tempolu, neşeli arka plan loop'u (120 BPM, C majör I-V-vi-IV) ----
  private nextStep = 0
  private nextTime = 0

  private hat(when: number, vol: number) {
    if (!this.ctx || !this.musicGain) return
    const len = Math.floor(this.ctx.sampleRate * 0.05)
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    const hp = this.ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 6000
    const g = this.ctx.createGain()
    g.gain.value = vol
    src.connect(hp); hp.connect(g); g.connect(this.musicGain)
    src.start(when)
  }

  private startMusic() {
    if (!this.ctx || this.musicTimer !== null) return
    const stepDur = 60 / 100 / 2 // 100 BPM, 8'lik grid — sakin ama yürüyen
    const ROOTS = [130.8, 98.0, 110.0, 87.3] // C3 G2 A2 F2
    const st = (root: number, semi: number) => root * Math.pow(2, semi / 12)
    const PENTA = [0, 3, 5, 7, 10, 12]
    this.nextTime = this.ctx.currentTime + 0.1
    this.nextStep = 0
    const tick = () => {
      if (!this.ctx || !this.musicGain) return
      while (this.nextTime < this.ctx.currentTime + 0.4) {
        const step = this.nextStep % 8
        const bar = Math.floor(this.nextStep / 8)
        const root = ROOTS[bar % 4]
        const when = this.nextTime - this.ctx.currentTime
        // yumuşak sine bas: sadece 1. ve 5. vuruş, hafif oktav
        if (step === 0) this.tone(root / 2, 0.6, 'sine', 0.06, when, this.musicGain)
        if (step === 4) this.tone(root, 0.45, 'sine', 0.045, when, this.musicGain)
        // sıcak akor dokunuşu: off-beat'te çok kısık üçlü
        if (step === 2 || step === 6) {
          this.tone(st(root, 4) * 2, 0.5, 'triangle', 0.016, when, this.musicGain)
          this.tone(st(root, 7) * 2, 0.5, 'triangle', 0.014, when, this.musicGain)
        }
        // seyrek pentatonik melodi: sadece çift barlarda, yumuşak sine
        if (bar % 2 === 0 && (step === 1 || step === 5 || (step === 7 && bar % 4 === 0))) {
          const n = PENTA[(bar * 3 + step * 5) % PENTA.length]
          this.tone(st(root, 12 + n) * 2, 0.55, 'sine', 0.026, when, this.musicGain)
        }
        // çok kısık hi-hat: yalnızca 3. ve 7. adım
        if (step === 3 || step === 7) this.hat(this.nextTime, 0.008)
        this.nextTime += stepDur
        this.nextStep++
      }
    }
    tick()
    this.musicTimer = window.setInterval(tick, 150)
  }

  toggleMusic(): boolean {
    this.musicOn = !this.musicOn
    localStorage.setItem('benzinlik-music', this.musicOn ? '1' : '0')
    this.ensure()
    if (this.musicGain) this.musicGain.gain.value = this.musicOn ? 1 : 0
    return this.musicOn
  }

  toggleSfx(): boolean {
    this.sfxOn = !this.sfxOn
    localStorage.setItem('benzinlik-sfx', this.sfxOn ? '1' : '0')
    this.ensure()
    if (this.sfxOn) this.click()
    return this.sfxOn
  }
}

export const audio = new AudioMan()
