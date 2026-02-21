// ==UserScript==
// @name        TOD TV - Subtitle Downloader
// @description TOD TV (todtv.com.tr) altyazı indirici. Tek bölüm veya tüm sezonu ZIP olarak indirir.
// @license     MIT
// @version     3.0.0
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

  // ============================================================
  // SECTION 1: CONSTANTS & CONFIGURATION
  // ============================================================

  const VERSION = '3.0.0';
  const MENU_ID = 'tod-subtitle-downloader-menu';
  const STORAGE_PREFIX = 'tod_sd_';

  const API = {
    PLAY_REQUEST: '/content/playRequest',
    BASE_URL: 'https://www.todtv.com.tr',
  };

  const TIMING = {
    FETCH_TIMEOUT: 30000,
    GM_FETCH_TIMEOUT: 45000,
    RATE_LIMIT_DELAY: 500,
    SPA_REINIT_DELAY: 1500,
    LAZY_RETRY_DELAY: 3000,
    RETRY_BASE_DELAY: 1000,
    RETRY_MAX_ATTEMPTS: 3,
    TOAST_DURATION: 4000,
    CACHE_TTL: 24 * 60 * 60 * 1000,
    HISTORY_MAX_ENTRIES: 500,
    DEBOUNCE_SPA: 300,
  };

  const DEFAULT_SETTINGS = {
    defaultLanguage: '',
    defaultFormat: 'srt',
    autoDownloadOnPlay: false,
    rateLimitDelay: TIMING.RATE_LIMIT_DELAY,
    theme: 'dark',
  };

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

  const LANG_SAFE = {
    'tr': 'Turkce', 'en': 'English', 'ar': 'Arabic', 'de': 'Deutsch',
    'fr': 'Francais', 'es': 'Espanol', 'it': 'Italiano', 'pt': 'Portugues',
    'ru': 'Russian', 'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese',
    'nl': 'Nederlands', 'pl': 'Polski', 'sv': 'Svenska', 'da': 'Dansk',
    'no': 'Norsk', 'fi': 'Suomi', 'el': 'Greek', 'he': 'Hebrew',
    'hi': 'Hindi', 'th': 'Thai', 'ro': 'Romana', 'hu': 'Magyar',
    'cs': 'Cestina', 'bg': 'Bulgarian', 'hr': 'Hrvatski', 'sr': 'Srpski',
    'uk': 'Ukrainian', 'fa': 'Farsi', 'tur': 'Turkce', 'eng': 'English',
  };

  // ============================================================
  // SECTION 2: STATE MANAGEMENT
  // ============================================================

  const AppState = {
    currentTracks: [],
    currentTitle: '',
    seasonsData: null,
    seriesName: '',
    seriesNameClean: '',
    currentEpLabel: '',
    isProcessing: false,
    batchAbortController: null,
    interceptorInjected: false,
    settingsOpen: false,
    logEl: null,
  };

  const EventBus = {
    _listeners: {},
    on(event, fn) {
      (this._listeners[event] = this._listeners[event] || []).push(fn);
    },
    off(event, fn) {
      if (!this._listeners[event]) return;
      this._listeners[event] = this._listeners[event].filter(f => f !== fn);
    },
    emit(event, data) {
      (this._listeners[event] || []).forEach(fn => {
        try { fn(data); } catch(e) { console.error(`[TOD-SD] EventBus error (${event}):`, e); }
      });
    }
  };

  // ============================================================
  // SECTION 3: SETTINGS & STORAGE
  // ============================================================

  const Storage = {
    _key(name) { return STORAGE_PREFIX + name; },
    get(name, fallback = null) {
      try {
        const raw = localStorage.getItem(this._key(name));
        return raw !== null ? JSON.parse(raw) : fallback;
      } catch { return fallback; }
    },
    set(name, value) {
      try { localStorage.setItem(this._key(name), JSON.stringify(value)); }
      catch(e) { console.warn('[TOD-SD] Storage write failed:', e); }
    },
    remove(name) {
      try { localStorage.removeItem(this._key(name)); } catch {}
    },
  };

  const Settings = {
    _data: { ...DEFAULT_SETTINGS },
    load() {
      const saved = Storage.get('settings', {});
      this._data = { ...DEFAULT_SETTINGS, ...saved };
    },
    save() { Storage.set('settings', this._data); },
    get(key) { return this._data[key]; },
    set(key, value) {
      this._data[key] = value;
      this.save();
      EventBus.emit('settings:changed', { key, value });
    },
    getAll() { return { ...this._data }; },
    exportAll() {
      return JSON.stringify({
        settings: this._data,
        history: DownloadHistory.getAll(),
        version: VERSION,
        exportedAt: Date.now(),
      }, null, 2);
    },
    importAll(jsonString) {
      try {
        const data = JSON.parse(jsonString);
        if (data.settings) {
          this._data = { ...DEFAULT_SETTINGS, ...data.settings };
          this.save();
        }
        if (data.history) {
          DownloadHistory.setAll(data.history);
        }
        return true;
      } catch { return false; }
    },
  };

  const Cache = {
    get(key) {
      const entry = Storage.get('cache_' + key);
      if (!entry) return null;
      if (Date.now() - entry.ts > TIMING.CACHE_TTL) {
        Storage.remove('cache_' + key);
        return null;
      }
      return entry.data;
    },
    set(key, data) { Storage.set('cache_' + key, { data, ts: Date.now() }); },
    clear() {
      const prefix = STORAGE_PREFIX + 'cache_';
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith(prefix)) localStorage.removeItem(k);
      });
    },
  };

  const DownloadHistory = {
    _data: {},
    load() { this._data = Storage.get('history', {}); },
    save() {
      const entries = Object.entries(this._data);
      if (entries.length > TIMING.HISTORY_MAX_ENTRIES) {
        entries.sort((a, b) => a[1] - b[1]);
        entries.slice(0, entries.length - TIMING.HISTORY_MAX_ENTRIES).forEach(([key]) => delete this._data[key]);
      }
      Storage.set('history', this._data);
    },
    mark(identifier) { this._data[identifier] = Date.now(); this.save(); },
    isDownloaded(identifier) { return !!this._data[identifier]; },
    getAll() { return { ...this._data }; },
    setAll(data) { this._data = data; this.save(); },
    clear() { this._data = {}; this.save(); },
    count() { return Object.keys(this._data).length; },
  };

  // ============================================================
  // SECTION 4: UTILITY FUNCTIONS
  // ============================================================

  const getLangName = (code) => LANG_NAMES[code] || code.toUpperCase();
  const getLangSafe = (code) => LANG_SAFE[code] || code.toUpperCase();

  function sanitize(name) {
    return name
      .replace(/\.\./g, '_')
      .replace(/[:*?"<>|\\\/]+/g, '_')
      .replace(/[\x00-\x1f\x7f]/g, '')
      .replace(/\s+/g, '.')
      .replace(/\.{2,}/g, '.')
      .replace(/^\.+|\.+$/g, '')
      .substring(0, 120) || 'unnamed';
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function debounce(fn, delay) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function formatETA(msRemaining) {
    if (!msRemaining || msRemaining < 0) return '';
    const sec = Math.ceil(msRemaining / 1000);
    if (sec < 60) return `~${sec}s`;
    return `~${Math.floor(sec / 60)}m ${sec % 60}s`;
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = TIMING.FETCH_TIMEOUT) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (e) {
      if (e.name === 'AbortError') throw new Error(`Zaman aşımı (${Math.round(timeoutMs/1000)}s): ${url.substring(0, 80)}`);
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function gmFetchWithTimeout(url, opts = {}, timeoutMs = TIMING.GM_FETCH_TIMEOUT) {
    return new Promise((resolve, reject) => {
      let aborted = false;
      if (opts.signal) {
        if (opts.signal.aborted) { reject(new Error('İstek iptal edildi')); return; }
        opts.signal.addEventListener('abort', () => { aborted = true; reject(new Error('İstek kullanıcı tarafından iptal edildi')); });
      }
      GM_xmlhttpRequest({
        method: opts.method || 'GET',
        url,
        headers: opts.headers || {},
        responseType: opts.responseType || 'text',
        timeout: timeoutMs,
        onload: (resp) => {
          if (aborted) return;
          resolve({
            ok: resp.status >= 200 && resp.status < 400,
            status: resp.status,
            url: resp.finalUrl || url,
            text: () => Promise.resolve(resp.responseText),
            responseText: resp.responseText
          });
        },
        onerror: (e) => {
          if (aborted) return;
          reject(new Error(`GM istek hatası: ${e.statusText || 'network error'} — ${url.substring(0, 80)}`));
        },
        ontimeout: () => {
          if (aborted) return;
          reject(new Error(`GM zaman aşımı (${Math.round(timeoutMs/1000)}s): ${url.substring(0, 80)}`));
        }
      });
    });
  }

  async function retryWithBackoff(fn, { maxAttempts = TIMING.RETRY_MAX_ATTEMPTS, baseDelay = TIMING.RETRY_BASE_DELAY, context = '', signal = null } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn(attempt);
      } catch (e) {
        lastError = e;
        if (signal?.aborted) throw e;
        if (attempt < maxAttempts) {
          const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 500;
          log(`${context} deneme ${attempt}/${maxAttempts} başarısız: ${e.message}. ${Math.round(delay)}ms sonra tekrar...`);
          await sleep(delay);
        }
      }
    }
    throw new Error(`${context} ${maxAttempts} denemeden sonra başarısız: ${lastError.message}`);
  }

  // ============================================================
  // SECTION 5: CSS STYLES
  // ============================================================

  const MENU_CSS = `
    #${MENU_ID} {
      position: fixed; top: 10px; right: 10px; z-index: 999999999;
      font-family: Arial, sans-serif; font-size: 13px;
    }
    #${MENU_ID} * { box-sizing: border-box; }
    #${MENU_ID} .sd-btn {
      background: #e50914; color: #fff; border: none; padding: 8px 14px;
      border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: bold;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3); transition: background 0.2s;
    }
    #${MENU_ID} .sd-btn:hover { background: #b0060f; }
    #${MENU_ID} .sd-btn.loading::after {
      content: ''; display: inline-block; width: 12px; height: 12px;
      border: 2px solid #fff; border-top-color: transparent;
      border-radius: 50%; margin-left: 8px; vertical-align: middle;
      animation: sd-spin 0.8s linear infinite;
    }
    @keyframes sd-spin { to { transform: rotate(360deg); } }
    #${MENU_ID} .sd-badge {
      background: #fff; color: #e50914; border-radius: 50%;
      padding: 1px 6px; margin-left: 6px; font-size: 11px;
    }
    #${MENU_ID} .sd-badge-progress {
      border-radius: 10px; padding: 2px 8px; font-weight: bold;
      font-size: 12px; letter-spacing: 0.5px;
      animation: sd-pulse 1.5s ease-in-out infinite;
    }
    @keyframes sd-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
    #${MENU_ID} .sd-beta-tag {
      background: #ff6b00; color: #fff; border-radius: 4px;
      padding: 1px 5px; margin-left: 6px; font-size: 9px;
      font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;
      vertical-align: middle;
    }
    #${MENU_ID} .sd-dropdown {
      display: none; background: #1a1a1a; border: 1px solid #333;
      border-radius: 8px; margin-top: 6px; box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      min-width: 320px; max-height: 600px; overflow-y: auto;
    }
    #${MENU_ID} .sd-dropdown.open { display: block; }
    #${MENU_ID} .sd-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 14px; background: #222; border-bottom: 1px solid #333;
      border-radius: 8px 8px 0 0;
    }
    #${MENU_ID} .sd-header-title { color: #fff; font-weight: bold; font-size: 12px; }
    #${MENU_ID} .sd-header-actions { display: flex; gap: 8px; }
    #${MENU_ID} .sd-icon-btn {
      background: none; border: none; color: #888; cursor: pointer;
      font-size: 16px; padding: 2px 4px; border-radius: 4px; transition: color 0.2s;
    }
    #${MENU_ID} .sd-icon-btn:hover { color: #fff; }
    #${MENU_ID} .sd-section {
      padding: 8px 14px; background: #222; color: #aaa; font-size: 11px;
      text-transform: uppercase; letter-spacing: 1px;
      border-bottom: 1px solid #333; border-top: 1px solid #333;
    }
    #${MENU_ID} .sd-section:first-child { border-top: none; }
    #${MENU_ID} .sd-item {
      padding: 9px 14px; color: #fff; cursor: pointer;
      display: flex; justify-content: space-between; align-items: center;
      transition: background 0.15s;
    }
    #${MENU_ID} .sd-item:hover { background: #333; }
    #${MENU_ID} .sd-item .sd-downloaded { color: #4CAF50; font-size: 10px; margin-left: 6px; }
    #${MENU_ID} .sd-lang { font-weight: bold; }
    #${MENU_ID} .sd-format {
      color: #888; font-size: 11px; background: #2a2a2a;
      padding: 2px 6px; border-radius: 3px;
    }
    #${MENU_ID} .sd-action {
      padding: 10px 14px; cursor: pointer; font-weight: bold;
      text-align: center; border-top: 1px solid #333; transition: background 0.15s;
    }
    #${MENU_ID} .sd-action:hover { background: #333; }
    #${MENU_ID} .sd-action.green { color: #4CAF50; }
    #${MENU_ID} .sd-action.orange { color: #FF9800; }
    #${MENU_ID} .sd-action.red { color: #e50914; }
    #${MENU_ID} .sd-action.disabled { color: #555; cursor: not-allowed; pointer-events: none; opacity: 0.5; }
    #${MENU_ID} .sd-cancel {
      padding: 10px 14px; cursor: pointer; font-weight: bold;
      text-align: center; border-top: 1px solid #333;
      color: #e50914; background: #2a1a1a; transition: background 0.15s;
    }
    #${MENU_ID} .sd-cancel:hover { background: #3a2020; }
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
    #${MENU_ID} .sd-progress-text {
      font-size: 10px; color: #aaa; text-align: center; padding: 4px;
      background: #111; display: none;
    }
    #${MENU_ID} .sd-log {
      padding: 6px 14px; color: #555; font-size: 10px; font-family: monospace;
      max-height: 100px; overflow-y: auto; background: #111;
      border-top: 1px solid #222; display: none;
    }
    #${MENU_ID} .sd-settings {
      padding: 12px 14px; display: none;
    }
    #${MENU_ID} .sd-settings.open { display: block; }
    #${MENU_ID} .sd-settings label {
      display: flex; justify-content: space-between; align-items: center;
      padding: 6px 0; color: #ccc; font-size: 12px;
    }
    #${MENU_ID} .sd-settings select,
    #${MENU_ID} .sd-settings input[type="number"] {
      background: #333; color: #fff; border: 1px solid #555;
      padding: 4px 8px; border-radius: 4px; font-size: 12px; width: 120px;
    }
    #${MENU_ID} .sd-settings input[type="checkbox"] {
      width: 16px; height: 16px; accent-color: #e50914;
    }
    #${MENU_ID} .sd-settings-btn {
      display: inline-block; margin: 6px 4px 6px 0; padding: 5px 12px; font-size: 11px;
      cursor: pointer; border: 1px solid #444; border-radius: 4px;
      background: #2a2a2a; color: #ccc; transition: background 0.15s;
    }
    #${MENU_ID} .sd-settings-btn:hover { background: #444; }
    #${MENU_ID} .sd-settings-btn.danger { color: #e50914; border-color: #e50914; }
    #${MENU_ID} .sd-settings-sep {
      border: none; border-top: 1px solid #333; margin: 8px 0;
    }

    /* Toast */
    .sd-toast-container {
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      z-index: 9999999999; display: flex; flex-direction: column; gap: 8px;
      pointer-events: none;
    }
    .sd-toast {
      background: #333; color: #fff; padding: 10px 18px; border-radius: 8px;
      font-size: 13px; box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      animation: sd-toast-in 0.3s ease; pointer-events: auto;
      max-width: 400px; text-align: center; font-family: Arial, sans-serif;
    }
    .sd-toast.success { border-left: 4px solid #4CAF50; }
    .sd-toast.error { border-left: 4px solid #e50914; }
    .sd-toast.info { border-left: 4px solid #2196F3; }
    @keyframes sd-toast-in {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Light theme */
    #${MENU_ID}.sd-light .sd-dropdown { background: #f5f5f5; border-color: #ddd; }
    #${MENU_ID}.sd-light .sd-header { background: #eee; border-color: #ddd; }
    #${MENU_ID}.sd-light .sd-header-title { color: #333; }
    #${MENU_ID}.sd-light .sd-section { background: #eee; color: #666; border-color: #ddd; }
    #${MENU_ID}.sd-light .sd-item { color: #333; }
    #${MENU_ID}.sd-light .sd-item:hover { background: #e0e0e0; }
    #${MENU_ID}.sd-light .sd-format { background: #ddd; color: #555; }
    #${MENU_ID}.sd-light .sd-info { background: #eee; color: #666; }
    #${MENU_ID}.sd-light .sd-log { background: #eee; color: #666; border-color: #ddd; }
    #${MENU_ID}.sd-light .sd-progress { background: #ddd; }
    #${MENU_ID}.sd-light .sd-progress-text { background: #eee; color: #666; }
    #${MENU_ID}.sd-light .sd-settings label { color: #333; }
    #${MENU_ID}.sd-light .sd-settings select,
    #${MENU_ID}.sd-light .sd-settings input[type="number"] { background: #fff; color: #333; border-color: #ccc; }

    /* Responsive */
    @media (max-width: 480px) {
      #${MENU_ID} { top: auto; bottom: 10px; right: 10px; left: 10px; }
      #${MENU_ID} .sd-dropdown { min-width: auto; width: 100%; max-height: 70vh; }
      #${MENU_ID} .sd-btn { width: 100%; font-size: 14px; padding: 10px; }
    }
  `;

  // ============================================================
  // SECTION 6: VTT → SRT CONVERTER
  // ============================================================

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

  // ============================================================
  // SECTION 7: MPD PARSER
  // ============================================================

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

  // ============================================================
  // SECTION 8: DATA EXTRACTION
  // ============================================================

  function getAntiForgeryToken() {
    const el = document.querySelector('input[name="__RequestVerificationToken"]');
    return el ? el.value : '';
  }

  function extractSeasonsData() {
    // Yöntem 1: var seasons JSON
    try {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent;
        const match = text.match(/var\s+seasons\s*=\s*(\[[\s\S]*?\]);/);
        if (match) {
          AppState.seasonsData = JSON.parse(match[1]);
          log(`Sezon verisi bulundu (JS): ${AppState.seasonsData.length} sezon`);
          return true;
        }
      }
    } catch (e) {
      log(`JS sezon verisi hatası: ${e.message}`);
    }

    // Yöntem 2: HTML'den bölüm listesi
    try {
      const result = extractSeasonsFromHTML();
      if (result && result.length > 0) {
        AppState.seasonsData = result;
        log(`Sezon verisi bulundu (HTML): ${AppState.seasonsData.length} sezon`);
        return true;
      }
    } catch (e) {
      log(`HTML sezon verisi hatası: ${e.message}`);
    }

    // Yöntem 3: Sezon tab'ları
    try {
      const result = extractSeasonsFromTabs();
      if (result && result.length > 0) {
        AppState.seasonsData = result;
        log(`Sezon verisi bulundu (Tabs): ${AppState.seasonsData.length} sezon`);
        return true;
      }
    } catch (e) {
      log(`Tab sezon verisi hatası: ${e.message}`);
    }

    log('Sezon verisi bulunamadı');
    return false;
  }

  function extractSeasonsFromHTML() {
    const episodeLinks = document.querySelectorAll(
      'a[href*="sezon"][href*="/"], a[data-content-type="Episode"], ' +
      'a.episode-item, a[class*="episode"], [data-cms-id][href]'
    );

    if (episodeLinks.length > 0) {
      const seasonMap = {};
      episodeLinks.forEach(link => {
        const href = link.getAttribute('href') || '';
        const seasonMatch = href.match(/(\d+)\s*sezon/i) || href.match(/season-?(\d+)/i);
        const seasonNum = seasonMatch ? parseInt(seasonMatch[1]) : 1;

        if (!seasonMap[seasonNum]) {
          seasonMap[seasonNum] = { no: seasonNum, title: `${seasonNum}. Sezon`, episodes: [] };
        }

        const title = link.getAttribute('title') || link.textContent?.trim() || '';
        const slug = href.startsWith('/') ? href : `/${href}`;

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
    const tabs = document.querySelectorAll(
      '[data-season-no], .season-tab, [class*="season-tab"], ' +
      'a[href*="#season"], button[data-season]'
    );
    if (tabs.length === 0) return null;
    log(`${tabs.length} sezon tab'ı bulundu`);
    return null;
  }

  function extractSeriesName() {
    // 1) contentOrgName
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      const m = s.textContent.match(/contentOrgName\s*[:=]\s*['"](.*?)['"]/);
      if (m) {
        AppState.seriesNameClean = m[1].trim();
        AppState.seriesName = sanitize(AppState.seriesNameClean);
        break;
      }
    }

    // 2) URL fallback
    if (!AppState.seriesName) {
      const path = window.location.pathname;
      const match = path.match(/\/([^/]+)\/[^/]*sezon/i);
      if (match) {
        AppState.seriesNameClean = match[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        AppState.seriesName = sanitize(AppState.seriesNameClean);
      }
    }

    // 3) Son fallback
    if (!AppState.seriesName) {
      AppState.seriesNameClean = document.title.split(' - ')[0]?.trim() || 'TOD';
      AppState.seriesName = sanitize(AppState.seriesNameClean);
    }
  }

  function detectCurrentEpLabel() {
    AppState.currentEpLabel = '';
    const path = window.location.pathname;

    if (AppState.seasonsData) {
      for (const season of AppState.seasonsData) {
        if (!Array.isArray(season.episodes)) continue;
        for (const ep of season.episodes) {
          if (ep.customData?.slug && path.includes(ep.customData.slug.replace(/^\//, ''))) {
            AppState.currentEpLabel = `S${String(season.no).padStart(2, '0')}E${String(ep.no).padStart(2, '0')}`;
            return;
          }
        }
      }
    }

    const sMatch = path.match(/(\d+)sezon/i);
    const scripts2 = document.querySelectorAll('script');
    for (const s of scripts2) {
      const m = s.textContent.match(/movieInfo\s*=\s*\{/);
      if (m) {
        const infoMatch = s.textContent.match(/'(\d+)\.?\s*B[öo]l[üu]m/i);
        if (infoMatch && sMatch) {
          AppState.currentEpLabel = `S${String(sMatch[1]).padStart(2,'0')}E${String(infoMatch[1]).padStart(2,'0')}`;
          return;
        }
      }
    }

    const epItem = document.querySelector('.season-episode-item.active, .season-episode-item[aria-current]');
    if (epItem) {
      const info = epItem.getAttribute('data-info') || '';
      const m = info.match(/(\d+)\.S:B(\d+)/);
      if (m) {
        AppState.currentEpLabel = `S${String(m[1]).padStart(2,'0')}E${String(m[2]).padStart(2,'0')}`;
        return;
      }
    }

    if (sMatch) {
      AppState.currentEpLabel = `S${String(sMatch[1]).padStart(2,'0')}`;
    }
  }

  function detectEpisodeTitle() {
    try {
      if (unsafeWindow.movieInfo?.title) return sanitize(unsafeWindow.movieInfo.title);
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

  // ============================================================
  // SECTION 9: API & NETWORK
  // ============================================================

  async function fetchEpisodeAsset(episodeSlug, signal) {
    try {
      const url = episodeSlug.startsWith('http') ? episodeSlug : `${API.BASE_URL}${episodeSlug}`;
      const resp = await fetchWithTimeout(url, { credentials: 'include', signal }, TIMING.FETCH_TIMEOUT);
      const html = await resp.text();

      let result = null;

      // data-asset-list
      const match = html.match(/data-asset-list="([^"]+)"/);
      if (match) {
        const decoded = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        const assets = JSON.parse(decoded);
        if (assets.length > 0) {
          result = assets[0];
          log(`  asset-list: AssetId=${result.AssetId}, IsDrm=${result.IsDrm}`);
        }
      }

      // Alternatif: buton attribute'ları
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

      // data-version-id
      const versionMatch = html.match(/data-version-id="(PV[^"]+)"/);
      if (versionMatch) result.VersionId = versionMatch[1];

      // AntiForgeryToken
      const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
      if (tokenMatch) {
        result._pageToken = tokenMatch[1];
      } else {
        const tokenMatch2 = html.match(/value="([^"]+)"[^>]*name="__RequestVerificationToken"/);
        if (tokenMatch2) result._pageToken = tokenMatch2[1];
      }

      result._refererUrl = url;

      if (!result.CmsContentId) {
        const cmsMatch2 = html.match(/data-cms-id="(PT\d+)"/);
        if (cmsMatch2) result.CmsContentId = cmsMatch2[1];
      }

      return result;
    } catch (e) {
      log(`Bölüm fetch hatası (${episodeSlug}): ${e.message}`);
      return null;
    }
  }

  async function playRequestAPI(asset, signal) {
    try {
      const token = asset._pageToken || getAntiForgeryToken();

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
      if (asset._refererUrl) headers['Referer'] = asset._refererUrl;

      const resp = await fetchWithTimeout(API.PLAY_REQUEST, {
        method: 'POST', credentials: 'include', headers, body: body.toString(), signal
      }, TIMING.FETCH_TIMEOUT);

      const json = await resp.json();
      log(`  playRequest: Action=${json.Action}, CdnUrl=${json.CdnUrl ? 'VAR' : 'YOK'}, Message=${json.Message || '-'}`);

      if (!json.CdnUrl) {
        log(`  playRequest yanıtı: ${JSON.stringify(json).substring(0, 300)}`);
      }
      return json;
    } catch (e) {
      log(`playRequest hatası: ${e.message}`);
      return null;
    }
  }

  async function getSubtitlesForEpisode(asset, signal) {
    const playResp = await retryWithBackoff(
      () => playRequestAPI(asset, signal),
      { maxAttempts: 2, context: 'playRequest', signal }
    );

    if (!playResp || !playResp.CdnUrl) {
      log(`CDN URL alınamadı (Action: ${playResp?.Action}, Message: ${playResp?.Message})`);
      return [];
    }

    let cdnUrl = playResp.CdnUrl;

    // Switch/redirect URL
    if (!cdnUrl.includes('.mpd')) {
      try {
        log(`  Switch URL tespit edildi, takip ediliyor...`);
        const switchResp = await gmFetchWithTimeout(cdnUrl, { signal }, TIMING.GM_FETCH_TIMEOUT);
        const finalUrl = switchResp.url;

        if (finalUrl && finalUrl.includes('.mpd')) {
          cdnUrl = finalUrl;
        } else {
          const body = switchResp.responseText || '';
          const mpdMatch = body.match(/(https?:\/\/[^\s"'<>]+\.mpd[^\s"'<>]*)/i);
          if (mpdMatch) {
            cdnUrl = mpdMatch[1];
          } else {
            log(`  MPD URL bulunamadı. Status: ${switchResp.status}`);
            return [];
          }
        }
      } catch (e) {
        log(`  Switch URL hatası: ${e.message}`);
        return [];
      }
    }

    // MPD indir ve parse et
    try {
      const mpdResp = await gmFetchWithTimeout(cdnUrl, { signal }, TIMING.GM_FETCH_TIMEOUT);
      const mpdText = mpdResp.responseText;

      if (!mpdText.includes('<MPD') && !mpdText.includes('<mpd')) {
        log(`  Beklenmeyen MPD içeriği: ${mpdText.substring(0, 200)}`);
        return [];
      }

      return parseMPD(mpdText, cdnUrl);
    } catch (e) {
      log(`  MPD indirme hatası: ${e.message}`);
      return [];
    }
  }

  async function loadSeasonEpisodes(seasonIdx) {
    if (!AppState.seasonsData || !AppState.seasonsData[seasonIdx]) return false;
    const season = AppState.seasonsData[seasonIdx];

    // Cache kontrolü
    const cacheKey = `${AppState.seriesName}.season_${seasonIdx}_${season.no}`;
    const cached = Cache.get(cacheKey);
    if (cached) {
      AppState.seasonsData[seasonIdx] = cached;
      log(`  ${cached.episodes?.length || 0} bölüm yüklendi (cache)`);
      return true;
    }

    try {
      let seasonSlug = season.customData?.slug || season.slug || '';

      if (!seasonSlug) {
        const pathMatch = location.pathname.match(/^(\/[^/]+\/[^/]+)\//);
        const basePath = pathMatch ? pathMatch[1] : location.pathname.replace(/\/$/, '');
        seasonSlug = `${basePath}/${season.no}sezon-v${season.id || ''}`;

        const seasonLink = document.querySelector(
          `a[href*="${season.no}sezon"], a[href*="season${season.no}"], ` +
          `a[href*="${season.no}-sezon"], [data-season-no="${season.no}"] a`
        );
        if (seasonLink) seasonSlug = seasonLink.getAttribute('href') || seasonSlug;
      }

      if (!seasonSlug) {
        log(`  Sezon slug bulunamadı`);
        return false;
      }

      log(`  Sezon sayfası yükleniyor: ${seasonSlug}`);
      const url = seasonSlug.startsWith('http') ? seasonSlug : `${API.BASE_URL}${seasonSlug}`;
      const resp = await fetchWithTimeout(url, { credentials: 'include' }, TIMING.FETCH_TIMEOUT);
      const html = await resp.text();

      // Yöntem 1: var seasons JSON
      const seasonsMatch = html.match(/var\s+seasons\s*=\s*(\[[\s\S]*?\]);/);
      if (seasonsMatch) {
        try {
          const allSeasons = JSON.parse(seasonsMatch[1]);
          const targetSeason = allSeasons.find(s => s.no === season.no) || allSeasons[0];
          if (targetSeason && Array.isArray(targetSeason.episodes)) {
            AppState.seasonsData[seasonIdx] = targetSeason;
            Cache.set(cacheKey, targetSeason);
            log(`  ${targetSeason.episodes.length} bölüm yüklendi (JS)`);
            return true;
          }
        } catch(e) {}
      }

      // Yöntem 2: HTML'den bölüm linkleri
      const htmlParser = new DOMParser();
      const doc = htmlParser.parseFromString(html, 'text/html');
      const epLinks = doc.querySelectorAll(
        'a[data-content-type="Episode"], a[href*="sezon"][href*="/"], ' +
        'a.episode-item, [class*="episode"] a[href]'
      );

      const episodes = [];
      epLinks.forEach(link => {
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
        AppState.seasonsData[seasonIdx].episodes = episodes;
        Cache.set(cacheKey, AppState.seasonsData[seasonIdx]);
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

  // ============================================================
  // SECTION 10: DOWNLOAD ENGINE
  // ============================================================

  async function downloadSubtitle(track, format) {
    const fmt = format || Settings.get('defaultFormat') || 'srt';
    try {
      const resp = await fetchWithTimeout(track.url, {}, TIMING.FETCH_TIMEOUT);
      let text = await resp.text();
      if (fmt === 'srt') text = vttToSrt(text);

      const parts = [AppState.seriesName];
      if (AppState.currentEpLabel) parts.push(AppState.currentEpLabel);
      parts.push(getLangSafe(track.lang));
      const filename = parts.join('.') + '.' + fmt;

      const blob = new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);

      // Geçmişe kaydet
      const historyKey = `${AppState.seriesName}.${AppState.currentEpLabel || 'unknown'}.${track.lang}.${fmt}`;
      DownloadHistory.mark(historyKey);

      log(`İndirildi: ${filename}`);
      showToast(`İndirildi: ${filename}`, 'success');
    } catch (e) {
      log(`İndirme hatası: ${e.message}`);
      showToast(`İndirme hatası: ${e.message}`, 'error');
    }
  }

  async function downloadCurrentZip() {
    if (AppState.currentTracks.length === 0) return;
    const zip = new JSZip();
    const fmt = Settings.get('defaultFormat') || 'srt';

    const parts = [AppState.seriesName];
    if (AppState.currentEpLabel) parts.push(AppState.currentEpLabel);
    const prefix = parts.join('.');

    for (const track of AppState.currentTracks) {
      try {
        const resp = await fetchWithTimeout(track.url, {}, TIMING.FETCH_TIMEOUT);
        const vtt = await resp.text();
        const content = fmt === 'srt' ? vttToSrt(vtt) : vtt;
        zip.file(`${prefix}.${getLangSafe(track.lang)}.${fmt}`, '\ufeff' + content);
      } catch (e) {
        log(`Hata (${track.lang}): ${e.message}`);
      }
    }

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `${prefix}.${fmt}.zip`);
    showToast(`ZIP indirildi: ${prefix}.${fmt}.zip`, 'success');
  }

  async function batchDownloadSeason(seasonIdx, filterLang) {
    if (AppState.isProcessing) {
      showToast('Zaten bir indirme işlemi devam ediyor', 'info');
      return;
    }
    if (!AppState.seasonsData || !AppState.seasonsData[seasonIdx]) return;

    AppState.isProcessing = true;
    AppState.batchAbortController = new AbortController();
    const signal = AppState.batchAbortController.signal;
    EventBus.emit('processing:changed', true);

    const season = AppState.seasonsData[seasonIdx];
    const episodes = Array.isArray(season.episodes) ? season.episodes : [];
    if (episodes.length === 0) {
      log(`${season.title} bölüm listesi boş`);
      showToast('Bölüm listesi boş veya yüklenemedi', 'error');
      AppState.isProcessing = false;
      AppState.batchAbortController = null;
      EventBus.emit('processing:changed', false);
      return;
    }

    const zip = new JSZip();
    let downloaded = 0, failed = 0, skipped = 0;
    const startTime = Date.now();
    const fmt = Settings.get('defaultFormat') || 'srt';
    const rateLimitDelay = Settings.get('rateLimitDelay') || TIMING.RATE_LIMIT_DELAY;

    // Resume desteği
    const resumeKey = `${AppState.seriesName}.batchResume_S${season.no}_${filterLang || 'all'}`;
    const resumeFrom = Storage.get(resumeKey, 0);
    if (resumeFrom > 0) {
      log(`Önceki indirmeden devam ediliyor: bölüm ${resumeFrom + 1}`);
      showToast(`Bölüm ${resumeFrom + 1}'den devam ediliyor`, 'info');
    }

    EventBus.emit('progress:updated', { pct: 0, text: 'Başlıyor...', show: true, current: resumeFrom, total: episodes.length });
    log(`${season.title} indirme başlıyor (${episodes.length} bölüm, bölüm ${resumeFrom + 1}'den)...`);

    for (let i = resumeFrom; i < episodes.length; i++) {
      // İptal kontrolü
      if (signal.aborted) {
        Storage.set(resumeKey, i);
        log(`İndirme iptal edildi. Bölüm ${i + 1}'den devam edilebilir.`);
        showToast(`İptal edildi. Bir dahaki sefere bölüm ${i + 1}'den devam edilecek.`, 'info');
        break;
      }

      const ep = episodes[i];
      const epNum = String(ep.no).padStart(2, '0');
      const epLabel = `S${String(season.no).padStart(2, '0')}E${epNum}`;

      // Duplicate kontrolü
      const historyKey = `${AppState.seriesName}.${epLabel}.${filterLang || 'all'}.batch`;
      if (DownloadHistory.isDownloaded(historyKey)) {
        log(`[${i+1}/${episodes.length}] ${epLabel} — daha önce indirilmiş, atlıyorum`);
        skipped++;
        continue;
      }

      // ETA hesapla
      const doneCount = (i - resumeFrom) - skipped;
      const elapsed = Date.now() - startTime;
      const avgPerEp = doneCount > 0 ? elapsed / doneCount : 0;
      const remaining = (episodes.length - i) * avgPerEp;
      const etaText = doneCount > 0 ? formatETA(remaining) : '';

      EventBus.emit('progress:updated', {
        pct: ((i - resumeFrom) / (episodes.length - resumeFrom)) * 100,
        text: `${i+1}/${episodes.length} ${etaText}`,
        show: true,
        current: i + 1,
        total: episodes.length,
      });

      log(`[${i+1}/${episodes.length}] ${epLabel} — ${ep.title}`);

      try {
        const slug = ep.customData?.slug;
        if (!slug) {
          log(`  Slug yok, atlıyorum`);
          failed++;
          continue;
        }

        const asset = await fetchEpisodeAsset(slug, signal);
        if (!asset) {
          log(`  Asset bilgisi bulunamadı`);
          failed++;
          continue;
        }

        const tracks = await getSubtitlesForEpisode(asset, signal);
        if (tracks.length === 0) {
          log(`  Altyazı bulunamadı`);
          failed++;
          continue;
        }

        const targetTracks = filterLang ? tracks.filter(t => t.lang === filterLang) : tracks;

        for (const track of targetTracks) {
          try {
            const resp = await gmFetchWithTimeout(track.url, { signal }, TIMING.GM_FETCH_TIMEOUT);
            const vttText = resp.responseText;
            const content = fmt === 'srt' ? vttToSrt(vttText) : vttText;
            const filename = `${AppState.seriesName}.${epLabel}.${getLangSafe(track.lang)}.${fmt}`;
            zip.file(filename, '\ufeff' + content);
            downloaded++;
            log(`  ✓ ${getLangName(track.lang)}`);
          } catch (e) {
            log(`  ✗ ${getLangName(track.lang)}: ${e.message}`);
          }
        }

        // Bu bölümü geçmişe kaydet
        DownloadHistory.mark(historyKey);

      } catch (e) {
        if (signal.aborted) break;
        log(`  ✗ Hata: ${e.message}`);
        failed++;
      }

      if (i < episodes.length - 1 && !signal.aborted) {
        await sleep(rateLimitDelay);
      }
    }

    // ZIP oluştur
    if (downloaded > 0 && !signal.aborted) {
      EventBus.emit('progress:updated', { pct: 100, text: 'ZIP oluşturuluyor...', show: true, current: episodes.length, total: episodes.length });
      log(`ZIP oluşturuluyor (${downloaded} altyazı)...`);

      const langSuffix = filterLang ? `.${getLangSafe(filterLang)}` : '.All.Languages';
      const zipName = `${AppState.seriesName}.${season.title.replace(/\s+/g, '')}${langSuffix}.${fmt}.zip`;

      try {
        const zipContent = await zip.generateAsync({ type: 'blob' });
        saveAs(zipContent, zipName);
        log(`✓ İndirme tamamlandı: ${zipName}`);
        log(`  ${downloaded} başarılı, ${failed} başarısız, ${skipped} atlanmış`);
        showToast(`${zipName} indirildi (${downloaded} altyazı)`, 'success');

        // Başarılıysa resume noktasını temizle
        Storage.remove(resumeKey);
      } catch (e) {
        log(`ZIP hatası: ${e.message}`);
        showToast(`ZIP oluşturma hatası: ${e.message}`, 'error');
      }
    } else if (downloaded === 0 && !signal.aborted) {
      log('Hiç altyazı indirilemedi');
      showToast('Hiç altyazı indirilemedi', 'error');
    }

    AppState.isProcessing = false;
    AppState.batchAbortController = null;
    EventBus.emit('processing:changed', false);
    EventBus.emit('progress:updated', { pct: 0, text: '', show: false, current: 0, total: 0 });
    createMenu();
  }

  // --- Tüm Sezonları Toplu İndir (BETA) ---
  async function batchDownloadAllSeasons(filterLang) {
    if (AppState.isProcessing) {
      showToast('Zaten bir indirme işlemi devam ediyor', 'info');
      return;
    }
    if (!AppState.seasonsData || AppState.seasonsData.length === 0) return;

    AppState.isProcessing = true;
    AppState.batchAbortController = new AbortController();
    const signal = AppState.batchAbortController.signal;
    EventBus.emit('processing:changed', true);

    const zip = new JSZip();
    let downloaded = 0, failed = 0, skipped = 0;
    const startTime = Date.now();
    const fmt = Settings.get('defaultFormat') || 'srt';
    const rateLimitDelay = Settings.get('rateLimitDelay') || TIMING.RATE_LIMIT_DELAY;

    // Toplam bölüm sayısını hesapla (yükleme sonrası)
    const totalEpisodes = AppState.seasonsData.reduce((sum, s) => {
      return sum + (Array.isArray(s.episodes) ? s.episodes.length : 0);
    }, 0);

    if (totalEpisodes === 0) {
      log('Hiçbir sezonda bölüm bulunamadı');
      showToast('Bölüm listesi boş', 'error');
      AppState.isProcessing = false;
      AppState.batchAbortController = null;
      EventBus.emit('processing:changed', false);
      return;
    }

    // Resume desteği — sezon ve bölüm indeksi kaydet
    const resumeKey = `${AppState.seriesName}.batchResume_AllSeasons_${filterLang || 'all'}`;
    const resumeData = Storage.get(resumeKey, { seasonIdx: 0, episodeIdx: 0 });
    const resumeSeasonIdx = resumeData.seasonIdx || 0;
    const resumeEpisodeIdx = resumeData.episodeIdx || 0;

    if (resumeSeasonIdx > 0 || resumeEpisodeIdx > 0) {
      log(`Önceki indirmeden devam: Sezon ${resumeSeasonIdx + 1}, Bölüm ${resumeEpisodeIdx + 1}`);
      showToast(`S${resumeSeasonIdx + 1} B${resumeEpisodeIdx + 1}'den devam ediliyor`, 'info');
    }

    let globalCurrent = 0;
    // Resume'dan önceki bölümleri atla (sayaç için)
    for (let si = 0; si < resumeSeasonIdx; si++) {
      const eps = AppState.seasonsData[si]?.episodes;
      if (Array.isArray(eps)) globalCurrent += eps.length;
    }
    globalCurrent += resumeEpisodeIdx;

    EventBus.emit('progress:updated', { pct: 0, text: 'Tüm sezonlar başlıyor...', show: true, current: globalCurrent, total: totalEpisodes });
    log(`Tüm sezonlar indirme başlıyor (${AppState.seasonsData.length} sezon, ${totalEpisodes} bölüm)...`);

    for (let sIdx = resumeSeasonIdx; sIdx < AppState.seasonsData.length; sIdx++) {
      if (signal.aborted) break;

      const season = AppState.seasonsData[sIdx];
      const episodes = Array.isArray(season.episodes) ? season.episodes : [];

      if (episodes.length === 0) {
        log(`${season.title} — bölüm yok, atlıyorum`);
        continue;
      }

      log(`\n--- ${season.title} (${episodes.length} bölüm) ---`);
      const startEp = (sIdx === resumeSeasonIdx) ? resumeEpisodeIdx : 0;

      for (let eIdx = startEp; eIdx < episodes.length; eIdx++) {
        if (signal.aborted) {
          Storage.set(resumeKey, { seasonIdx: sIdx, episodeIdx: eIdx });
          log(`İptal edildi. S${sIdx + 1}B${eIdx + 1}'den devam edilebilir.`);
          showToast(`İptal edildi. Bir dahaki sefere devam edilecek.`, 'info');
          break;
        }

        globalCurrent++;
        const ep = episodes[eIdx];
        const epNum = String(ep.no).padStart(2, '0');
        const epLabel = `S${String(season.no).padStart(2, '0')}E${epNum}`;

        // Duplicate kontrolü
        const historyKey = `${AppState.seriesName}.${epLabel}.${filterLang || 'all'}.allseasons`;
        if (DownloadHistory.isDownloaded(historyKey)) {
          log(`[${globalCurrent}/${totalEpisodes}] ${epLabel} — daha önce indirilmiş, atlıyorum`);
          skipped++;
          continue;
        }

        // ETA hesapla
        const doneCount = globalCurrent - skipped;
        const elapsed = Date.now() - startTime;
        const avgPerEp = doneCount > 0 ? elapsed / doneCount : 0;
        const remaining = (totalEpisodes - globalCurrent) * avgPerEp;
        const etaText = doneCount > 0 ? formatETA(remaining) : '';

        EventBus.emit('progress:updated', {
          pct: (globalCurrent / totalEpisodes) * 100,
          text: `${season.title} ${eIdx + 1}/${episodes.length} — ${globalCurrent}/${totalEpisodes} ${etaText}`,
          show: true,
          current: globalCurrent,
          total: totalEpisodes,
        });

        log(`[${globalCurrent}/${totalEpisodes}] ${epLabel} — ${ep.title}`);

        try {
          const slug = ep.customData?.slug;
          if (!slug) {
            log(`  Slug yok, atlıyorum`);
            failed++;
            continue;
          }

          const asset = await fetchEpisodeAsset(slug, signal);
          if (!asset) {
            log(`  Asset bilgisi bulunamadı`);
            failed++;
            continue;
          }

          const tracks = await getSubtitlesForEpisode(asset, signal);
          if (tracks.length === 0) {
            log(`  Altyazı bulunamadı`);
            failed++;
            continue;
          }

          const targetTracks = filterLang ? tracks.filter(t => t.lang === filterLang) : tracks;

          for (const track of targetTracks) {
            try {
              const resp = await gmFetchWithTimeout(track.url, { signal }, TIMING.GM_FETCH_TIMEOUT);
              const vttText = resp.responseText;
              const content = fmt === 'srt' ? vttToSrt(vttText) : vttText;
              const filename = `${AppState.seriesName}.${epLabel}.${getLangSafe(track.lang)}.${fmt}`;
              zip.file(filename, '\ufeff' + content);
              downloaded++;
              log(`  ✓ ${getLangName(track.lang)}`);
            } catch (e) {
              log(`  ✗ ${getLangName(track.lang)}: ${e.message}`);
            }
          }

          DownloadHistory.mark(historyKey);

        } catch (e) {
          if (signal.aborted) break;
          log(`  ✗ Hata: ${e.message}`);
          failed++;
        }

        if (!signal.aborted) {
          await sleep(rateLimitDelay);
        }
      }

      if (signal.aborted) break;
    }

    // ZIP oluştur
    if (downloaded > 0 && !signal.aborted) {
      EventBus.emit('progress:updated', { pct: 100, text: 'ZIP oluşturuluyor...', show: true, current: totalEpisodes, total: totalEpisodes });
      log(`\nZIP oluşturuluyor (${downloaded} altyazı)...`);

      const langSuffix = filterLang ? `.${getLangSafe(filterLang)}` : '.All.Languages';
      const zipName = `${AppState.seriesName}.AllSeasons${langSuffix}.${fmt}.zip`;

      try {
        const zipContent = await zip.generateAsync({ type: 'blob' });
        saveAs(zipContent, zipName);
        log(`✓ İndirme tamamlandı: ${zipName}`);
        log(`  ${downloaded} başarılı, ${failed} başarısız, ${skipped} atlanmış`);
        showToast(`${zipName} indirildi (${downloaded} altyazı)`, 'success');

        Storage.remove(resumeKey);
      } catch (e) {
        log(`ZIP hatası: ${e.message}`);
        showToast(`ZIP oluşturma hatası: ${e.message}`, 'error');
      }
    } else if (downloaded === 0 && !signal.aborted) {
      log('Hiç altyazı indirilemedi');
      showToast('Hiç altyazı indirilemedi', 'error');
    }

    AppState.isProcessing = false;
    AppState.batchAbortController = null;
    EventBus.emit('processing:changed', false);
    EventBus.emit('progress:updated', { pct: 0, text: '', show: false, current: 0, total: 0 });
    createMenu();
  }

  // ============================================================
  // SECTION 11: UI COMPONENTS
  // ============================================================

  function log(msg) {
    console.log(`[TOD-SD] ${msg}`);
    if (AppState.logEl) {
      AppState.logEl.style.display = 'block';
      AppState.logEl.textContent += msg + '\n';
      AppState.logEl.scrollTop = AppState.logEl.scrollHeight;
    }
  }

  function showToast(message, type = 'info') {
    let container = document.querySelector('.sd-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'sd-toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `sd-toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, TIMING.TOAST_DURATION);
  }

  function applyTheme(container) {
    const theme = Settings.get('theme') || 'dark';
    container.classList.remove('sd-light');
    if (theme === 'light') {
      container.classList.add('sd-light');
    } else if (theme === 'auto') {
      if (window.matchMedia?.('(prefers-color-scheme: light)').matches) {
        container.classList.add('sd-light');
      }
    }
  }

  function createSettingsPanel(parent) {
    const panel = document.createElement('div');
    panel.className = 'sd-settings';

    // Dil
    const langLabel = document.createElement('label');
    langLabel.innerHTML = '<span>Varsayılan Dil</span>';
    const langSelect = document.createElement('select');
    langSelect.innerHTML = '<option value="">Otomatik</option>';
    ['tr', 'en', 'ar', 'de', 'fr', 'es'].forEach(code => {
      langSelect.innerHTML += `<option value="${code}" ${Settings.get('defaultLanguage') === code ? 'selected' : ''}>${getLangName(code)}</option>`;
    });
    langSelect.addEventListener('change', () => Settings.set('defaultLanguage', langSelect.value));
    langLabel.appendChild(langSelect);
    panel.appendChild(langLabel);

    // Format
    const fmtLabel = document.createElement('label');
    fmtLabel.innerHTML = '<span>Varsayılan Format</span>';
    const fmtSelect = document.createElement('select');
    ['srt', 'vtt'].forEach(fmt => {
      fmtSelect.innerHTML += `<option value="${fmt}" ${Settings.get('defaultFormat') === fmt ? 'selected' : ''}>${fmt.toUpperCase()}</option>`;
    });
    fmtSelect.addEventListener('change', () => Settings.set('defaultFormat', fmtSelect.value));
    fmtLabel.appendChild(fmtSelect);
    panel.appendChild(fmtLabel);

    // Rate limit
    const rateLabel = document.createElement('label');
    rateLabel.innerHTML = '<span>İstek Arası Bekleme (ms)</span>';
    const rateInput = document.createElement('input');
    rateInput.type = 'number';
    rateInput.min = '100'; rateInput.max = '5000'; rateInput.step = '100';
    rateInput.value = Settings.get('rateLimitDelay');
    rateInput.addEventListener('change', () => Settings.set('rateLimitDelay', parseInt(rateInput.value) || TIMING.RATE_LIMIT_DELAY));
    rateLabel.appendChild(rateInput);
    panel.appendChild(rateLabel);

    // Tema
    const themeLabel = document.createElement('label');
    themeLabel.innerHTML = '<span>Tema</span>';
    const themeSelect = document.createElement('select');
    [['dark', 'Koyu'], ['light', 'Açık'], ['auto', 'Otomatik']].forEach(([val, text]) => {
      themeSelect.innerHTML += `<option value="${val}" ${Settings.get('theme') === val ? 'selected' : ''}>${text}</option>`;
    });
    themeSelect.addEventListener('change', () => {
      Settings.set('theme', themeSelect.value);
      applyTheme(document.getElementById(MENU_ID));
    });
    themeLabel.appendChild(themeSelect);
    panel.appendChild(themeLabel);

    // Auto-download
    const autoLabel = document.createElement('label');
    autoLabel.innerHTML = '<span>Oynatınca Otomatik İndir</span>';
    const autoCheck = document.createElement('input');
    autoCheck.type = 'checkbox';
    autoCheck.checked = Settings.get('autoDownloadOnPlay');
    autoCheck.addEventListener('change', () => Settings.set('autoDownloadOnPlay', autoCheck.checked));
    autoLabel.appendChild(autoCheck);
    panel.appendChild(autoLabel);

    // Ayırıcı
    panel.appendChild(Object.assign(document.createElement('hr'), { className: 'sd-settings-sep' }));

    // Export
    const expBtn = document.createElement('button');
    expBtn.className = 'sd-settings-btn';
    expBtn.textContent = 'Ayarları Dışa Aktar';
    expBtn.addEventListener('click', () => {
      const data = Settings.exportAll();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'tod-sd-settings.json';
      a.click(); URL.revokeObjectURL(url);
      showToast('Ayarlar dışa aktarıldı', 'success');
    });
    panel.appendChild(expBtn);

    // Import
    const impBtn = document.createElement('button');
    impBtn.className = 'sd-settings-btn';
    impBtn.textContent = 'Ayarları İçe Aktar';
    impBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.json';
      input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          if (Settings.importAll(reader.result)) {
            showToast('Ayarlar içe aktarıldı', 'success');
            createMenu();
          } else {
            showToast('Geçersiz ayar dosyası', 'error');
          }
        };
        reader.readAsText(file);
      });
      input.click();
    });
    panel.appendChild(impBtn);

    // Cache temizle
    const cacheClearBtn = document.createElement('button');
    cacheClearBtn.className = 'sd-settings-btn';
    cacheClearBtn.textContent = 'Önbelleği Temizle';
    cacheClearBtn.addEventListener('click', () => {
      Cache.clear();
      showToast('Önbellek temizlendi', 'success');
    });
    panel.appendChild(cacheClearBtn);

    // Geçmiş temizle
    const histClearBtn = document.createElement('button');
    histClearBtn.className = 'sd-settings-btn danger';
    histClearBtn.textContent = `İndirme Geçmişini Sil (${DownloadHistory.count()})`;
    histClearBtn.addEventListener('click', () => {
      DownloadHistory.clear();
      showToast('İndirme geçmişi silindi', 'success');
      histClearBtn.textContent = 'İndirme Geçmişini Sil (0)';
    });
    panel.appendChild(histClearBtn);

    // Versiyon
    const verInfo = document.createElement('div');
    verInfo.style.cssText = 'color: #555; font-size: 10px; text-align: center; padding: 8px 0 0;';
    verInfo.textContent = `TOD Subtitle Downloader v${VERSION}`;
    panel.appendChild(verInfo);

    parent.appendChild(panel);
    return panel;
  }

  function createMenu(opts) {
    const existing = document.getElementById(MENU_ID);
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = MENU_ID;
    applyTheme(container);

    // Ana buton
    const btn = document.createElement('button');
    btn.className = 'sd-btn';
    if (AppState.isProcessing) btn.classList.add('loading');
    const trackCount = AppState.currentTracks.length;
    btn.innerHTML = `🔤 Altyazı İndir${trackCount > 0 ? ` <span class="sd-badge">${trackCount}</span>` : ''}`;

    const dd = document.createElement('div');
    dd.className = 'sd-dropdown';

    // Header
    const header = document.createElement('div');
    header.className = 'sd-header';
    const headerTitle = document.createElement('span');
    headerTitle.className = 'sd-header-title';
    headerTitle.textContent = `v${VERSION}`;
    const headerActions = document.createElement('div');
    headerActions.className = 'sd-header-actions';

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'sd-icon-btn';
    settingsBtn.textContent = '⚙';
    settingsBtn.title = 'Ayarlar';
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const settingsPanel = dd.querySelector('.sd-settings');
      const mainContent = dd.querySelector('.sd-main-content');
      if (settingsPanel && mainContent) {
        AppState.settingsOpen = !AppState.settingsOpen;
        settingsPanel.classList.toggle('open', AppState.settingsOpen);
        mainContent.style.display = AppState.settingsOpen ? 'none' : 'block';
        settingsBtn.textContent = AppState.settingsOpen ? '✕' : '⚙';
      }
    });
    headerActions.appendChild(settingsBtn);
    header.appendChild(headerTitle);
    header.appendChild(headerActions);
    dd.appendChild(header);

    // Settings panel
    const settingsPanel = createSettingsPanel(dd);
    if (AppState.settingsOpen) settingsPanel.classList.add('open');

    // Main content wrapper
    const mainContent = document.createElement('div');
    mainContent.className = 'sd-main-content';
    if (AppState.settingsOpen) mainContent.style.display = 'none';

    // Progress bar
    const progress = document.createElement('div');
    progress.className = 'sd-progress';
    const pbar = document.createElement('div');
    pbar.className = 'sd-progress-bar';
    progress.appendChild(pbar);
    mainContent.appendChild(progress);

    // Progress text
    const progressText = document.createElement('div');
    progressText.className = 'sd-progress-text';
    mainContent.appendChild(progressText);

    // İptal butonu (sadece işlem sırasında)
    if (AppState.isProcessing) {
      const cancelDiv = document.createElement('div');
      cancelDiv.className = 'sd-cancel';
      cancelDiv.textContent = '⛔ İndirmeyi İptal Et';
      cancelDiv.addEventListener('click', () => {
        AppState.batchAbortController?.abort();
        showToast('İptal ediliyor...', 'info');
      });
      mainContent.appendChild(cancelDiv);
    }

    // Mevcut Bölüm
    const isDisabled = AppState.isProcessing;
    if (AppState.currentTracks.length > 0) {
      addSection(mainContent, `📺 Mevcut Bölüm ${AppState.currentEpLabel ? '(' + AppState.currentEpLabel + ')' : ''}`);

      AppState.currentTracks.forEach(track => {
        const fmt = Settings.get('defaultFormat') || 'srt';
        addItem(mainContent, getLangName(track.lang), fmt.toUpperCase(),
          () => downloadSubtitle(track, fmt), isDisabled);
        // İkincil format
        const altFmt = fmt === 'srt' ? 'vtt' : 'srt';
        addItem(mainContent, getLangName(track.lang), altFmt.toUpperCase(),
          () => downloadSubtitle(track, altFmt), isDisabled);
      });

      if (AppState.currentTracks.length > 1) {
        addAction(mainContent, `📦 Bu Bölümü ZIP`, 'green', () => downloadCurrentZip(), isDisabled);
      }
    } else {
      addStatus(mainContent, 'Video oynatın, altyazılar otomatik yakalanacak...');
    }

    // Sezon Toplu İndirme
    if (AppState.seasonsData && AppState.seasonsData.length > 0) {
      AppState.seasonsData.forEach((season, idx) => {
        const eps = Array.isArray(season.episodes) ? season.episodes : [];
        const epCount = eps.length;

        if (epCount === 0) {
          addSection(mainContent, `📁 ${season.title} — Bölümler yükleniyor...`);
          addAction(mainContent, `🔄 ${season.title} — Bölümleri Yükle`, 'orange',
            async () => {
              log(`${season.title} bölümleri yükleniyor...`);
              const loaded = await loadSeasonEpisodes(idx);
              if (loaded) {
                createMenu({ keepOpen: true });
              } else {
                log('Bölümler yüklenemedi. Bir bölüm sayfasına gidip tekrar deneyin.');
                showToast('Bölümler yüklenemedi', 'error');
              }
            }, isDisabled, true);
        } else {
          addSection(mainContent, `📁 ${season.title} (${epCount} bölüm)`);

          // Resume bilgisi varsa göster
          const resumeKey = `${AppState.seriesName}.batchResume_S${season.no}`;
          ['tr', 'en', null].forEach(lang => {
            const fullResumeKey = `${resumeKey}_${lang || 'all'}`;
            const resumeIdx = Storage.get(fullResumeKey, 0);
            const resumeInfo = resumeIdx > 0 ? ` (devam: ${resumeIdx + 1}. bölüm)` : '';
            const langLabel = lang === 'tr' ? 'Türkçe' : lang === 'en' ? 'English' : 'Tüm Diller';
            const color = lang === null ? 'red' : 'orange';
            addAction(mainContent, `📦 ${langLabel}${resumeInfo}`, color,
              () => batchDownloadSeason(idx, lang), isDisabled);
          });
        }
      });
    } else {
      addInfo(mainContent, 'Sezon bilgisi bulunamadı. Dizinin bölüm sayfasında olduğunuzdan emin olun.');
    }

    // Tüm sezonları indir (BETA)
    if (AppState.seasonsData && AppState.seasonsData.length > 1) {
      const loadedCount = AppState.seasonsData.filter(s => Array.isArray(s.episodes) && s.episodes.length > 0).length;
      const allLoaded = loadedCount === AppState.seasonsData.length;

      if (allLoaded) {
        const totalEps = AppState.seasonsData.reduce((sum, s) => sum + s.episodes.length, 0);
        addSection(mainContent, `🌟 Tüm Sezonlar (${AppState.seasonsData.length} sezon, ${totalEps} bölüm)`);

        ['tr', 'en', null].forEach(lang => {
          const resumeKey = `${AppState.seriesName}.batchResume_AllSeasons_${lang || 'all'}`;
          const resumeData = Storage.get(resumeKey, { seasonIdx: 0, episodeIdx: 0 });
          const hasResume = (resumeData.seasonIdx > 0 || resumeData.episodeIdx > 0);
          const resumeInfo = hasResume ? ` (devam: S${resumeData.seasonIdx + 1}B${resumeData.episodeIdx + 1})` : '';
          const langLabel = lang === 'tr' ? 'Türkçe' : lang === 'en' ? 'English' : 'Tüm Diller';
          const color = lang === null ? 'red' : 'orange';

          const el = document.createElement('div');
          el.className = `sd-action ${color}`;
          if (isDisabled) el.classList.add('disabled');
          el.innerHTML = `🚀 Tüm Sezonlar — ${langLabel}${resumeInfo} <span class="sd-beta-tag">BETA</span>`;
          if (!isDisabled) {
            el.addEventListener('click', () => {
              document.querySelector(`#${MENU_ID} .sd-dropdown`)?.classList.remove('open');
              batchDownloadAllSeasons(lang);
            });
          }
          mainContent.appendChild(el);
        });
      } else {
        addSection(mainContent, `🌟 Tüm Sezonlar`);
        addInfo(mainContent, `Tüm sezonları tek seferde indirmek için önce yukarıdan her sezonun "Bölümleri Yükle" butonuna tıklayın. (${loadedCount}/${AppState.seasonsData.length} sezon yüklü)`);
      }
    }

    // Log alanı
    AppState.logEl = document.createElement('div');
    AppState.logEl.className = 'sd-log';
    mainContent.appendChild(AppState.logEl);

    dd.appendChild(mainContent);

    // Toggle
    btn.addEventListener('click', () => dd.classList.toggle('open'));
    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) dd.classList.remove('open');
    });

    // Menü yeniden oluşturulurken açık kalsın
    if (opts?.keepOpen) {
      dd.classList.add('open');
    }

    container.appendChild(btn);
    container.appendChild(dd);
    document.body.appendChild(container);
  }

  function addSection(parent, text) {
    const el = document.createElement('div');
    el.className = 'sd-section'; el.textContent = text;
    parent.appendChild(el);
  }

  function addItem(parent, label, format, onClick, disabled) {
    const el = document.createElement('div');
    el.className = 'sd-item';
    if (disabled) el.classList.add('disabled');
    el.innerHTML = `<span class="sd-lang">${label}</span><span class="sd-format">${format}</span>`;
    if (!disabled) {
      el.addEventListener('click', () => {
        document.querySelector(`#${MENU_ID} .sd-dropdown`)?.classList.remove('open');
        onClick();
      });
    }
    parent.appendChild(el);
  }

  function addAction(parent, text, color, onClick, disabled, keepOpen) {
    const el = document.createElement('div');
    el.className = `sd-action ${color}`;
    if (disabled) el.classList.add('disabled');
    el.textContent = text;
    if (!disabled) {
      el.addEventListener('click', () => {
        if (!keepOpen) {
          document.querySelector(`#${MENU_ID} .sd-dropdown`)?.classList.remove('open');
        }
        onClick();
      });
    }
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

  // EventBus UI listeners
  EventBus.on('processing:changed', (isProcessing) => {
    const mainBtn = document.querySelector(`#${MENU_ID} .sd-btn`);
    if (mainBtn) {
      mainBtn.classList.toggle('loading', isProcessing);
      if (!isProcessing) {
        // İşlem bitti — butonu eski haline döndür
        const trackCount = AppState.currentTracks.length;
        mainBtn.innerHTML = `🔤 Altyazı İndir${trackCount > 0 ? ` <span class="sd-badge">${trackCount}</span>` : ''}`;
      }
    }
  });

  EventBus.on('progress:updated', ({ pct, text, show, current, total }) => {
    const bar = document.querySelector(`#${MENU_ID} .sd-progress-bar`);
    const container = document.querySelector(`#${MENU_ID} .sd-progress`);
    const textEl = document.querySelector(`#${MENU_ID} .sd-progress-text`);
    if (bar) bar.style.width = pct + '%';
    if (container) container.style.display = show ? 'block' : 'none';
    if (textEl) {
      textEl.style.display = (show && text) ? 'block' : 'none';
      textEl.textContent = text || '';
    }

    // Ana buton üzerinde ilerleme bilgisi göster
    const mainBtn = document.querySelector(`#${MENU_ID} .sd-btn`);
    if (mainBtn && show && total > 0) {
      mainBtn.innerHTML = `🔤 <span class="sd-badge sd-badge-progress">${current}/${total}</span>`;
    }
  });

  // ============================================================
  // SECTION 12: NETWORK INTERCEPTOR
  // ============================================================

  function injectInterceptor() {
    if (AppState.interceptorInjected) return;
    try {
      if (unsafeWindow._tod_sd_interceptor_active) {
        AppState.interceptorInjected = true;
        return;
      }
    } catch(e) {}

    const script = document.createElement('script');
    script.textContent = `(function() {
      if (window._tod_sd_interceptor_active) return;
      window._tod_sd_interceptor_active = true;

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
    AppState.interceptorInjected = true;
  }

  // MPD yakalandığında
  window.addEventListener('tod_sd_mpd', function(e) {
    const { url, content } = e.detail;
    const tracks = parseMPD(content, url);
    if (tracks.length > 0) {
      AppState.currentTracks = tracks;
      AppState.currentTitle = detectEpisodeTitle();
      log(`${tracks.length} altyazı yakalandı (${AppState.currentTitle})`);

      // Auto-download
      if (Settings.get('autoDownloadOnPlay') && tracks.length > 0) {
        const preferredLang = Settings.get('defaultLanguage');
        const fmt = Settings.get('defaultFormat') || 'srt';
        const target = preferredLang ? tracks.find(t => t.lang === preferredLang) : tracks[0];
        if (target) {
          downloadSubtitle(target, fmt);
          log(`Otomatik indirme: ${getLangName(target.lang)} (${fmt})`);
        }
      }

      createMenu();
    }
  });

  // ============================================================
  // SECTION 13: INITIALIZATION & SPA NAVIGATION
  // ============================================================

  function init() {
    // Settings ve geçmişi yükle
    Settings.load();
    DownloadHistory.load();

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

    // Klavye kısayolu: Alt+S
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const dd = document.querySelector(`#${MENU_ID} .sd-dropdown`);
        dd?.classList.toggle('open');
      }
    });

    console.log(`[TOD-SD] v${VERSION} yüklendi | URL: ${location.pathname} | Dizi: ${AppState.seriesName} | Sezon: ${AppState.seasonsData ? AppState.seasonsData.length : 0}`);
  }

  // DOM hazır olunca başlat
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Gecikmeli yeniden deneme (SPA/lazy-load)
  setTimeout(() => {
    if (!AppState.seasonsData || AppState.seasonsData.length === 0) {
      log('Gecikmeli sezon verisi denemesi...');
      extractSeasonsData();
      extractSeriesName();
      createMenu();
    }
  }, TIMING.LAZY_RETRY_DELAY);

  // SPA navigasyonlarını izle (debounce ile)
  let lastURL = location.href;
  const handleSPANavigation = debounce(() => {
    if (location.href !== lastURL) {
      lastURL = location.href;

      // İşlem sırasında track'leri sıfırlama (race condition fix)
      if (!AppState.isProcessing) {
        AppState.currentTracks = [];
        AppState.currentTitle = '';
      }

      AppState.seasonsData = null;
      AppState.settingsOpen = false;

      setTimeout(() => {
        extractSeasonsData();
        extractSeriesName();
        detectCurrentEpLabel();
        createMenu();
      }, TIMING.SPA_REINIT_DELAY);
    }
  }, TIMING.DEBOUNCE_SPA);

  new MutationObserver(handleSPANavigation).observe(document.body, { childList: true, subtree: true });

})();
