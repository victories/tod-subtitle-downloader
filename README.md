# TOD TV - Altyazı İndirici

TOD TV (todtv.com.tr) için geliştirilmiş Tampermonkey/Greasemonkey userscript'i. Tek bölüm veya tüm sezonu toplu olarak ZIP halinde indirir.

## Özellikler

### Altyazı İndirme
- **Tek bölüm indirme** — Video oynatıldığında altyazılar otomatik yakalanır, SRT veya VTT formatında indirilir
- **Mevcut bölüm ZIP** — Bir bölümün tüm dillerdeki altyazılarını tek ZIP dosyasında indir
- **Sezon toplu indirme** — Tüm sezonun altyazılarını dil filtresiyle (Türkçe / İngilizce / Tümü) toplu indir
- **Çoklu dil desteği** — Türkçe, İngilizce, Arapça, Almanca, Fransızca ve daha fazlası

### Akıllı İndirme Motoru
- **İptal desteği** — Toplu indirmeyi istediğiniz zaman iptal edin
- **Devam ettirme (Resume)** — İptal edilen indirme bir sonraki sefere kaldığı yerden devam eder
- **Duplicate atlama** — Daha önce indirilmiş bölümler otomatik atlanır
- **İndirme geçmişi** — Hangi bölümlerin indirildiği takip edilir
- **ETA gösterimi** — Toplu indirmede kalan süre tahmini

### Hata Yönetimi & Güvenilirlik
- **Timeout koruması** — Tüm ağ isteklerinde zaman aşımı (30s/45s)
- **Yeniden deneme** — Başarısız API çağrıları exponential backoff ile tekrar denenir
- **İptal sinyali** — Batch indirme iptal edildiğinde tüm bekleyen istekler durdurulur
- **Race condition koruması** — SPA navigasyonu sırasında aktif indirmeler korunur

### Kullanıcı Arayüzü
- **Toast bildirimleri** — İndirme durumu hakkında anlık bildirimler
- **İlerleme çubuğu** — Yüzde ve ETA ile detaylı ilerleme takibi
- **Ayarlar paneli** — Dil, format, tema ve daha fazlası için yapılandırma
- **Responsive tasarım** — Masaüstü ve mobil uyumlu arayüz
- **Tema desteği** — Koyu, açık ve otomatik tema seçenekleri
- **Klavye kısayolu** — `Alt+S` ile menüyü aç/kapa
- **Akıllı buton durumu** — İşlem sırasında butonlar otomatik devre dışı + yükleme animasyonu

### Ayarlar & Tercihler
- **Varsayılan dil** — Her seferinde dil seçmek yerine tercih edilen dili kaydet
- **Varsayılan format** — SRT veya VTT arasında tercih
- **Otomatik indirme** — Video oynatıldığında tercih edilen dilde otomatik indir
- **İstek arası bekleme** — Rate limiting süresini ayarla (100ms - 5000ms)
- **Tema tercihi** — Koyu / Açık / Otomatik
- **Dışa/İçe aktarma** — Ayarları JSON olarak yedekle ve geri yükle

## Kurulum

