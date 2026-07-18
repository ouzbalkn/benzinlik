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
    const stepDur = 60 / 120 / 2 // 8'lik nota
    // akor kökleri (bas): C2 G2 A2 F2 — her akor 1 ölçü (8 adım)
    const ROOTS = [65.4, 98.0, 110.0, 87.3]
    const st = (root: number, semi: number) => root * Math.pow(2, semi / 12)
    // zıplayan bas kalıbı (yarım oktav oyunları) + neşeli melodi motifi (akora göre yarıton ofsetleri)
    const BASS_PAT = [0, 12, 7, 12, 0, 12, 7, 10]
    const LEAD_PATS = [
      [24, 28, 31, 36, 31, 28, 24, 28],
      [24, 31, 28, 24, 36, 31, 28, 26],
    ]
    this.nextTime = this.ctx.currentTime + 0.1
    this.nextStep = 0
    const tick = () => {
      if (!this.ctx || !this.musicGain) return
      while (this.nextTime < this.ctx.currentTime + 0.35) {
        const step = this.nextStep % 8
        const bar = Math.floor(this.nextStep / 8)
        const root = ROOTS[bar % 4]
        const when = this.nextTime - this.ctx.currentTime
        // bas: her 8'likte kısa tok vuruş
        this.tone(st(root, BASS_PAT[step]), 0.16, 'triangle', 0.075, when, this.musicGain!)
        // hi-hat: off-beat tıkırtısı
        if (step % 2 === 1) this.hat(this.nextTime, 0.018)
        // melodi: her ölçüde motif, 2 ölçüde bir varyasyon; 4. barda nefes
        if (bar % 4 !== 3 || step < 4) {
          const pat = LEAD_PATS[bar % 2]
          if (step % 2 === 0 || (bar + step) % 3 === 0) {
            this.tone(st(root, pat[step]), 0.22, 'square', 0.028, when, this.musicGain!)
          }
        }
        this.nextTime += stepDur
        this.nextStep++
      }
    }
    tick()
    this.musicTimer = window.setInterval(tick, 120)
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
