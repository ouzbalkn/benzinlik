/**
 * Basit i18n: TR anahtar → EN değer. Varsayılan TR; EN eksikse TR'ye düşer (asla boş kalmaz).
 * Dil: localStorage > tarayıcı dili. Değişince reload (tüm metinler tazelenir).
 */
const LANG_KEY = 'beneloil-lang'

function detect(): 'tr' | 'en' {
  const saved = localStorage.getItem(LANG_KEY)
  if (saved === 'tr' || saved === 'en') return saved
  return (navigator.language || '').toLowerCase().startsWith('tr') ? 'tr' : 'en'
}

export let lang: 'tr' | 'en' = detect()

export function setLang(l: 'tr' | 'en') {
  localStorage.setItem(LANG_KEY, l)
  location.reload()
}

// TR metin → EN karşılığı. Anahtar = kaynak koddaki TR string.
const EN: Record<string, string> = {
  // --- Giriş ekranı ---
  'BENELOIL': 'BENELOIL',
  'İstasyonunu kur, imparatorluğunu büyüt. İlerlemen hesabında güvende.':
    'Build your station, grow your empire. Your progress is saved to your account.',
  'oyuncu istasyonunu kurdu': 'players built their station',
  'şu an oyunda': 'playing now',
  'e-posta': 'email',
  'şifre': 'password',
  'Giriş Yap': 'Sign In',
  'Kayıt Ol': 'Sign Up',
  'Kayıt olarak': 'By signing up you accept our',
  'Kullanım Şartları': 'Terms of Service',
  've': 'and',
  "Gizlilik Politikası'nı kabul etmiş olursun.": 'Privacy Policy.',
  'Sunucuya ulaşılamadı.': 'Could not reach the server.',
  'Sunucu hatası.': 'Server error.',

  // --- HUD ---
  'GÜN': 'DAY', 'KASA': 'CASH', 'BENZİN': 'PETROL', 'DİZEL': 'DIESEL', 'LPG': 'LPG',
  'BATARYA': 'BATTERY', 'İTİBAR': 'RATING', 'GÜNLÜK GÖREV': 'DAILY QUEST', 'OYUNDA': 'ONLINE',
  'Açık': 'Open', 'KAPALI': 'CLOSED', 'Yakıt Siparişi': 'Order Fuel', 'İnşaat': 'Build',
  'Düzenleme modu': 'Edit mode', 'Hesabım': 'My Account', 'Ayarlar': 'Settings', 'Sorun Bildir': 'Report Issue',

  // --- Servis paneli ---
  'MÜŞTERİ İSTEĞİ': 'CUSTOMER REQUEST', 'Benzin': 'Petrol', 'Dizel': 'Diesel',
  'FULLE': 'FILL UP', 'BAŞLAT': 'START', 'HIZLI ŞARJ': 'FAST CHARGE', 'ŞARJ BAŞLAT': 'START CHARGING',
  'Müşteriyi Gönder': 'Dismiss Customer', 'Tabanca seç; tutar gir ya da FULLE': 'Pick a nozzle; enter amount or FILL UP',
  '₺ tutar gir': '₺ enter amount',

  // --- Sipariş modalı ---
  'Yolda': 'On the way', 'Dolu': 'Full', 'Tank dolu': 'Tank full', 'Sipariş': 'Order',
  'Tanker istasyona yaklaşıyor…': 'Tanker approaching the station…',

  // --- İnşaat / genel butonlar ---
  'İnşaat & Yatırım': 'Build & Invest', 'İstasyon': 'Station', 'Tesisler': 'Facilities',
  'Enerji': 'Energy', 'Arsa': 'Land', 'Bakım': 'Maintenance',
  'Taşı': 'Move', 'Yükselt': 'Upgrade', 'Satın Al': 'Buy', 'Kapat': 'Close', 'Gönder': 'Send',

  // --- Ayarlar ---
  'Dil': 'Language', 'Türkçe': 'Turkish', 'İngilizce': 'English',
  'Kaydı Sil ve Baştan Başla': 'Delete Save & Restart',
  'Hesap (kaydın bulutta saklanır)': 'Account (your save is stored in the cloud)',
  'Giriş yapılmadı.': 'Not signed in.', 'Çıkış Yap': 'Log Out',
  'Bug mu buldun, önerin mi var? Yaz gönder — hepsini okuyoruz.':
    'Found a bug or have a suggestion? Write it — we read them all.',
  'Örn: girişte araçlar sıkışıyor / şu özellik olsa süper olur...':
    'e.g. cars jam at the entrance / this feature would be great...',
  'Bildirimin alındı — teşekkürler, okuyoruz!': 'Feedback received — thank you, we read them!',
  'Mesaj çok kısa — biraz detay ver.': 'Message too short — add a bit more detail.',

  // --- Sık toast'lar ---
  'Taşındı!': 'Moved!', '💸 Para yetmiyor!': "💸 Can't afford it!",
  'Sıfırdan başlıyorsun — hayırlı olsun patron!': 'Starting fresh — good luck, boss!',
  'İstasyon tekrar AÇIK — bekleriz!': 'Station is OPEN again — welcome!',
  'Müşteri beklemekten sıkıldı ve gitti!': 'Customer got tired of waiting and left!',
  'Çıkış yapıldı.': 'Logged out.',
}

export function t(tr: string): string {
  if (lang === 'tr') return tr
  return EN[tr] ?? tr
}

/** data-i18n="TR metin" olan tüm elemanları çevir (index.html statik metinleri) */
export function translateDom(root: ParentNode = document) {
  if (lang === 'tr') return
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.getAttribute('data-i18n') || ''
    if (key && EN[key]) el.textContent = EN[key]
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-ph]')) {
    const key = el.getAttribute('data-i18n-ph') || ''
    if (key && EN[key]) (el as HTMLInputElement).placeholder = EN[key]
  }
}
