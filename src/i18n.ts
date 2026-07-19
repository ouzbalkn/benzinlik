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
  'Pompa arızalandı — dolum yarıda kaldı, tamir gerekli.': 'Pump broke down — refill cut short, repair needed.',
  'Şarj ünitesi arızalandı — şarj durdu, tamir gerekli.': 'Charger broke down — charging stopped, repair needed.',
  '🚿 OTO YIKAMA': '🚿 CAR WASH',
  '☕ KAHVE': '☕ COFFEE',
  '🍽️ RESTORAN': '🍽️ RESTAURANT',
  '🚛 TIR PARKI': '🚛 TRUCK STOP',
  '🧽 SELF YIKAMA': '🧽 SELF WASH',
  'HAVA · SU': 'AIR · WATER',
  '{0} L/sn': '{0} L/s',
  '+3 kWh/sn': '+3 kWh/s',
  '+7 kWh/sn': '+7 kWh/s',
  '+15 kWh/sn': '+15 kWh/s',
  'Müzik: Açık': 'Music: On',
  'Müzik: Kapalı': 'Music: Off',
  'Efektler: Kapalı': 'Effects: Off',
  'Bildirimler: Engelli': 'Notifications: Blocked',
  'Oyun kaydı otomatik tutulur (her 5 sn)': 'Game auto-saves (every 5s)',
  '★ 7/24 AÇIK ★': '★ 24/7 OPEN ★',
  'ŞİMDİ OYNA': 'PLAY NOW',
  'Ses': 'Sound',
  'Kaydet': 'Save',
  'Çıkış': 'Log Out',
  'İstasyon adı (tabelada görünür)': 'Station name (shown on the sign)',
  'Bildirimler (sekme kapalıyken tanker/kumbara haberi)': 'Notifications (tanker/jar alerts when tab is inactive)',
  'Efektler: Açık': 'Effects: On',
  '🚨 {0} isteyen araca {1} bastın! -{2} ₺': '🚨 Pumped {1} into a car that wanted {0}! -{2} ₺',
  'Sen yokken tesislerin çalıştı: kumbaralarda ~₺{0} birikti — topla!': 'Your facilities worked while away: ~₺{0} in jars — collect it!',
  'İstasyon KAPALI — yeni müşteri girmez, itibar etkilenmez. Bakım için rahatsın.': 'Station CLOSED — no new customers, rating unaffected. Free to do maintenance.',
  'Beton iadesi: {0} arsa söküldü, +₺{1} iade edildi.': 'Paving refund: {0} plots removed, +₺{1} refunded.',
  'Benzin ve dizel dolumu. Müşterinin istediği yakıtı ve tutarı sen girersin — yanlış tabanca cezalıdır.': 'Petrol & diesel refills. You pick the fuel and amount — wrong nozzle is penalized.',
  'Santrallerin ürettiği elektriği biriktirir. Elektrikli araçlar buradan anında şarj alır.': 'Stores power from your plants. EVs charge from here instantly.',
  'FULLE {0}': 'FILL UP {0}',
  '🚨 {0} isteyen araca {1} verildi — CEZA!': '🚨 Gave {1} to a car that wanted {0} — PENALTY!',
  '🏞️ Arsa satın alındı (-₺{0}) — yapı için Zemin Betonu döşe.': '🏞️ Land purchased (-₺{0}) — pave it to build.',
  'Bulut kaydı yüklendi — Gün {0} ({1})': 'Cloud save loaded — Day {0} ({1})',
  'Sen yokken tesislerin çalıştı: kumbaralarda ~₺{0} birikti — toplamayı unutma!': 'Your facilities worked while away: ~₺{0} in jars — collect it!',
  'Beton iadesi: {0} arsa söküldü, +₺{1}': 'Paving refund: {0} plots removed, +₺{1}',
  '+{0} kWh/sn (şebeke dahil)': '+{0} kWh/s (grid included)',
  '🟢 Uranyum Sipariş Et — ₺{0}': '🟢 Order Uranium — ₺{0}',
  '📅 Gün {0} bitti — {1}: ₺{2}': '📅 Day {0} ended — {1}: ₺{2}',
  'kâr': 'profit',
  'zarar': 'loss',
  'Otomatik Şarj: {0} — değiştir': 'Auto-charge: {0} — toggle',
  'Ücreti Değiştir ({0} → {1})': 'Change Fee ({0} → {1})',
  'Müzik: {0}': 'Music: {0}',
  'Efektler: {0}': 'Effects: {0}',
  'ELEKTRİK': 'ELECTRIC',
  'ŞARJ OLUYOR — {0}/{1} kWh': 'CHARGING — {0}/{1} kWh',
  'ŞARJ BAŞLAT ({0} kWh)': 'START CHARGING ({0} kWh)',
  'Bataryada enerji yok ({0} kWh) — dolmasını bekle.': 'Battery empty ({0} kWh) — wait for it to fill.',
  'Depoda {0} kWh hazır — şarjı başlat.': '{0} kWh ready in depot — start charging.',
  'Giriş yapıldı: {0} — kaydın buluta senkronlanıyor.': 'Signed in: {0} — syncing your save to the cloud.',
  'Her şey yolunda': 'All good',
  'KİLİTLİ': 'LOCKED',
  'Giriş serisi: {0} gün · Oyun günü: {1}': 'Login streak: {0} days · Game day: {1}',
  'Başarımlar: {0}/8 · Görev: {1}': 'Achievements: {0}/8 · Quest: {1}',
  '{0} · boşaltıyor': '{0} · unloading',
  'Tır park etti: ₺{0} kumbarada': 'Truck parked: ₺{0} in the jar',
  '🛒 Market alışverişi: +₺{0}': '🛒 Market purchase: +₺{0}',
  '🚻 Tuvalet ücreti: +₺{0}': '🚻 Restroom fee: +₺{0}',
  '☕ Kahve satışı: +₺{0}': '☕ Coffee sale: +₺{0}',
  '🍽️ Restoran hesabı: +₺{0}': '🍽️ Restaurant bill: +₺{0}',
  'Araç yıkandı: ₺{0} kumbarada': 'Car washed: ₺{0} in the jar',
  '🔧 Yağ değişimi yapıldı: +₺{0}': '🔧 Oil changed: +₺{0}',
  'Günlük görev: {0}/15 müşteri': 'Daily quest: {0}/15 customers',
  '⚡ {0} kWh şarj tamamlandı: +₺{1}': '⚡ {0} kWh charged: +₺{1}',
  '⚡ Elektrik altyapısı Sv.{0} kuruldu!': '⚡ Power grid Lv.{0} built!',
  'Günlük giriş bonusu: +₺{0} (seri: {1} gün)': 'Daily login bonus: +₺{0} (streak: {1} days)',
  'DC Şarj #{0}: otomatik şarj AÇIK — EV sormadan şarj alır.': 'DC Charger #{0}: auto-charge ON — EVs charge without asking.',
  'DC Şarj #{0}: otomatik şarj kapalı.': 'DC Charger #{0}: auto-charge off.',
  'Tabela güncellendi: {0}': 'Sign updated: {0}',
  '+₺{0} toplandı!': '+₺{0} collected!',
  '{0} tankı boş kaldı! Satış yarım kaldı — sipariş ver.': '{0} tank ran dry! Sale cut short — order more.',
  'DC Şarj #{0}': 'DC Charger #{0}',
  '🔧 Pompa #{0} arıza yaptı! Üstüne tıklayıp karttan tamir et.': '🔧 Pump #{0} broke down! Click it and repair from the card.',
  '🔌 Şarj ünitesi #{0} arızalandı!': '🔌 Charger #{0} broke down!',
  '{0} kumbarası doldu — üstüne tıklayıp topla!': '{0} jar is full — click to collect!',
  'Güneş Santrali ({0})': 'Solar Plant ({0})',
  'Panel Temizliği (kir %{0})': 'Panel Cleaning (dirt {0}%)',
  'Reaktör Bakımı (yıpranma %{0})': 'Reactor Maintenance (wear {0}%)',
  'Uranyum Siparişi (%{0} kaldı)': 'Order Uranium ({0}% left)',
  'Şarj #{0} Tamiri': 'Charger #{0} Repair',
  '🏆 Başarım: {0}': '🏆 Achievement: {0}',
  'Pompa #{0} Tamiri': 'Pump #{0} Repair',
  'Tır parkı': 'Truck stop',
  'Oto yıkama': 'Car wash',
  'Self yıkama': 'Self wash',
  'Taşıma modu: yeni yeri seç · R ile döndür · sağ tık/ESC iptal': 'Move mode: pick a spot · R to rotate · right-click/ESC to cancel',
  'Yerleştirme modu: kareye tıkla · R ile döndür · sağ tık/ESC iptal': 'Placement mode: click a tile · R to rotate · right-click/ESC to cancel',
  '🏞️ Arsa seçimi: bitişik parsele tıkla (₺6-14 bin) · ESC iptal': '🏞️ Land: click an adjacent plot (₺6-14k) · ESC to cancel',
  '🧱 Zemin seçimi: betonlanacak arsana tıkla · ESC iptal': '🧱 Paving: click a plot to pave · ESC to cancel',
  'İstasyon KAPALI — yeni müşteri girmez, itibar etkilenmez. Bakım için rahatsız olmadan çalış.': 'Station CLOSED — no new customers, rating unaffected. Do maintenance in peace.',
  'BENZİNLİK': 'BENELOIL',
  'Benzin ve dizel dolumu. Müşterinin istediği yakıtı ve tutarı sen girersin — yanlış tabanca ceza, doğrusu bahşiş.': 'Petrol & diesel refills. You pick the fuel and amount — wrong nozzle penalized, right one tipped.',
  'Dolum hızı': 'Fill rate',
  'Elektrikli araçlar batarya deposundan anında şarj olur. Depoda yeterli kWh yoksa müşteri bekler.': 'EVs charge instantly from the battery depot. If it lacks kWh, the customer waits.',
  'AÇIK': 'OPEN',
  'Ofis — Fiyat Yönetimi': 'Office — Pricing',
  'Alış fiyatı sabittir; satış fiyatını sen belirlersin. Marjı açtıkça litre başı kazanç artar ama müşteri kaçar.': 'Buy price is fixed; you set the sell price. Bigger margin = more profit per liter but fewer customers.',
  'Toplam müşteri': 'Total customers',
  'Kaçan müşteri': 'Lost customers',
  'Benzin satışı': 'Petrol sold',
  'Dizel satışı': 'Diesel sold',
  'LPG satışı': 'LPG sold',
  'Elektrik satışı': 'Electricity sold',
  'Giriş Kapısı': 'Entrance Gate',
  'Çıkış Kapısı': 'Exit Gate',
  'Müşteriler ve tankerler istasyona buradan girer. Taşı butonuyla yol kenarında istediğin yere al — trafik akışı kendini uyarlar.': 'Customers and tankers enter here. Use Move to place it anywhere along the road — traffic adapts.',
  'Çıkışla arası en az 5 birim': 'At least 5 units from the exit',
  'Araçlar istasyondan buradan çıkıp yola karışır. Taşı butonuyla yerini belirle.': 'Cars leave the station here and merge onto the road. Use Move to position it.',
  'Girişle arası en az 5 birim': 'At least 5 units from the entrance',
  'Sattığın benzin ve dizel buradan çıkar. Bitirmeden tanker siparişi vermeyi unutma.': 'The petrol and diesel you sell come from here. Order a tanker before it runs dry.',
  'Santrallerin ürettiği elektriği biriktirir. Elektrikli araçlar buradan anında şarj olur.': 'Stores power from your plants. EVs charge from here instantly.',
  'Müşterilerin bir kısmı içeri girip alışveriş yapar — ekstra gelir ve memnuniyet.': 'Some customers come in and shop — extra income and satisfaction.',
  'Müşteri harcaması': 'Customer spend',
  'Uğrama oranı': 'Visit rate',
  'Yol yorgunları için. Ücret koyarsan gelir gelir ama memnuniyet biraz düşer.': 'For weary travelers. Charging a fee earns money but lowers satisfaction a bit.',
  'Bedava elektrik üretir ama paneller kirlendikçe verim düşer. Ara sıra temizlik yaptır.': 'Generates free power, but output drops as panels get dirty. Clean it occasionally.',
  'Tanktan mazot yakarak elektrik üretir. Çalışırken gürültüsü şarjdaki müşterileri rahatsız eder.': 'Burns diesel from the tank to make power. Its noise disturbs charging customers.',
  'Yakıt tüketimi': 'Fuel use',
  'ÇALIŞIYOR 🔊': 'RUNNING 🔊',
  'Yakıt alan müşterilerin bir kısmı çıkışta aracını yıkatır.': 'Some fueling customers wash their car on the way out.',
  'Hizmet ücreti': 'Service fee',
  'Kullanım oranı': 'Usage rate',
  'Park eden müşteriler kahve molası verir.': 'Parked customers take a coffee break.',
  'Uzun yol müşterisi park edip yemek yer — yüksek hesap öder.': 'Long-haul customers park and dine — big tab.',
  'Tırcılar konaklar; sen hiçbir şey yapmadan düzenli gelir akar.': 'Truckers stay over; steady income with zero effort.',
  'Lastik havası ve su. Küçük gelir ama müşteri çeker.': 'Tire air and water. Small income but draws customers.',
  'Kullanım': 'Usage',
  'Araçlar bölmelere girip kendileri yıkar; köpük ve su otomatik satılır.': 'Cars enter bays and wash themselves; foam and water sold automatically.',
  'Servisi biten müşteriler buraya park edip market, tuvalet, kahveci ve restoranı gezer.': 'Served customers park here to visit the market, restroom, cafe and restaurant.',
  '4 araç': '4 cars',
  'Bakım vakti gelen araçlar burada yağ değiştirir — en kârlı yan hizmet.': 'Cars due for service change oil here — the most profitable side service.',
  'YÜKSEK ☠️': 'HIGH ☠️',
  'Düşük': 'Low',
  '☢️ Bakım Yap — ₺1.500': '☢️ Maintain — ₺1,500',
  'En güçlü enerji kaynağı. Uranyumla çalışır, yıprandıkça patlama riski artar — bakımı ASLA aksatma.': 'The strongest power source. Runs on uranium; explosion risk grows with wear — NEVER skip maintenance.',
  'Yıpranma': 'Wear',
  'Düzenleme modu AÇIK: taşımak istediğin binaya tıkla (pompa, şarj ve tank sabittir)': 'Edit mode ON: click a building to move it (pumps, chargers and tank are fixed)',
  'Düzenleme modu kapandı.': 'Edit mode off.',
  'Bir parsele tıkla.': 'Click a plot.',
  'Bitişik değil — önce aradaki arsayı almalısın.': 'Not adjacent — buy the plot in between first.',
  'Bu arsa senin değil — önce satın al.': 'You don\'t own this plot — buy it first.',
  'Başarım': 'Achievement',
  'KRİTİK': 'CRITICAL',
  '🔧 ARIZA · TAMİR ₺800': '🔧 BROKEN · REPAIR ₺800',
  '🔧 ARIZA · TAMİR ₺1.000': '🔧 BROKEN · REPAIR ₺1,000',
  '🧽 TEMİZLİK ₺300': '🧽 CLEAN ₺300',
  '🚨 BAKIM ŞART ₺1.500': '🚨 MAINTAIN NOW ₺1,500',
  '🚨 URANYUM BİTTİ · ₺2.500': '🚨 OUT OF URANIUM · ₺2,500',
  'KENDİ BENZİNLİĞİNİ KUR': 'BUILD YOUR STATION',
  'YAKIT SATMAYA BAŞLA': 'START SELLING FUEL',
  'BÜYÜ VE GELİŞ': 'GROW & EXPAND',
  'MARKETİNİ AÇ, MÜŞTERİYİ TUT': 'OPEN A MARKET, KEEP CUSTOMERS',
  'ELEKTRİĞE GEÇ': 'GO ELECTRIC',
  'GÜNEŞ PANELLERİNİ KUR': 'INSTALL SOLAR PANELS',
  'NÜKLEER ÇAĞA ADIM AT': 'ENTER THE NUCLEAR AGE',
  'KENDİ PETROL İSTASYONUNU İŞLET': 'RUN YOUR OWN GAS STATION',
  'Gönderilemedi, tekrar dene.': 'Could not send, try again.',
  'Tüm ilerleme silinecek. Emin misin?': 'All progress will be erased. Are you sure?',
  'Kapalı': 'Closed',
  'Bildirimler: Açık': 'Notifications: On',
  'Bildirimlere İzin Ver': 'Enable Notifications',
  'MOLADA — ünite işgal altında': 'ON BREAK — unit occupied',
  'Şarj bitti ama müşteri tesislerde geziyor — MÜŞTERİYİ GÖNDER ile uğurla, yoksa yeni EV müşterileri kaçar!': 'Charge done but customer is roaming the facilities — DISMISS them or new EV customers will leave!',
  'Depodan araca enerji akıyor... depo seviyesi akış hızını belirler.': 'Energy flowing from depot to car... depot level sets the rate.',
  'Müşteri FULLE istiyor — tabancayı seç, FULLE bas': 'Customer wants FILL UP — pick the nozzle, hit FILL UP',
  'Giriş gerekli — oturum kapandı, sayfayı yenile.': 'Sign-in required — session ended, refresh the page.',
  'tamamlandı': 'completed',
  '🧽 Güneş panelleri iyice kirlendi, üretim düşüyor!': '🧽 Solar panels got dirty, output is dropping!',
  '☢️ Uranyum teslim edildi — reaktör tam güçte!': '☢️ Uranium delivered — reactor at full power!',
  '☢️ Uranyum azalıyor! Yeni çubuk sipariş et.': '☢️ Uranium running low! Order a new rod.',
  '🚨 Uranyum bitti — reaktör üretimi DURDU!': '🚨 Out of uranium — reactor output STOPPED!',
  '☢️ Reaktör bakım istiyor!': '☢️ Reactor needs maintenance!',
  '🚨 REAKTÖR KRİTİK! Hemen bakım yap yoksa patlayacak!': '🚨 REACTOR CRITICAL! Maintain now or it explodes!',
  'Yakıt indirimi sona erdi.': 'Fuel discount ended.',
  'Müşteri patlaması sona erdi.': 'Customer rush ended.',
  'FIRSAT: 60 saniye boyunca yakıt siparişi YARI FİYAT!': 'DEAL: fuel orders HALF PRICE for 60 seconds!',
  'FIRSAT: 60 saniye müşteri patlaması — pompalara koş!': 'DEAL: 60-second customer rush — hit the pumps!',
  'Önce batarya deposu kur': 'Build a battery depot first',
  'Altyapı Sv.2 gerekli': 'Grid Lv.2 required',
  'İlk ₺10.000 — Esnaf oldun!': 'First ₺10,000 — you\'re in business!',
  '5 yıldız itibar — Efsane istasyon!': '5-star rating — legendary station!',
  'Elektrik çağı — İlk şarj ünitesi!': 'Electric age — first charger!',
  'Atom karıncası — Reaktör kuruldu!': 'Atomic ant — reactor built!',
  'Toprak ağası — 9 arsanın tamamı!': 'Land baron — all 9 plots!',
  '7. gün — Bir haftadır ayaktasın!': 'Day 7 — a week strong!',
  'SAHİBİNDEN ALINDI': 'ACQUIRED',
  'YAĞ DEĞİŞİMİ': 'OIL CHANGE',


  // --- 3D bina etiketleri ---
  'YAKIT TANKI': 'FUEL TANK', 'GİRİŞ': 'ENTRANCE', 'ÇIKIŞ': 'EXIT', 'OFİS': 'OFFICE',
  'MARKET': 'MARKET', 'TUVALET': 'RESTROOM', 'BATARYA DEPOSU': 'BATTERY DEPOT',
  'GÜNEŞ SANTRALİ': 'SOLAR PLANT', 'JENERATÖR': 'GENERATOR', 'OTO YIKAMA': 'CAR WASH',
  'KAHVECİ': 'CAFE', 'RESTORAN': 'RESTAURANT', 'TIR PARKI': 'TRUCK STOP', 'SELF YIKAMA': 'SELF WASH',
  'OTOPARK': 'PARKING', 'HAVA-SU ÜNİTESİ': 'AIR & WATER', 'REAKTÖR': 'REACTOR',
  'POMPA #{0}': 'PUMP #{0}', 'DC ŞARJ #{0}': 'DC CHARGER #{0}',

  // --- İnşaat menüsü (shop) ---
  'Arsa Satın Al ({0}/18)': 'Buy Land ({0}/18)', '2 blok 3×3': '2 blocks 3×3',
  'Bitişik arsalardan birini seç — istasyon geliştikçe emlak fiyatları artar':
    'Pick an adjacent plot — prices rise as your station grows',
  'Zemin Betonu': 'Paving', 'arsa başı': 'per plot',
  'Çimen arsana beton döşe (yapı kurmak için şart, güneş paneli hariç)':
    'Pave a grass plot (required to build, except solar)',
  'Betonsuz arsan yok': 'No unpaved plot',
  'Pompa #{0}': 'Pump #{0}', '+1 pompa': '+1 pump', 'Aynı anda bir müşteri daha alırsın': 'Serve one more customer at once',
  'Tabela Sv.{0}': 'Sign Lv.{0}', '+%10 trafik': '+10% traffic', 'Yoldan geçenlerin uğrama şansı artar': 'More passers-by stop by',
  'Yakıt Tankı': 'Fuel Tank', 'Depo büyür, daha seyrek sipariş verirsin': 'Bigger storage, fewer orders needed',
  'Hava-Su Ünitesi': 'Air & Water Unit', 'Hava-Su Ünitesi ({0})': 'Air & Water Unit ({0})',
  'Lastik havası ve su — ucuz ama müşteri çeker (sınırsız kurulur)':
    'Tire air & water — cheap but draws customers (unlimited)',
  'Otopark': 'Parking Lot', 'Otopark ({0})': 'Parking Lot ({0})', '+4 araç': '+4 cars',
  'Çizgili park alanı — müşteriler park edip tesisleri kullanır (sınırsız kurulur)':
    'Striped lot — customers park and use facilities (unlimited)',
  'Market': 'Market', 'Market Sv.2': 'Market Lv.2', 'Müşteriler ekstra alışveriş yapar': 'Customers shop extra',
  'Tuvalet': 'Restroom', 'Tuvalet Sv.2': 'Restroom Lv.2', '+moral': '+morale',
  'Müşteri memnuniyetini ve itibarı artırır': 'Boosts satisfaction and rating',
  'Oto Yıkama': 'Car Wash', 'Yağ Değişimi': 'Oil Change', 'Self Yıkama': 'Self Wash', 'Self Yıkama ({0})': 'Self Wash ({0})',
  'Araçlar kendisi yıkar; gelir kurulum sayısıyla artar (sınırsız)':
    'Self-service wash; income scales with count (unlimited)',
  'Kahveci': 'Cafe', 'Restoran': 'Restaurant', 'Tır Parkı': 'Truck Stop',
  'Yolcular kahve molası verir': 'Travelers take a coffee break',
  'Uzun yol müşterisi yemek molası verir': 'Long-haul customers take a meal break',
  'Tırcılar konaklar — düzenli pasif gelir': 'Truckers stay over — steady passive income',
  'Elektrik Altyapısı Sv.{0}': 'Power Grid Lv.{0}', 'temel': 'basic', '+%30 üretim': '+30% output',
  'Şarj ve enerji yapılarının önünü açar': 'Unlocks charging and energy buildings',
  'Tüm üretimi güçlendirir, yeni yapılar açılır': 'Boosts all output, unlocks new buildings',
  'Batarya Deposu Sv.{0}': 'Battery Depot Lv.{0}',
  'Üretilen elektriği biriktirir, araçlar buradan anında şarj olur':
    'Stores generated power; cars charge from here instantly',
  'Elektrik altyapısı gerekli': 'Power grid required',
  'DC Şarj Ünitesi #{0}': 'DC Charger #{0}', '+1 ünite': '+1 unit',
  'Elektrikli araç müşterileri gelmeye başlar; ünite arttıkça EV trafiği artar':
    'EV customers start arriving; more units bring more EV traffic',
  'Güneş Santrali': 'Solar Plant', 'Dizel Jeneratör': 'Diesel Generator', 'Modüler Reaktör': 'Modular Reactor',
  'Bedava üretim — ama kirlenir, düzenli temizlik ister (sınırsız kurulur)':
    'Free power — but gets dirty, needs regular cleaning (unlimited)',
  'Tanktan mazot yakar — gürültüsü şarjdaki müşterileri kaçırır':
    'Burns diesel from tank — noise scares charging customers away',
  'Dev üretim — bakımsız kalırsa PATLAR, her şey sıfırlanır':
    'Massive output — EXPLODES if neglected, resets everything',
  'MAKS': 'MAX',

  // --- Bina kartları (genel) ---
  'Çalışıyor': 'Running', 'ARIZALI': 'BROKEN', 'Durum': 'Status', 'Seviye': 'Level', 'Üretim': 'Output',
  'Anında': 'Instant', 'Şarj süresi': 'Charge time', 'Satış': 'Price',
  'Araca akış': 'Flow to car', 'Şebeke maliyeti': 'Grid cost', 'Kirlilik': 'Dirt', 'Bugünkü ciro': "Today's revenue",
  'İtibar': 'Rating', 'Müşteri etkisi': 'Customer impact', 'Kullanım ücreti': 'Usage fee',

  // --- Sık toast / bildirim ---
  '{0} tankeri yola çıktı!': '{0} tanker is on the way!',
  '{0} tankı dolduruldu!': '{0} tank refilled!',
  '{0} teslimatı gecikti — yakıt yine de teslim edildi.': '{0} delivery delayed — fuel delivered anyway.',
  '{0} tankeri zaten yolda — teslimatı bekle.': '{0} tanker already on the way — wait for delivery.',
  'Bahşiş: +₺{0}': 'Tip: +₺{0}', 'Taşan yakıt cezası: -₺{0}': 'Spill penalty: -₺{0}',
  '🧼 Camları Temizle': '🧼 Clean Windows', '✨ Camlar Temiz': '✨ Windows Clean',
  'Ön cam pırıl pırıl — bahşiş şansı arttı! ✨': 'Windshield sparkling — bigger tip chance! ✨',
  'Temiz camlara bahşiş: +₺{0}': 'Clean-windows tip: +₺{0}',
  'Tekrar hoş geldin patron! Dönüş hediyesi: +₺1.000 🎁': 'Welcome back, boss! Comeback gift: +₺1,000 🎁',
  'Bakiye güncellendi': 'Balance updated', 'Kayıt güncellendi ✓': 'Save updated ✓', 'Güncelleme uygulanıyor…': 'Applying update…',
  'Hesabın askıya alındı': 'Your account is suspended', 'Kurallar ihlal edildi.': 'Terms of Service violation.', 'Tamam': 'OK',
  'Yerleştir': 'Place', 'Buraya yerleştirilemez — kırmızıysa başka yere taşı.': 'Cannot place here — if red, move elsewhere.',
  '👋 Hoş geldin patron! İlk müşterin geldi — panelde ne istediğine bak ve <b>o renkteki tabancayı</b> seç.': '👋 Welcome, boss! Your first customer is here — check the panel and pick <b>the matching-color nozzle</b>.',
  'Tabanca seçildi ✓ Şimdi <b>tutar gir</b> ya da <b>FULLE</b> bas, sonra <b>BAŞLAT</b>.': 'Nozzle selected ✓ Now <b>enter an amount</b> or hit <b>FILL UP</b>, then <b>START</b>.',
  '🎉 İlk satışın! İpucu: <b>🧼 cam temizle</b> = daha çok bahşiş. Büyümek için <b>🛒 mağazadan</b> pompa/tesis al, <b>🏢 ofisten</b> fiyatı ayarla.': '🎉 Your first sale! Tip: <b>🧼 clean windows</b> = bigger tips. To grow, buy pumps/facilities from the <b>🛒 shop</b> and set prices from the <b>🏢 office</b>.',
  'Sen yokken tesislerin çalıştı: ~₺{0} kazandın — kumbaraları topla!': 'Your facilities worked while you were away: earned ~₺{0} — collect the piggy banks!',
  'Taşıma modu: yön butonları ya da dokun · ⟳ döndür · ✓ yerleştir': 'Move mode: arrow buttons or tap · ⟳ rotate · ✓ place',
  'Yerleştirme modu: yön butonları ya da dokun · ⟳ döndür · ✓ yerleştir': 'Place mode: arrow buttons or tap · ⟳ rotate · ✓ place',
  'Buluta bağlanılamadı': "Couldn't connect to the cloud", 'Yenile': 'Refresh',
  'İlerlemeni korumak için oyun durduruldu. Kaydın güvende — hiçbir şey silinmedi. Bağlantı gelince yenile.': 'The game is paused to protect your progress. Your save is safe — nothing was deleted. Refresh once you are back online.',
  'MÜŞTERİ PATLAMASI! 90 saniye yoğun akın — pompalara koş!': 'CUSTOMER RUSH! 90 seconds of heavy traffic — hit the pumps!',
  '🅿️ Müşteri aracını otoparka çekti, tesisleri kullanacak.': '🅿️ Customer parked to use the facilities.',
  'Tuvalet artık ücretsiz.': 'Restroom is now free.', 'Tuvalet ücreti: ₺{0}': 'Restroom fee: ₺{0}',
  'Ücretsiz': 'Free', 'GÜNLÜK GÖREV TAMAM: 15 müşteri — ödül +₺1.000!': 'DAILY QUEST DONE: 15 customers — reward +₺1,000!',
  'İstasyon bakıma alındı — itibar düşmez.': 'Station under maintenance — rating protected.',
}

export function t(tr: string, ...args: (string | number)[]): string {
  let s = lang === 'tr' ? tr : (EN[tr] ?? tr)
  args.forEach((a, idx) => { s = s.replace(`{${idx}}`, String(a)) })
  return s
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