### Gereksinimler
- [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Edge, Safari)
- veya [Greasemonkey](https://www.greasespot.net/) (Firefox)
- veya [Violentmonkey](https://violentmonkey.github.io/) (Chrome, Firefox, Edge)

### Adımlar

1. Tarayıcınıza Tampermonkey (veya benzeri) eklentisini kurun
2. Aşağıdaki bağlantıya tıklayarak scripti yükleyin:

   **[Scripti Yükle](https://raw.githubusercontent.com/victories/tod-subtitle-downloader/main/tod-subtitle-downloader.js)**

3. Tampermonkey onay sayfasında **"Yükle"** butonuna tıklayın
4. [todtv.com.tr](https://www.todtv.com.tr) adresine gidin — sağ üstte **"🔤 Altyazı İndir"** butonu görünecektir

## Kullanım

### Tek Bölüm İndirme

1. TOD TV'de bir dizinin bölüm sayfasına gidin
2. Videoyu oynatın — altyazılar otomatik olarak yakalanır
3. Sağ üstteki **"🔤 Altyazı İndir"** butonuna tıklayın
4. Açılan menüde istediğiniz dili ve formatı seçin
5. Birden fazla dil varsa **"📦 Bu Bölümü ZIP"** ile hepsini tek dosyada indirin

### Sezon Toplu İndirme

1. Dizinin sezon sayfasına gidin
2. Menüyü açın ve **"🔄 Bölümleri Yükle"** butonuna tıklayın
3. Bölümler yüklendiğinde dil seçeneğini belirleyin:
   - **Türkçe** — Sadece Türkçe altyazılar
   - **English** — Sadece İngilizce altyazılar
   - **Tüm Diller** — Mevcut tüm diller
4. İndirme başladığında ilerleme çubuğu ve ETA gösterilir
5. İndirme tamamlandığında ZIP dosyası otomatik indirilir

### İptal ve Devam Ettirme

- Toplu indirme sırasında **"⛔ İndirmeyi İptal Et"** butonuna tıklayın
- İptal noktası kaydedilir — bir sonraki seferde kaldığı yerden devam eder
- Devam bilgisi menüde **(devam: X. bölüm)** olarak gösterilir

### Ayarlar

1. Menüdeki **⚙** (dişli) ikonuna tıklayın
2. Tercihlerinizi ayarlayın:
   - **Varsayılan Dil** — Otomatik indirme için dil seçimi
   - **Varsayılan Format** — SRT veya VTT
   - **İstek Arası Bekleme** — Sunucuya yük bindirmemek için bekleme süresi
   - **Tema** — Koyu / Açık / Otomatik
   - **Oynatınca Otomatik İndir** — Video başladığında altyazıyı otomatik indir
3. **Ayarları Dışa Aktar** ile yedek alın, **Ayarları İçe Aktar** ile geri yükleyin

### Klavye Kısayolları

| Kısayol | İşlev |
|---------|-------|
| `Alt+S` | Menüyü aç/kapa |

## Dosya Adlandırma

İndirilen dosyalar şu formatta adlandırılır:

```
DiziAdi.S01E01.Turkce.srt
DiziAdi.S01E01.English.srt
```

Toplu indirme ZIP dosyaları:

```
DiziAdi.1.Sezon.Turkce.srt.zip
DiziAdi.1.Sezon.All.Languages.srt.zip
```

## Teknik Detaylar

### Nasıl Çalışır?

1. **Ağ Yakalama** — Script, sayfadaki `fetch()` ve `XMLHttpRequest` çağrılarını izleyerek MPEG-DASH manifest (`.mpd`) dosyalarını yakalar
2. **MPD Parsing** — Manifest dosyasından altyazı track'lerini (dil, URL) çıkarır
3. **PlayRequest API** — TOD TV'nin dahili API'sine istek göndererek CDN URL'lerini alır
4. **Format Dönüşümü** — WebVTT formatından SRT formatına dönüşüm yapar (BOM ile UTF-8)
5. **ZIP Paketleme** — JSZip kütüphanesi ile birden fazla altyazıyı tek dosyada paketler

### Kullanılan Teknolojiler

- **JSZip** — ZIP dosyası oluşturma
- **FileSaver.js** — Dosya indirme
- **MPEG-DASH** — Video manifest parsing
- **GM_xmlhttpRequest** — CORS bypass ile cross-origin istekler

### Veri Depolama

Script, `localStorage` kullanarak şu verileri saklar:

| Anahtar | Açıklama | TTL |
|---------|----------|-----|
| `tod_sd_settings` | Kullanıcı ayarları | Kalıcı |
| `tod_sd_history` | İndirme geçmişi (max 500 kayıt) | Kalıcı |
| `tod_sd_cache_*` | Sezon/bölüm verileri | 24 saat |
| `tod_sd_batchResume_*` | Toplu indirme devam noktası | Kalıcı |

## Sorun Giderme

### Altyazılar yakalanmıyor
- Videoyu oynatmayı deneyin — altyazılar video başladığında yakalanır
- Sayfayı yenileyin ve tekrar deneyin
- Tampermonkey'de scriptin aktif olduğundan emin olun

### Sezon verisi bulunamıyor
- Dizinin ana sayfasında (bölüm listesi olan sayfa) olduğunuzdan emin olun
- **"🔄 Bölümleri Yükle"** butonuna tıklayın
- Bir bölüm sayfasına gidin ve oradan deneyin

### Toplu indirme başarısız
- TOD TV hesabınıza giriş yaptığınızdan emin olun
- İnternet bağlantınızı kontrol edin
- Ayarlardan istek arası bekleme süresini artırın (ör: 1000ms)
- Timeout hatası alıyorsanız tekrar deneyin

### Ayarlar kayboldu
- Tarayıcı localStorage'ı temizlenmişse ayarlar sıfırlanır
- **Ayarları Dışa Aktar** ile düzenli yedek alın

## Sürüm Geçmişi

### v3.0.0
- Merkezi state yönetimi (AppState + EventBus)
- Ayarlar paneli (dil, format, tema, rate limit, auto-download)
- localStorage ile önbellekleme (24 saat TTL)
- İndirme geçmişi ve duplicate atlama
- Toplu indirme iptal ve devam ettirme (resume)
- Toast bildirim sistemi
- İlerleme çubuğu + ETA gösterimi
- fetchWithTimeout / gmFetchWithTimeout (timeout koruması)
- Exponential backoff ile yeniden deneme
- Network interceptor memory leak düzeltmesi
- MutationObserver race condition düzeltmesi
- Responsive tasarım (mobil uyumlu)
- Koyu/Açık/Otomatik tema desteği
- Alt+S klavye kısayolu
- İşlem sırasında buton disable + loading spinner
- Ayar dışa/içe aktarma (JSON)
- Geliştirilmiş dosya adı sanitizasyonu (path traversal koruması)

### v2.5.0
- Sezon toplu indirme
- VTT → SRT dönüşümü
- Çoklu dil desteği
- ZIP paketleme
- SPA navigasyon desteği

## Lisans

MIT License - Detaylar için [LICENSE](LICENSE) dosyasına bakın.

## Katkıda Bulunma

1. Bu repoyu fork edin
2. Feature branch oluşturun (`git checkout -b feature/yeni-ozellik`)
3. Değişikliklerinizi commit edin (`git commit -m 'Yeni özellik ekle'`)
4. Branch'inizi push edin (`git push origin feature/yeni-ozellik`)
5. Pull Request açın
