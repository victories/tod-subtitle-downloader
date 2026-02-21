// ==UserScript==
// @name        TOD TV - Subtitle Downloader
// @description TOD TV (todtv.com.tr) altyazı indirici. Tek bölüm veya tüm sezonu ZIP olarak indirir.
// @license     MIT
// @version     2.5.0
// @namespace   victories.tod.subtitle
// @match       https://*.todtv.com.tr/*
// @match       https://todtv.com.tr/*
// @grant       unsafeWindow
// @grant       GM_xmlhttpRequest
// @connect     todtv.com.tr
// @connect     akamaized.net
// @connect     *
// @require     https://cdn.jsdelivr.net/gh/Stuk/jszip@579beb1d45c8d586d8be4411d5b2e48dea018c06/dist/jszip.min.js?version=3.1.5
// @require     https://cdn.jsdelivr.net/gh/eligrey/FileSaver.js@283f438c31776b622670be002caf1986c40ce90c/dist/FileSaver.min.js?version=2018-12-29
// ==/UserScript==

(function() {
  'use strict';

  const MENU_ID = 'tod-subtitle-downloader-menu';
  const VERSION = '2.5.0';

  // State
  let currentTracks = [];        // Mevcut bölümün altyazı track'leri
  let currentTitle = '';
  let seasonsData = null;        // var seasons JSON
  let seriesName = '';
  let seriesNameClean = '';       // Orijinal dizi adı (Başlık formatlı)
  let currentEpLabel = '';        // Mevcut bölüm etiketi: S01E01
  let isProcessing = false;

  // ==================== CSS ====================
  const MENU_CSS = `
    #${MENU_ID} {
      position: fixed; top: 10px; right: 10px; z-index: 999999999;
      font-family: Arial, sans-serif; font-size: 13px;
    }
    #${MENU_ID} * { box-sizing: border-box; }
    #${MENU_ID} .sd-btn {
      background: #e50914; color: #fff; border: none; padding: 8px 14px;
      border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: bold;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    #${MENU_ID} .sd-btn:hover { background: #b0060f; }
    #${MENU_ID} .sd-badge {
      background: #fff; color: #e50914; border-radius: 50%;
      padding: 1px 6px; margin-left: 6px; font-size: 11px;
    }
    #${MENU_ID} .sd-dropdown {
      display: none; background: #1a1a1a; border: 1px solid #333;
      border-radius: 8px; margin-top: 6px; box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      min-width: 320px; max-height: 600px; overflow-y: auto;
    }
    #${MENU_ID} .sd-dropdown.open { display: block; }
    #${MENU_ID} .sd-section {
      padding: 8px 14px; background: #222; color: #aaa; font-size: 11px;
      text-transform: uppercase; letter-spacing: 1px;
      border-bottom: 1px solid #333; border-top: 1px solid #333;
    }
    #${MENU_ID} .sd-section:first-child { border-top: none; }
    #${MENU_ID} .sd-item {
      padding: 9px 14px; color: #fff; cursor: pointer;
      display: flex; justify-content: space-between; align-items: center;
    }
    #${MENU_ID} .sd-item:hover { background: #333; }
    #${MENU_ID} .sd-lang { font-weight: bold; }
    #${MENU_ID} .sd-format {
      color: #888; font-size: 11px; background: #2a2a2a;
      padding: 2px 6px; border-radius: 3px;
    }
    #${MENU_ID} .sd-action {
      padding: 10px 14px; cursor: pointer; font-weight: bold;
      text-align: center; border-top: 1px solid #333;
    }
    #${MENU_ID} .sd-action:hover { background: #333; }
    #${MENU_ID} .sd-action.green { color: #4CAF50; }
    #${MENU_ID} .sd-action.orange { color: #FF9800; }
    #${MENU_ID} .sd-action.red { color: #e50914; }
    #${MENU_ID} .sd-action.disabled {
      color: #555; cursor: not-allowed; pointer-events: none;
    }
    #${MENU_ID} .sd-status {
      padding: 10px 14px; color: #666; text-align: center; font-style: italic;
    }
    #${MENU_ID} .sd-info {
      padding: 6px 14px; color: #888; font-size: 11px; text-align: center; background: #111;
    }
    #${MENU_ID} .sd-progress {
      height: 4px; background: #333; overflow: hidden; display: none;
    }
    #${MENU_ID} .sd-progress-bar {
      height: 100%; background: #e50914; width: 0%; transition: width 0.3s;
    }
    #${MENU_ID} .sd-log {
      padding: 6px 14px; color: #555; font-size: 10px; font-family: monospace;
      max-height: 100px; overflow-y: auto; background: #111;
      border-top: 1px solid #222; display: none;
    }
  `;

  // ==================== Helpers ====================

  const LANG_NAMES = {
    'tr': 'Türkçe', 'en': 'English', 'ar': 'العربية', 'de': 'Deutsch',
    'fr': 'Français', 'es': 'Español', 'it': 'Italiano', 'pt': 'Português',
    'ru': 'Русский', 'ja': '日本語', 'ko': '한국어', 'zh': '中文',
    'nl': 'Nederlands', 'pl': 'Polski', 'sv': 'Svenska', 'da': 'Dansk',
    'no': 'Norsk', 'fi': 'Suomi', 'el': 'Ελληνικά', 'he': 'עברית',
    'hi': 'हिन्दी', 'th': 'ไทย', 'ro': 'Română', 'hu': 'Magyar',
    'cs': 'Čeština', 'bg': 'Български', 'hr': 'Hrvatski', 'sr': 'Srpski',
    'uk': 'Українська', 'fa': 'فارسی', 'tur': 'Türkçe', 'eng': 'English',
  };

  const getLangName = (code) => LANG_NAMES[code] || code.toUpperCase();

  const sanitize = (name) => name
    .replace(/[:*?"<>|\\\/]+/g, '_')
    .replace(/\s+/g, '.')
    .replace(/\.{2,}/g, '.')
    .substring(0, 120);

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ==================== VTT → SRT ====================

  function vttToSrt(vttText) {
    const lines = vttText.trim().split('\n');
    const srt = [];
    let counter = 0, i = 0;

    while (i < lines.length && !lines[i].includes('-->')) i++;

    while (i < lines.length) {
      const line = lines[i].trim();
      if (line.includes('-->')) {
        counter++;
        srt.push(counter.toString());
        let timeLine = line
          .replace(/\./g, ',')
          .replace(/(\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2},\d{3})/, '00:$1 --> 00:$2')
          .replace(/\s+(position|align|size|line|vertical):[^\s]+/g, '');
        srt.push(timeLine);
        i++;
        const text = [];
        while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) {
          let cl = lines[i].trim()
            .replace(/<\/?c[^>]*>/g, '')
            .replace(/<\/?[0-9]+:[0-9]+:[0-9]+\.[0-9]+>/g, '')
            .replace(/<\/?v[^>]*>/g, '');
          if (cl) text.push(cl);
          i++;
        }
        if (text.length > 0) {
          srt.push(text.join('\n'));
          srt.push('');
        } else {
          srt.pop(); srt.pop(); counter--;
        }
      } else {
        i++;
      }
    }
    return srt.join('\n').trim();
  }

  // ==================== MPD Parse ====================

  function parseMPD(xmlText, mpdURL) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'text/xml');
      const baseURL = mpdURL.split('?')[0].replace(/[^/]*$/, '');
      const tracks = [];

      doc.querySelectorAll('AdaptationSet').forEach(as => {
        const ct = as.getAttribute('contentType');
        const mt = as.getAttribute('mimeType');
        if (ct === 'text' || (mt && (mt.includes('vtt') || mt.includes('ttml')))) {
          const lang = as.getAttribute('lang') || 'unknown';
          as.querySelectorAll('Representation').forEach(rep => {
            const bu = rep.querySelector('BaseURL');
            if (bu) {
              const file = bu.textContent.trim();
              const url = file.startsWith('http') ? file : baseURL + file;
              tracks.push({ lang, filename: file, url });
            }
          });
        }
      });
      return tracks;
    } catch (e) {
      log(`MPD parse hatası: ${e.message}`);
      return [];
    }
  }

  // ==================== AntiForgeryToken ====================

  function getAntiForgeryToken() {
    const el = document.querySelector('input[name="__RequestVerificationToken"]');
    return el ? el.value : '';
  }

  // ==================== Seasons Data ====================

  function extractSeasonsData() {
    // Yöntem 1: var seasons JSON'u (bein-series sayfaları)
    try {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent;
        const match = text.match(/var\s+seasons\s*=\s*(\[[\s\S]*?\]);/);
        if (match) {
          seasonsData = JSON.parse(match[1]);
          log(`Sezon verisi bulundu (JS): ${seasonsData.length} sezon`);
          return true;
        }
      }
    } catch (e) {
      log(`JS sezon verisi hatası: ${e.message}`);
    }

    // Yöntem 2: Sayfa içindeki bölüm listesini HTML'den çek
    try {
      const result = extractSeasonsFromHTML();
      if (result && result.length > 0) {
        seasonsData = result;
        log(`Sezon verisi bulundu (HTML): ${seasonsData.length} sezon`);
        return true;
      }
    } catch (e) {
      log(`HTML sezon verisi hatası: ${e.message}`);
    }

    // Yöntem 3: Sayfada sezon tab'ları + AJAX ile bölüm verisi çekme
    try {
      const result = extractSeasonsFromTabs();
      if (result && result.length > 0) {
        seasonsData = result;
        log(`Sezon verisi bulundu (Tabs): ${seasonsData.length} sezon`);
        return true;
      }
    } catch (e) {
      log(`Tab sezon verisi hatası: ${e.message}`);
    }

    log('Sezon verisi bulunamadı');
    return false;
  }

  function extractSeasonsFromHTML() {
    const seasons = [];

    // Sezon container'larını bul (yaygın TOD yapıları)
    // Yöntem A: .season-episodes veya benzeri container'lar
    const seasonContainers = document.querySelectorAll(
      '[class*="season"], [data-season], .episodeList, .episode-list, ' +
      '.content-episodes, .episodes-container, [class*="episode-group"]'
    );

    // Yöntem B: Bölüm linkleri doğrudan
    const episodeLinks = document.querySelectorAll(
      'a[href*="sezon"][href*="/"], a[data-content-type="Episode"], ' +
      'a.episode-item, a[class*="episode"], [data-cms-id][href]'
    );

    if (episodeLinks.length > 0) {
      // Linkleri sezonlara grupla
      const seasonMap = {};

      episodeLinks.forEach((link, idx) => {
        const href = link.getAttribute('href') || '';
        const seasonMatch = href.match(/(\d+)\s*sezon/i) || href.match(/season-?(\d+)/i);
        const seasonNum = seasonMatch ? parseInt(seasonMatch[1]) : 1;

        if (!seasonMap[seasonNum]) {
          seasonMap[seasonNum] = {
            no: seasonNum,
            title: `${seasonNum}. Sezon`,
            episodes: []
          };
        }

        // Bölüm bilgisini çıkar
        const title = link.getAttribute('title') || link.textContent?.trim() || '';
        const cmsId = link.getAttribute('data-cms-id') || '';
        const slug = href.startsWith('/') ? href : `/${href}`;

        // Aynı slug tekrar ekleme
        if (!seasonMap[seasonNum].episodes.find(e => e.customData?.slug === slug)) {
          seasonMap[seasonNum].episodes.push({
            no: seasonMap[seasonNum].episodes.length + 1,
            title: title.substring(0, 100),
            customData: { slug }
          });
        }
      });

      const result = Object.values(seasonMap).sort((a, b) => a.no - b.no);
      if (result.some(s => s.episodes.length > 0)) return result;
    }

    return null;
  }

  function extractSeasonsFromTabs() {
    // Sezon tab'larını ve ilgili bölüm listelerini bul
    const tabs = document.querySelectorAll(
      '[data-season-no], .season-tab, [class*="season-tab"], ' +
      'a[href*="#season"], button[data-season]'
    );

    if (tabs.length === 0) return null;

    // Şimdilik sadece tab varlığını logla — gerçek veri AJAX ile gelecek
    log(`${tabs.length} sezon tab'ı bulundu`);
    return null;
  }

  function extractSeriesName() {
    // 1) contentOrgName'den (en güvenilir)
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      const m = s.textContent.match(/contentOrgName\s*[:=]\s*['"](.*?)['"]/);
      if (m) {
        seriesNameClean = m[1].trim();
        seriesName = sanitize(seriesNameClean);
        break;
      }
    }

    // 2) URL'den fallback
    if (!seriesName) {
      const path = window.location.pathname;
      const match = path.match(/\/([^/]+)\/[^/]*sezon/i);
      if (match) {
        seriesNameClean = match[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        seriesName = sanitize(seriesNameClean);
      }
    }

    // 3) Son fallback
    if (!seriesName) {
      seriesNameClean = document.title.split(' - ')[0]?.trim() || 'TOD';
      seriesName = sanitize(seriesNameClean);
    }
  }

  function detectCurrentEpLabel() {
    // var seasons ve URL'den mevcut bölümün S01E01 etiketini bul
    currentEpLabel = '';
    const path = window.location.pathname;

    if (seasonsData) {
      for (const season of seasonsData) {
        if (!Array.isArray(season.episodes)) continue;
        for (const ep of season.episodes) {
          if (ep.customData?.slug && path.includes(ep.customData.slug.replace(/^\//, ''))) {
            const sNum = String(season.no).padStart(2, '0');
            const eNum = String(ep.no).padStart(2, '0');
            currentEpLabel = `S${sNum}E${eNum}`;
            return;
          }
        }
      }
    }

    // URL'den sezon/bölüm tahmin et
    const sMatch = path.match(/(\d+)sezon/i);
    // Sayfa içi bilgiden bölüm numarası
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      const m = s.textContent.match(/movieInfo\s*=\s*\{/);
      if (m) {
        const infoMatch = s.textContent.match(/'(\d+)\.?\s*B[öo]l[üu]m/i);
        if (infoMatch && sMatch) {
          currentEpLabel = `S${String(sMatch[1]).padStart(2,'0')}E${String(infoMatch[1]).padStart(2,'0')}`;
          return;
        }
      }
    }

    // data-info attribute'undan: 1.S:B1 formatı
    const epItem = document.querySelector('.season-episode-item.active, .season-episode-item[aria-current]');
    if (epItem) {
      const info = epItem.getAttribute('data-info') || '';
      const m = info.match(/(\d+)\.S:B(\d+)/);
      if (m) {
        currentEpLabel = `S${String(m[1]).padStart(2,'0')}E${String(m[2]).padStart(2,'0')}`;
        return;
      }
    }

    // Son fallback: URL slug'ından sezon numarası + title'dan bölüm no
    if (sMatch) {
      currentEpLabel = `S${String(sMatch[1]).padStart(2,'0')}`;
    }
  }

  // ==================== Fetch Episode Asset Info ====================

  async function fetchEpisodeAsset(episodeSlug) {
    try {
      const url = episodeSlug.startsWith('http') ? episodeSlug : `https://www.todtv.com.tr${episodeSlug}`;
      const resp = await fetch(url, { credentials: 'include' });
      const html = await resp.text();

      let result = null;

      // data-asset-list'i çıkar
      const match = html.match(/data-asset-list="([^"]+)"/);
      if (match) {
        const decoded = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        const assets = JSON.parse(decoded);
        if (assets.length > 0) {
          result = assets[0];
          log(`  asset-list: AssetId=${result.AssetId}, IsDrm=${result.IsDrm}, UsageSpec=${result.UsageSpecId}`);
        }
      }

      // Alternatif: buton attribute'larından
      if (!result) {
        const idMatch = html.match(/data-play-asset-id="([^"]+)"/);
        const usageMatch = html.match(/data-usage-spec="([^"]+)"/);
        const cmsMatch = html.match(/data-cms-id="(PT\d+)"/);
        if (idMatch) {
          result = {
            AssetId: idMatch[1],
            UsageSpecId: usageMatch ? parseInt(usageMatch[1]) : 0,
            CmsContentId: cmsMatch ? cmsMatch[1] : '',
            IsDrm: false,
            AssetType: 'MUL'
          };
          log(`  buton attr: AssetId=${result.AssetId}`);
        }
      }

      if (!result) return null;

      // KRİTİK: data-version-id'yi ayrıca çıkar (asset-list içinde null olabilir!)
      const versionMatch = html.match(/data-version-id="(PV[^"]+)"/);
      if (versionMatch) {
        result.VersionId = versionMatch[1];
      }

      // data-entitlement kontrolü
      const entMatch = html.match(/data-entitlement="(\d+)"/);
      log(`  entitlement=${entMatch ? entMatch[1] : 'bulunamadı'}, versionId=${result.VersionId || 'YOK'}`);

      // KRİTİK: Hedef sayfanın AntiForgeryToken'ını al
      const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
      if (tokenMatch) {
        result._pageToken = tokenMatch[1];
      } else {
        const tokenMatch2 = html.match(/value="([^"]+)"[^>]*name="__RequestVerificationToken"/);
        if (tokenMatch2) result._pageToken = tokenMatch2[1];
      }
      log(`  pageToken: ${result._pageToken ? 'BULUNDU' : 'BULUNAMADI!'}`);

      // Referer URL'yi kaydet
      result._refererUrl = url;

      // data-cms-id kontrol
      if (!result.CmsContentId) {
        const cmsMatch = html.match(/data-cms-id="(PT\d+)"/);
        if (cmsMatch) result.CmsContentId = cmsMatch[1];
      }

      return result;
    } catch (e) {
      log(`Bölüm fetch hatası (${episodeSlug}): ${e.message}`);
      return null;
    }
  }

  // ==================== PlayRequest API ====================

  async function playRequestAPI(asset) {
    try {
      // Hedef sayfanın token'ını öncelikli kullan, yoksa mevcut sayfanınki
      const token = asset._pageToken || getAntiForgeryToken();

      log(`  playRequest: contentId=${asset.CmsContentId}, versionId=${asset.VersionId || 'YOK'}, assetId=${asset.AssetId}`);
      log(`  Token: ${token ? token.substring(0,20)+'...' : 'YOK!'}, UsageSpec: ${asset.UsageSpecId}, Referer: ${asset._refererUrl || 'yok'}`);

      const body = new URLSearchParams();
      body.append('__RequestVerificationToken', token);
      body.append('contentId', asset.CmsContentId || '');
      body.append('versionId', asset.VersionId || '');
      body.append('assetId', asset.AssetId || '');
      body.append('usageSpecId', String(asset.UsageSpecId || ''));
      body.append('contentType', 'Episode');
      body.append('assetType', asset.AssetType || 'MUL');
      body.append('videoType', '1');
      body.append('updateWatchingOptions', 'false');
      body.append('restart', 'false');

      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest'
      };
      // Referer ekle — bazı API'ler bunu kontrol ediyor
      if (asset._refererUrl) {
        headers['Referer'] = asset._refererUrl;
      }

      const resp = await fetch('/content/playRequest', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: body.toString()
      });

      const json = await resp.json();
      log(`  playRequest yanıt: Action=${json.Action}, CdnUrl=${json.CdnUrl ? 'VAR' : 'YOK'}, Message=${json.Message || '-'}`);

      // Hata durumunda tüm yanıtı logla
      if (!json.CdnUrl) {
        log(`  playRequest FULL response: ${JSON.stringify(json).substring(0, 300)}`);
      }
      return json;
    } catch (e) {
      log(`playRequest hatası: ${e.message}`);
      return null;
    }
  }

  // ==================== GM_xmlhttpRequest wrapper (Promise) ====================

  function gmFetch(url, opts = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: opts.method || 'GET',
        url: url,
        headers: opts.headers || {},
        responseType: opts.responseType || 'text',
        onload: (resp) => resolve({
          ok: resp.status >= 200 && resp.status < 400,
          status: resp.status,
          url: resp.finalUrl || url,
          text: () => Promise.resolve(resp.responseText),
          responseText: resp.responseText
        }),
        onerror: (e) => reject(new Error(`GM request failed: ${e.statusText || 'network error'}`)),
        ontimeout: () => reject(new Error('GM request timeout'))
      });
    });
  }

  // ==================== Get Subtitles for Episode ====================

  async function getSubtitlesForEpisode(asset) {
    // 1. playRequest ile CDN URL al
    const playResp = await playRequestAPI(asset);

    if (!playResp || !playResp.CdnUrl) {
      log(`CDN URL alınamadı (Action: ${playResp?.Action}, Message: ${playResp?.Message})`);
      return [];
    }

    let cdnUrl = playResp.CdnUrl;
    log(`  CDN URL: ${cdnUrl.substring(0, 100)}...`);

    // 2. Switch/redirect URL ise GM_xmlhttpRequest ile takip et (CORS bypass)
    if (!cdnUrl.includes('.mpd')) {
      try {
        log(`  Switch URL tespit edildi, GM_xmlhttpRequest ile takip ediliyor...`);
        const switchResp = await gmFetch(cdnUrl);
        const finalUrl = switchResp.url;

        if (finalUrl && finalUrl.includes('.mpd')) {
          cdnUrl = finalUrl;
          log(`  Redirect MPD URL: ${cdnUrl.substring(0, 100)}...`);
        } else {
          // Yanıt body'si içinde MPD URL olabilir
          const body = switchResp.responseText || '';
          const mpdMatch = body.match(/(https?:\/\/[^\s"'<>]+\.mpd[^\s"'<>]*)/i);
          if (mpdMatch) {
            cdnUrl = mpdMatch[1];
            log(`  Body'den MPD URL: ${cdnUrl.substring(0, 100)}...`);
          } else {
            log(`  ⚠ MPD URL bulunamadı. Final URL: ${finalUrl?.substring(0, 100)}`);
            log(`  Status: ${switchResp.status}, Body (ilk 300): ${body.substring(0, 300)}`);
            return [];
          }
        }
      } catch (e) {
        log(`  Switch URL takip hatası: ${e.message}`);
        return [];
      }
    }

    // 3. MPD'yi indir ve parse et
    try {
      // MPD'yi de GM_xmlhttpRequest ile al (farklı domain olabilir)
      const mpdResp = await gmFetch(cdnUrl);
      const mpdText = mpdResp.responseText;

      if (!mpdText.includes('<MPD') && !mpdText.includes('<mpd')) {
        log(`  ⚠ MPD içeriği bekleniyordu ama farklı içerik geldi (ilk 200): ${mpdText.substring(0, 200)}`);
        return [];
      }

      return parseMPD(mpdText, cdnUrl);
    } catch (e) {
      log(`  MPD indirme hatası: ${e.message}`);
      return [];
    }
  }

  // ==================== Load Season Episodes (lazy) ====================

  async function loadSeasonEpisodes(seasonIdx) {
    if (!seasonsData || !seasonsData[seasonIdx]) return false;
    const season = seasonsData[seasonIdx];

    try {
      // Sezon slug'ını bul
      let seasonSlug = season.customData?.slug || season.slug || '';

      // Slug yoksa URL pattern'den tahmin et
      if (!seasonSlug) {
        // Mevcut sayfanın URL'sinden dizi slug'ını al
        const pathMatch = location.pathname.match(/^(\/[^/]+\/[^/]+)\//);
        const basePath = pathMatch ? pathMatch[1] : location.pathname.replace(/\/$/, '');
        seasonSlug = `${basePath}/${season.no}sezon-v${season.id || ''}`;

        // Alternatif: sayfadaki sezon linklerini ara
        const seasonLink = document.querySelector(
          `a[href*="${season.no}sezon"], a[href*="season${season.no}"], ` +
          `a[href*="${season.no}-sezon"], [data-season-no="${season.no}"] a`
        );
        if (seasonLink) {
          seasonSlug = seasonLink.getAttribute('href') || seasonSlug;
        }
      }

      if (!seasonSlug) {
        log(`  Sezon slug bulunamadı`);
        return false;
      }

      log(`  Sezon sayfası yükleniyor: ${seasonSlug}`);
      const url = seasonSlug.startsWith('http') ? seasonSlug : `https://www.todtv.com.tr${seasonSlug}`;
      const resp = await fetch(url, { credentials: 'include' });
      const html = await resp.text();

      // HTML'den bölüm listesini çek
      const episodes = [];

      // Yöntem 1: var seasons JSON
      const seasonsMatch = html.match(/var\s+seasons\s*=\s*(\[[\s\S]*?\]);/);
      if (seasonsMatch) {
        try {
          const allSeasons = JSON.parse(seasonsMatch[1]);
          const targetSeason = allSeasons.find(s => s.no === season.no) || allSeasons[0];
          if (targetSeason && Array.isArray(targetSeason.episodes)) {
            seasonsData[seasonIdx] = targetSeason;
            log(`  ${targetSeason.episodes.length} bölüm yüklendi (JS)`);
            return true;
          }
        } catch(e) {}
      }

      // Yöntem 2: Bölüm linklerini HTML'den çek
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const epLinks = doc.querySelectorAll(
        'a[data-content-type="Episode"], a[href*="sezon"][href*="/"], ' +
        'a.episode-item, [class*="episode"] a[href]'
      );

      epLinks.forEach((link, idx) => {
        const href = link.getAttribute('href') || '';
        const title = link.getAttribute('title') || link.textContent?.trim() || '';
        if (href && !episodes.find(e => e.customData?.slug === href)) {
          episodes.push({
            no: episodes.length + 1,
            title: title.substring(0, 100),
            customData: { slug: href }
          });
        }
      });

      if (episodes.length > 0) {
        seasonsData[seasonIdx].episodes = episodes;
        log(`  ${episodes.length} bölüm yüklendi (HTML)`);
        return true;
      }

      log(`  Bölüm bulunamadı`);
      return false;
    } catch (e) {
      log(`  Bölüm yükleme hatası: ${e.message}`);
      return false;
    }
  }

  // ==================== Batch Download ====================

  async function batchDownloadSeason(seasonIdx, filterLang) {
    if (isProcessing) return;
    if (!seasonsData || !seasonsData[seasonIdx]) return;

    isProcessing = true;
    const season = seasonsData[seasonIdx];
    const episodes = Array.isArray(season.episodes) ? season.episodes : [];
    if (episodes.length === 0) {
      log(`⚠ ${season.title} bölüm listesi boş veya yüklenemedi`);
      isProcessing = false;
      return;
    }
    const zip = new JSZip();
    let downloaded = 0;
    let failed = 0;

    updateProgress(0, true);
    log(`${season.title} indirme başlıyor (${episodes.length} bölüm)...`);

    for (let i = 0; i < episodes.length; i++) {
      const ep = episodes[i];
      const epNum = String(ep.no).padStart(2, '0');
      const epLabel = `S${String(season.no).padStart(2, '0')}E${epNum}`;
      const epTitle = sanitize(ep.title);

      log(`[${i+1}/${episodes.length}] ${epLabel} - ${ep.title}`);
      updateProgress((i / episodes.length) * 100);

      try {
        // 1. Bölüm sayfasını fetch et → asset bilgisi al
        const slug = ep.customData?.slug;
        if (!slug) {
          log(`  ⚠ Slug yok, atlıyorum`);
          failed++;
          continue;
        }

        log(`  Sayfa yükleniyor...`);
        const asset = await fetchEpisodeAsset(slug);
        if (!asset) {
          log(`  ⚠ Asset bilgisi bulunamadı`);
          failed++;
          continue;
        }
        log(`  Asset: ${asset.AssetId}`);

        // 2. playRequest → CDN URL → MPD → altyazılar
        log(`  Altyazılar alınıyor...`);
        const tracks = await getSubtitlesForEpisode(asset);
        if (tracks.length === 0) {
          log(`  ⚠ Altyazı bulunamadı`);
          failed++;
          continue;
        }

        // 3. Filtrelenmiş track'leri indir
        const targetTracks = filterLang ? tracks.filter(t => t.lang === filterLang) : tracks;

        for (const track of targetTracks) {
          try {
            const resp = await gmFetch(track.url);
            const vttText = resp.responseText;
            const srtText = vttToSrt(vttText);
            const filename = `${seriesName}.${epLabel}.${getLangName(track.lang)}.srt`;
            zip.file(filename, '\ufeff' + srtText);
            downloaded++;
            log(`  ✓ ${getLangName(track.lang)}`);
          } catch (e) {
            log(`  ✗ ${getLangName(track.lang)}: ${e.message}`);
          }
        }

      } catch (e) {
        log(`  ✗ Hata: ${e.message}`);
        failed++;
      }

      // Rate limiting
      if (i < episodes.length - 1) {
        await sleep(500);
      }
    }

    // ZIP oluştur ve indir
    updateProgress(100);
    log(`ZIP oluşturuluyor (${downloaded} altyazı)...`);

    const langSuffix = filterLang ? `.${getLangName(filterLang)}` : '.All.Languages';
    const zipName = `${seriesName}.${season.title.replace(/\s+/g, '')}${langSuffix}.srt.zip`;

    try {
      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, zipName);
      log(`✓ İndirme tamamlandı: ${zipName}`);
      log(`  ${downloaded} başarılı, ${failed} başarısız`);
    } catch (e) {
      log(`ZIP hatası: ${e.message}`);
    }

    isProcessing = false;
    updateProgress(0, false);
    createMenu();
  }

  // ==================== Single Episode Download ====================

  async function downloadSubtitle(track, format) {
    try {
      const resp = await fetch(track.url);
      let text = await resp.text();
      if (format === 'srt') text = vttToSrt(text);

      // Dosya adı: DiziAdi.S01E01.Turkce.srt
      const parts = [seriesName];
      if (currentEpLabel) parts.push(currentEpLabel);
      parts.push(getLangName(track.lang));
      const filename = parts.join('.') + '.' + format;

      const blob = new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      log(`İndirildi: ${filename}`);
    } catch (e) {
      log(`İndirme hatası: ${e.message}`);
      alert('Altyazı indirme hatası: ' + e.message);
    }
  }

  async function downloadCurrentZip() {
    if (currentTracks.length === 0) return;
    const zip = new JSZip();

    const parts = [seriesName];
    if (currentEpLabel) parts.push(currentEpLabel);
    const prefix = parts.join('.');

    for (const track of currentTracks) {
      try {
        const resp = await fetch(track.url);
        const vtt = await resp.text();
        zip.file(`${prefix}.${getLangName(track.lang)}.srt`, '\ufeff' + vttToSrt(vtt));
      } catch (e) {
        log(`Hata (${track.lang}): ${e.message}`);
      }
    }

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `${prefix}.srt.zip`);
  }

  // ==================== UI ====================

  let logEl = null;

  function log(msg) {
    console.log(`[TOD-SD] ${msg}`);
    if (logEl) {
      logEl.style.display = 'block';
      logEl.textContent += msg + '\n';
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  function updateProgress(pct, show) {
    const bar = document.querySelector(`#${MENU_ID} .sd-progress-bar`);
    const container = document.querySelector(`#${MENU_ID} .sd-progress`);
    if (bar) bar.style.width = pct + '%';
    if (container && show !== undefined) container.style.display = show ? 'block' : 'none';
  }

  function createMenu() {
    const existing = document.getElementById(MENU_ID);
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = MENU_ID;

    const btn = document.createElement('button');
    btn.className = 'sd-btn';
    const trackCount = currentTracks.length;
    btn.innerHTML = `🔤 Altyazı İndir${trackCount > 0 ? ` <span class="sd-badge">${trackCount}</span>` : ''}`;

    const dd = document.createElement('div');
    dd.className = 'sd-dropdown';

    // Progress bar
    const progress = document.createElement('div');
    progress.className = 'sd-progress';
    const pbar = document.createElement('div');
    pbar.className = 'sd-progress-bar';
    progress.appendChild(pbar);
    dd.appendChild(progress);

    // === Mevcut Bölüm ===
    if (currentTracks.length > 0) {
      addSection(dd, '📺 Mevcut Bölüm');

      currentTracks.forEach(track => {
        addItem(dd, getLangName(track.lang), 'SRT', () => downloadSubtitle(track, 'srt'));
        addItem(dd, getLangName(track.lang), 'VTT', () => downloadSubtitle(track, 'vtt'));
      });

      if (currentTracks.length > 1) {
        addAction(dd, '📦 Bu Bölümü ZIP (SRT)', 'green', () => downloadCurrentZip());
      }
    } else {
      addStatus(dd, 'Video oynatın, altyazılar otomatik yakalanacak...');
    }

    // === Sezon Toplu İndirme ===
    if (seasonsData && seasonsData.length > 0) {
      seasonsData.forEach((season, idx) => {
        const eps = Array.isArray(season.episodes) ? season.episodes : [];
        const epCount = eps.length;

        if (epCount === 0) {
          addSection(dd, `📁 ${season.title} — Bölümler yükleniyor...`);
          addAction(dd, `🔄 ${season.title} — Bölümleri Yükle`, 'orange',
            async () => {
              log(`${season.title} bölümleri yükleniyor...`);
              const loaded = await loadSeasonEpisodes(idx);
              if (loaded) {
                createMenu(); // Menüyü yeniden oluştur
              } else {
                log(`⚠ Bölümler yüklenemedi. Bir bölüm sayfasına gidip tekrar deneyin.`);
              }
            });
        } else {
          addSection(dd, `📁 ${season.title} (${epCount} bölüm) — Toplu İndirme`);
          addInfo(dd, `⚠️ Giriş yapılı olmalı. Her bölüm için sayfa + API çağrısı yapılır.`);

          // Türkçe
          addAction(dd, `📦 ${season.title} — Türkçe (ZIP)`, 'orange',
            () => batchDownloadSeason(idx, 'tr'));
          // İngilizce
          addAction(dd, `📦 ${season.title} — English (ZIP)`, 'orange',
            () => batchDownloadSeason(idx, 'en'));
          // Tüm diller
          addAction(dd, `📦 ${season.title} — Tüm Diller (ZIP)`, 'red',
          () => batchDownloadSeason(idx, null));
        }
      });
    } else {
      addInfo(dd, '💡 Sezon bilgisi bulunamadı. Dizinin bölüm sayfasında olduğunuzdan emin olun.');
    }

    // Log alanı
    logEl = document.createElement('div');
    logEl.className = 'sd-log';
    dd.appendChild(logEl);

    // Toggle
    btn.addEventListener('click', () => dd.classList.toggle('open'));
    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) dd.classList.remove('open');
    });

    container.appendChild(btn);
    container.appendChild(dd);
    document.body.appendChild(container);
  }

  function addSection(parent, text) {
    const el = document.createElement('div');
    el.className = 'sd-section'; el.textContent = text;
    parent.appendChild(el);
  }

  function addItem(parent, label, format, onClick) {
    const el = document.createElement('div');
    el.className = 'sd-item';
    el.innerHTML = `<span class="sd-lang">${label}</span><span class="sd-format">${format}</span>`;
    el.addEventListener('click', onClick);
    parent.appendChild(el);
  }

  function addAction(parent, text, color, onClick) {
    const el = document.createElement('div');
    el.className = `sd-action ${color}`;
    el.textContent = text;
    el.addEventListener('click', onClick);
    parent.appendChild(el);
  }

  function addStatus(parent, text) {
    const el = document.createElement('div');
    el.className = 'sd-status'; el.textContent = text;
    parent.appendChild(el);
  }

  function addInfo(parent, text) {
    const el = document.createElement('div');
    el.className = 'sd-info'; el.textContent = text;
    parent.appendChild(el);
  }

  // ==================== Network Interceptor ====================

  function injectInterceptor() {
    const script = document.createElement('script');
    script.textContent = `(function() {
      const realFetch = window.fetch;
      const realXHROpen = XMLHttpRequest.prototype.open;
      const realXHRSend = XMLHttpRequest.prototype.send;

      window.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        if (url.includes('.mpd')) {
          const response = await realFetch.apply(this, args);
          const cloned = response.clone();
          cloned.text().then(text => {
            window.dispatchEvent(new CustomEvent('tod_sd_mpd', {
              detail: { url, content: text }
            }));
          });
          return response;
        }
        return realFetch.apply(this, args);
      };

      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this._tod_url = url;
        return realXHROpen.apply(this, [method, url, ...rest]);
      };

      XMLHttpRequest.prototype.send = function(...args) {
        if (this._tod_url && this._tod_url.includes('.mpd')) {
          this.addEventListener('load', function() {
            window.dispatchEvent(new CustomEvent('tod_sd_mpd', {
              detail: { url: this._tod_url, content: this.responseText }
            }));
          });
        }
        return realXHRSend.apply(this, args);
      };
    })()`;
    document.head.appendChild(script);
    document.head.removeChild(script);
  }

  // MPD yakalandığında
  window.addEventListener('tod_sd_mpd', function(e) {
    const { url, content } = e.detail;
    const tracks = parseMPD(content, url);
    if (tracks.length > 0) {
      currentTracks = tracks;
      currentTitle = detectEpisodeTitle();
      log(`${tracks.length} altyazı yakalandı (${currentTitle})`);
      createMenu();
    }
  });

  function detectEpisodeTitle() {
    // window.movieInfo.title veya sayfa başlığından
    try {
      if (unsafeWindow.movieInfo?.title) {
        return sanitize(unsafeWindow.movieInfo.title);
      }
    } catch(e) {}

    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      const m = s.textContent.match(/movieInfo\s*=\s*\{\s*title:\s*'([^']+)'/);
      if (m) return sanitize(m[1]);
    }

    const h1 = document.querySelector('h1');
    if (h1) return sanitize(h1.textContent.trim());

    return sanitize(document.title.split(' - ')[0] || 'TOD');
  }

  // ==================== Init ====================

  function init() {
    // CSS ekle
    const style = document.createElement('style');
    style.textContent = MENU_CSS;
    document.head.appendChild(style);

    // Network interceptor
    injectInterceptor();

    // Sezon verisini çıkar
    extractSeasonsData();
    extractSeriesName();
    detectCurrentEpLabel();

    // Menüyü oluştur
    createMenu();

    console.log(`[TOD-SD] v${VERSION} yüklendi | URL: ${location.pathname} | Dizi: ${seriesName} | Sezon: ${seasonsData ? seasonsData.length : 0}`);
  }

  // DOM hazır olunca başlat
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Gecikmeli yeniden deneme (SPA/lazy-load sayfalar için)
  setTimeout(() => {
    if (!seasonsData || seasonsData.length === 0) {
      log('Gecikmeli sezon verisi denemesi...');
      extractSeasonsData();
      extractSeriesName();
      createMenu();
    }
  }, 3000);

  // SPA navigasyonlarını izle
  let lastURL = location.href;
  new MutationObserver(() => {
    if (location.href !== lastURL) {
      lastURL = location.href;
      currentTracks = [];
      currentTitle = '';
      seasonsData = null;
      setTimeout(() => {
        extractSeasonsData();
        extractSeriesName();
        createMenu();
      }, 1500);
    }
  }).observe(document.body, { childList: true, subtree: true });

})();
