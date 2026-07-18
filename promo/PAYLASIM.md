# Benzinlik — Sosyal Medya Kiti

Oyun: **https://petrol.benerits.com**

## Ana reklamlar (progression tarzı — oyun kendi reklamını oynuyor)

| Dosya | Format | Süre | Platform |
|---|---|---|---|
| `reklam-yatay.mp4` | 1920×1080 · 30fps | 40 sn | Twitter/X, YouTube |
| `reklam-dikey.mp4` | 1080×1920 · 30fps | 39 sn | TikTok, Instagram Reels |

Akış: tek pompalı boş arsa → "KENDİ BENZİNLİĞİNİ KUR" → canlı dolum sayaçlarıyla satış →
"BÜYÜ VE GELİŞ" (pompalar+tabela) → "MARKETİNİ AÇ" → "ELEKTRİĞE GEÇ" (şarj+batarya) →
"GÜNEŞ PANELLERİNİ KUR" → "NÜKLEER ÇAĞA ADIM AT" (soğutma kulesi) → "KENDİ PETROL İSTASYONUNU İŞLET" → "ŞİMDİ OYNA".
Her beat'te beyaz flaş geçişi, koyu kutulu okunur yazılar, 132 BPM tempolu müzik.
Kamera yakın plandan geniş plana süzülür; kasa canlı artar. Tümü gerçek oyun motoru.

## B-roll (`klipler/`, 25fps, sessiz)
- `hq-h-tur` / `hq-v-tur` — istasyon turu: pompalar, tanklar, şarj, reaktör (~110 sn)
- `hq-h-gece` / `hq-v-gece` — gece ışıkları kapanış planları (~20 sn)

## Hazır metinler
**Twitter/X:** Tek pompayla başladık. Marketi açtık, elektriğe geçtik, güneş panellerini kurduk…
sonra nükleer çağa adım attık. ⛽⚡☢️ Hepsi tarayıcıda: petrol.benerits.com

**TikTok/Reels:** Tek pompadan nükleer imparatorluğa 🚀 #tycoon #oyun #benzinlik #simulasyon

## Teknik notlar
- Reklam çekimi: oyundaki `?promo=1` yönetmen modu (kendini oynayan reklam) — tekrar çekim: `tools` yok, Playwright + bu parametre yeter.
- `?night=1` gece vitrini, `?full=1` her şey kurulu vitrin.
- Müzik sentetik (telif yok). Görüntüler %100 oyun içi.
