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
    this.tone(180, 0.2, 'sawtooth', 0.1)
    this.tone(140, 0.25, 'sawtooth', 0.09, 0.08)
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

  // ---- hafif arka plan melodisi ----
  private startMusic() {
    if (!this.ctx || this.musicTimer !== null) return
    const CHORDS = [
      [261.6, 329.6, 392.0],  // C
      [220.0, 261.6, 329.6],  // Am
      [174.6, 220.0, 261.6],  // F
      [196.0, 246.9, 293.7],  // G
    ]
    const PENTA = [523.3, 587.3, 659.3, 784.0, 880.0]
    const step = () => {
      if (!this.ctx || !this.musicGain) return
      const chord = CHORDS[this.bar % CHORDS.length]
      for (const f of chord) this.tone(f / 2, 4.4, 'triangle', 0.035, 0.05, this.musicGain)
      // seyrek tatlı melodi notaları
      for (let k = 0; k < 4; k++) {
        if (Math.random() < 0.55) {
          const n = PENTA[Math.floor(Math.random() * PENTA.length)]
          this.tone(n, 0.5, 'sine', 0.03, 0.3 + k * 1.1, this.musicGain)
        }
      }
      this.bar++
    }
    step()
    this.musicTimer = window.setInterval(step, 4600)
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
