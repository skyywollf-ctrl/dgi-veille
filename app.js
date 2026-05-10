// ============================================================
// DGI VEILLE — app.js
// Logique métier : fetch APIs, cache, comparaison snapshots, rendering
// ============================================================

import { DEFAULT_STOCKS } from './data/stocks.js';
import { ASIA_COMPANIES, ASIA_WARNINGS } from './data/asia.js';

// ============================================================
// CONSTANTES
// ============================================================

const STORAGE_KEYS = {
  STOCKS: 'dgi.stocks',           // liste actions US/perso
  ASIA_PERSO: 'dgi.asiaPerso',    // tickers asie perso
  FINNHUB_KEY: 'dgi.finnhubKey',
  CLAUDE_KEY: 'dgi.claudeKey',
  TRANSLATE: 'dgi.translate',
  CURRENT_SNAPSHOT: 'dgi.snapshot.current',
  HISTORY: 'dgi.snapshot.history',  // 6 derniers snapshots
  LAST_ANALYSIS: 'dgi.lastAnalysisTs'
};

const MAX_HISTORY = 6;

// Liste de proxies CORS avec fallback
const CORS_PROXIES = [
  url => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
];

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// ============================================================
// ÉTAT GLOBAL
// ============================================================

let state = {
  stocks: [],         // [{ticker, name, sector, type}]
  asiaPerso: [],      // [{ticker}]
  finnhubKey: '',
  claudeKey: '',
  translateEnabled: true,
  lastAnalysisTs: null,
  currentSnapshot: null,    // {timestamp, data: {ticker: {...}}, asiaMacro: {...}}
  previousSnapshot: null,   // pour comparaison
  isRefreshing: false
};

// ============================================================
// HELPERS STOCKAGE
// ============================================================

function loadFromStorage() {
  try {
    state.stocks = JSON.parse(localStorage.getItem(STORAGE_KEYS.STOCKS)) || [...DEFAULT_STOCKS];
    state.asiaPerso = JSON.parse(localStorage.getItem(STORAGE_KEYS.ASIA_PERSO)) || [];
    state.finnhubKey = localStorage.getItem(STORAGE_KEYS.FINNHUB_KEY) || '';
    state.claudeKey = localStorage.getItem(STORAGE_KEYS.CLAUDE_KEY) || '';
    const trans = localStorage.getItem(STORAGE_KEYS.TRANSLATE);
    state.translateEnabled = trans === null ? true : trans === 'true';
    state.lastAnalysisTs = localStorage.getItem(STORAGE_KEYS.LAST_ANALYSIS);
    state.currentSnapshot = JSON.parse(localStorage.getItem(STORAGE_KEYS.CURRENT_SNAPSHOT)) || null;

    // Le "previous" pour la comparaison = le tout dernier de l'historique
    const history = JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY)) || [];
    state.previousSnapshot = history.length > 0 ? history[history.length - 1] : null;
  } catch (e) {
    console.error('Erreur chargement localStorage:', e);
  }
}

function saveStocks() {
  localStorage.setItem(STORAGE_KEYS.STOCKS, JSON.stringify(state.stocks));
}

function saveAsiaPerso() {
  localStorage.setItem(STORAGE_KEYS.ASIA_PERSO, JSON.stringify(state.asiaPerso));
}

function saveSnapshot(snapshot) {
  // Archive le snapshot précédent dans l'historique
  if (state.currentSnapshot) {
    const history = JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY)) || [];
    history.push(state.currentSnapshot);
    while (history.length > MAX_HISTORY) history.shift();
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
    state.previousSnapshot = state.currentSnapshot;
  }
  // Le nouveau devient l'actuel
  state.currentSnapshot = snapshot;
  state.lastAnalysisTs = snapshot.timestamp;
  localStorage.setItem(STORAGE_KEYS.CURRENT_SNAPSHOT, JSON.stringify(snapshot));
  localStorage.setItem(STORAGE_KEYS.LAST_ANALYSIS, snapshot.timestamp);
}

// ============================================================
// HELPERS UI
// ============================================================

function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), duration);
}

function formatTimeAgo(ts) {
  if (!ts) return 'Jamais analysé';
  const diff = Date.now() - new Date(ts).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1)   return 'À l\'instant';
  if (min < 60)  return `Il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24)    return `Il y a ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7)     return `Il y a ${d}j`;
  return new Date(ts).toLocaleDateString('fr-FR');
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatCurrency(value, currency = 'USD') {
  if (value == null || isNaN(value)) return '—';
  const symbol = { USD: '$', EUR: '€', HKD: 'HK$', JPY: '¥', KRW: '₩' }[currency] || currency;
  return `${symbol}${Number(value).toFixed(2)}`;
}

function formatPct(value) {
  if (value == null || isNaN(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${Number(value).toFixed(2)}%`;
}

// ============================================================
// FETCH AVEC PROXY CORS (fallback automatique)
// ============================================================

async function fetchWithCorsProxy(url, options = {}) {
  let lastError = null;
  for (const buildProxyUrl of CORS_PROXIES) {
    try {
      const proxiedUrl = buildProxyUrl(url);
      const res = await fetch(proxiedUrl, { ...options, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      lastError = e;
      console.warn(`Proxy CORS échoué, on essaie le suivant:`, e.message);
    }
  }
  throw new Error(`Tous les proxies CORS ont échoué : ${lastError?.message}`);
}

// ============================================================
// YAHOO FINANCE : chart (cours + variation)
// ============================================================

async function fetchYahooChart(ticker, range = '1mo') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}&events=div`;
  const res = await fetchWithCorsProxy(url);
  const data = await res.json();

  if (data?.chart?.error) throw new Error(data.chart.error.description || 'Yahoo error');
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error('Pas de données Yahoo');

  const meta = result.meta || {};
  const closes = result.indicators?.quote?.[0]?.close || [];
  const firstClose = closes.find(v => v != null);
  const lastClose = [...closes].reverse().find(v => v != null) ?? meta.regularMarketPrice;
  const changePct = (firstClose && lastClose) ? ((lastClose - firstClose) / firstClose) * 100 : null;

  // Dividendes du mois
  const divs = result.events?.dividends || {};
  const dividends = Object.values(divs).map(d => ({
    amount: d.amount,
    date: new Date(d.date * 1000).toISOString().slice(0, 10)
  })).sort((a, b) => a.date.localeCompare(b.date));

  return {
    price: lastClose,
    currency: meta.currency || 'USD',
    changePct,
    recentDividends: dividends
  };
}

// ============================================================
// YAHOO FINANCE : quoteSummary (fondamentaux, earnings, divs)
// ============================================================

async function fetchYahooSummary(ticker) {
  const modules = 'summaryDetail,defaultKeyStatistics,calendarEvents,financialData,earnings,summaryProfile';
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}`;
  try {
    const res = await fetchWithCorsProxy(url);
    const data = await res.json();
    const r = data?.quoteSummary?.result?.[0];
    if (!r) return {};

    const sd = r.summaryDetail || {};
    const ce = r.calendarEvents || {};
    const earn = r.earnings || {};
    const profile = r.summaryProfile || {};

    // Prochaine date earnings
    let nextEarningsDate = null;
    if (ce.earnings?.earningsDate?.[0]?.raw) {
      nextEarningsDate = new Date(ce.earnings.earningsDate[0].raw * 1000).toISOString().slice(0, 10);
    }

    // Earnings récent (EPS actual vs estimate)
    let latestEpsActual = null, latestEpsEstimate = null, latestEpsDate = null;
    const earningsHistory = earn.earningsChart?.quarterly || [];
    if (earningsHistory.length > 0) {
      const last = earningsHistory[earningsHistory.length - 1];
      latestEpsActual = last?.actual?.raw ?? null;
      latestEpsEstimate = last?.estimate?.raw ?? null;
      latestEpsDate = last?.date || null;
    }

    return {
      name: profile.longName || profile.shortName,
      sector: profile.sector,
      country: profile.country,
      yield: sd.dividendYield?.raw != null ? sd.dividendYield.raw * 100 : (sd.trailingAnnualDividendYield?.raw != null ? sd.trailingAnnualDividendYield.raw * 100 : null),
      lastDividend: sd.dividendRate?.raw ?? sd.trailingAnnualDividendRate?.raw ?? null,
      exDivDate: sd.exDividendDate?.fmt || null,
      nextEarningsDate,
      latestEps: { actual: latestEpsActual, estimate: latestEpsEstimate, date: latestEpsDate }
    };
  } catch (e) {
    console.warn(`quoteSummary échec pour ${ticker}:`, e.message);
    return {};
  }
}

// ============================================================
// FINNHUB : news par action
// ============================================================

async function fetchFinnhubNews(ticker) {
  if (!state.finnhubKey) return [];

  // Pour les tickers étrangers Yahoo, Finnhub veut le format brut
  // Ex: 0700.HK reste 0700.HK, 7203.T reste 7203.T
  const symbol = ticker;
  const today = new Date();
  const from = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = today.toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${encodeURIComponent(state.finnhubKey)}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
    const news = await res.json();
    if (!Array.isArray(news)) return [];
    return news.slice(0, 30).map(n => ({
      headline: n.headline,
      url: n.url,
      datetime: n.datetime ? new Date(n.datetime * 1000).toISOString().slice(0, 10) : null,
      source: n.source
    }));
  } catch (e) {
    console.warn(`Finnhub news échec pour ${ticker}:`, e.message);
    return [];
  }
}

// ============================================================
// CLAUDE API : analyse par action
// ============================================================

async function fetchYahooIndices() {
  // Récupère variation 1 mois des 3 indices Asie
  const indices = { '^HSI': null, '^N225': null, '^KS11': null };
  await Promise.all(Object.keys(indices).map(async (sym) => {
    try {
      const r = await fetchYahooChart(sym, '1mo');
      indices[sym] = r.changePct;
    } catch (e) {
      console.warn(`Index ${sym} échec:`, e.message);
    }
  }));
  return indices;
}

function parseClaudeJson(text) {
  // Nettoie les éventuels markdown fences
  const cleaned = text.trim()
    .replace(/^```json\s*\n?/i, '')
    .replace(/^```\s*\n?/, '')
    .replace(/\n?```\s*$/, '');
  return JSON.parse(cleaned);
}

async function callClaude(prompt) {
  if (!state.claudeKey) throw new Error('Clé Claude manquante');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': state.claudeKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Claude API HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.content?.find(b => b.type === 'text')?.text || '';
  return parseClaudeJson(text);
}

async function analyzeStockWithClaude(stockData, headlines) {
  const headlinesStr = headlines.length > 0
    ? headlines.map(h => `- [${h.datetime}] ${h.headline} (${h.url})`).join('\n')
    : '(Aucune news disponible)';

  const divHistory = stockData.recentDividends?.length > 0
    ? stockData.recentDividends.map(d => `${d.date}: ${d.amount}`).join(', ')
    : 'Non disponible';

  const earningsStr = stockData.latestEps?.actual != null
    ? `EPS ${stockData.latestEps.actual} vs estimé ${stockData.latestEps.estimate}, date ${stockData.latestEps.date}`
    : 'Pas de earnings récent';

  const prompt = `Tu es un analyste financier qui fait une veille mensuelle pour un investisseur DGI français.

Action : ${stockData.name} (${stockData.ticker})
Pays : ${stockData.country || 'N/A'}
Secteur : ${stockData.sector || 'N/A'}
Cours actuel : ${stockData.price} ${stockData.currency}
Variation 1 mois : ${stockData.changePct?.toFixed(2)}%
Dividende actuel : ${stockData.lastDividend} ${stockData.currency} (${stockData.yield?.toFixed(2)}%)
Historique dividendes récents : ${divHistory}
Earnings récent : ${earningsStr}

News des 30 derniers jours :
${headlinesStr}

Réponds UNIQUEMENT en JSON valide, sans markdown fences, avec cette structure exacte :
{
  "verdict": "positif" | "neutre" | "négatif",
  "resume": "2-3 phrases en français, ton direct sans jargon corporate",
  "hausse_dividende_detectee": true | false,
  "details_hausse": "ancien montant → nouveau montant et %" ou null,
  "news_importantes": [
    {"titre_fr": "...", "titre_vo": "...", "url": "...", "date": "...", "sentiment": "positif|neutre|négatif"}
  ]
}

Sélectionne 3-5 news les plus pertinentes parmi celles fournies (pas les plus récentes, les plus IMPACTANTES pour la thèse d'investissement long terme).`;

  return await callClaude(prompt);
}

async function analyzeAsiaMacro(indices) {
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Tu es analyste macro spécialiste de l'Asie. Tu rédiges un point mensuel pour un investisseur français débutant en marchés asiatiques.

Données indices (variation 1 mois) :
- Hang Seng : ${indices['^HSI']?.toFixed(2) ?? 'N/A'}%
- Nikkei 225 : ${indices['^N225']?.toFixed(2) ?? 'N/A'}%
- KOSPI : ${indices['^KS11']?.toFixed(2) ?? 'N/A'}%

Date du jour : ${today}

Réponds UNIQUEMENT en JSON valide, sans markdown fences :
{
  "chine": {
    "verdict": "positif|neutre|négatif",
    "resume": "3-4 phrases en français : climat éco, politique PBoC, points d'attention",
    "alerte_majeure": "texte si événement critique du mois, sinon null"
  },
  "japon": { "verdict": "...", "resume": "...", "alerte_majeure": null },
  "coree": { "verdict": "...", "resume": "...", "alerte_majeure": null },
  "geopolitique": "2-3 phrases sur tensions/relations qui impactent les 3 marchés"
}

Utilise tes connaissances générales + le contexte des variations d'indices. Sois honnête sur ce que tu ne sais pas (cutoff knowledge).`;

  return await callClaude(prompt);
}

// ============================================================
// REFRESH GÉNÉRAL : orchestre tous les fetchs
// ============================================================

async function processOneStock(stockMeta, progressCb) {
  const ticker = stockMeta.ticker;
  try {
    progressCb(`Analyse ${stockMeta.name || ticker}…`);

    // 1. Yahoo chart (cours + variation + divs)
    const chartData = await fetchYahooChart(ticker);

    // 2. Yahoo summary (fondamentaux)
    const summaryData = await fetchYahooSummary(ticker);

    // 3. Finnhub news
    const news = await fetchFinnhubNews(ticker);

    // Fusion data
    const stockData = {
      ticker,
      name: stockMeta.name || summaryData.name || ticker,
      sector: stockMeta.sector || summaryData.sector,
      country: stockMeta.country || summaryData.country,
      type: stockMeta.type || 'owned',
      price: chartData.price,
      currency: chartData.currency,
      changePct: chartData.changePct,
      recentDividends: chartData.recentDividends,
      yield: summaryData.yield,
      lastDividend: summaryData.lastDividend,
      exDivDate: summaryData.exDivDate,
      nextEarningsDate: summaryData.nextEarningsDate,
      latestEps: summaryData.latestEps,
      rawNews: news
    };

    // 4. Analyse Claude (si clé dispo)
    let analysis = null;
    if (state.claudeKey) {
      try {
        analysis = await analyzeStockWithClaude(stockData, news);
      } catch (e) {
        console.warn(`Claude échec pour ${ticker}:`, e.message);
        analysis = { error: e.message };
      }
    }

    return { ...stockData, analysis, error: null };
  } catch (e) {
    console.error(`Erreur ${ticker}:`, e);
    return {
      ticker,
      name: stockMeta.name || ticker,
      sector: stockMeta.sector,
      type: stockMeta.type,
      error: e.message
    };
  }
}

async function runFullAnalysis() {
  if (state.isRefreshing) return;
  if (!state.claudeKey) {
    showToast('⚠️ Configure ta clé Claude API dans Settings');
    return;
  }
  if (!state.finnhubKey) {
    showToast('⚠️ Configure ta clé Finnhub dans Settings');
    return;
  }

  state.isRefreshing = true;
  const btn = document.getElementById('refreshBtn');
  const progressContainer = document.getElementById('progressContainer');
  const progressBar = document.getElementById('progressBar');
  const progressLabel = document.getElementById('progressLabel');

  btn.disabled = true;
  btn.textContent = '⏳ Analyse en cours…';
  progressContainer.classList.remove('hidden');

  // Tout ce qu'on va analyser : actions US + asie perso + 13 asie préremplies
  const asiaList = ASIA_COMPANIES.map(a => ({ ...a, type: 'asia-discover' }));
  const asiaPersoList = state.asiaPerso.map(t => ({ ticker: t, type: 'asia-perso' }));
  const allItems = [...state.stocks, ...asiaPersoList, ...asiaList];
  const total = allItems.length + 1; // +1 pour macro Asie

  const snapshot = {
    timestamp: new Date().toISOString(),
    data: {},
    asiaMacro: null
  };

  // Analyse chaque action séquentiellement (pour ne pas spammer)
  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    progressBar.style.width = `${(i / total) * 100}%`;
    const result = await processOneStock(item, msg => {
      progressLabel.textContent = `${msg} (${i + 1}/${allItems.length})`;
    });
    snapshot.data[item.ticker] = result;
    // micro-pause pour ne pas saturer Finnhub
    await new Promise(r => setTimeout(r, 250));
  }

  // Macro Asie
  progressLabel.textContent = 'Analyse macro Asie…';
  progressBar.style.width = `${(allItems.length / total) * 100}%`;
  try {
    const indices = await fetchYahooIndices();
    snapshot.asiaMacro = await analyzeAsiaMacro(indices);
    snapshot.asiaMacro.indices = indices;
  } catch (e) {
    console.error('Macro Asie échec:', e);
    snapshot.asiaMacro = { error: e.message };
  }

  progressBar.style.width = '100%';
  progressLabel.textContent = 'Sauvegarde…';

  saveSnapshot(snapshot);

  // Reset UI
  setTimeout(() => {
    progressContainer.classList.add('hidden');
    progressBar.style.width = '0%';
    btn.disabled = false;
    btn.textContent = '🔄 Lancer une analyse';
    state.isRefreshing = false;
    updateLastAnalysisLabel();
    renderAll();
    showToast('✅ Analyse terminée');
  }, 500);
}

// ============================================================
// COMPARAISON SNAPSHOTS : détecte les changements
// ============================================================

function compareStock(current, previous) {
  // Retourne flags de changements
  if (!previous || previous.error) {
    return {
      isNew: true,
      verdictChanged: !!current.analysis?.verdict,
      verdictUnchanged: false,
      dividendUnchanged: false,
      seenNewsUrls: new Set()
    };
  }

  const seenNewsUrls = new Set(
    (previous.analysis?.news_importantes || []).map(n => n.url).filter(Boolean)
  );

  const verdictChanged = !!current.analysis?.verdict
    && current.analysis.verdict !== previous.analysis?.verdict;

  const verdictUnchanged = !!current.analysis?.verdict
    && current.analysis.verdict === previous.analysis?.verdict;

  const dividendUnchanged = (
    current.lastDividend === previous.lastDividend &&
    current.yield != null && previous.yield != null &&
    Math.abs((current.yield || 0) - (previous.yield || 0)) < 0.01
  );

  return {
    isNew: false,
    verdictChanged,
    verdictUnchanged,
    dividendUnchanged,
    seenNewsUrls
  };
}

// ============================================================
// RENDERING : cartes actions
// ============================================================

function renderStockCard(stock) {
  if (stock.error || !stock.price) {
    return `
      <div class="error-card">
        <strong>${escapeHtml(stock.ticker)}</strong> — ${escapeHtml(stock.name || '')}
        <br>⚠️ Données indisponibles : ${escapeHtml(stock.error || 'erreur inconnue')}
      </div>`;
  }

  const prev = state.previousSnapshot?.data?.[stock.ticker];
  const diff = compareStock(stock, prev);

  const verdict = stock.analysis?.verdict || 'neutre';
  const summary = stock.analysis?.resume || '(Pas d\'analyse IA disponible)';
  const hausseDiv = stock.analysis?.hausse_dividende_detectee;
  const detailsHausse = stock.analysis?.details_hausse;
  const newsList = stock.analysis?.news_importantes || [];

  const changeClass = stock.changePct > 0 ? 'positive' : (stock.changePct < 0 ? 'negative' : 'neutral');

  // Earnings récent : beat / miss / in-line
  let epsHtml = '';
  if (stock.latestEps?.actual != null && stock.latestEps?.estimate != null) {
    const a = stock.latestEps.actual, e = stock.latestEps.estimate;
    let cls = 'in-line', label = 'In-line';
    if (a > e * 1.02) { cls = 'beat'; label = `Beat (${a} vs ${e})`; }
    else if (a < e * 0.98) { cls = 'miss'; label = `Miss (${a} vs ${e})`; }
    else { label = `In-line (${a} vs ${e})`; }
    epsHtml = `<div class="kv-row"><span class="kv-label">EPS récent</span><span class="eps-result ${cls}">${escapeHtml(label)}</span></div>`;
  }

  let nextEarningsHtml = '';
  if (stock.nextEarningsDate) {
    const daysUntil = Math.ceil((new Date(stock.nextEarningsDate) - Date.now()) / (24 * 3600 * 1000));
    if (daysUntil >= 0 && daysUntil <= 90) {
      nextEarningsHtml = `<div class="kv-row"><span class="kv-label">Prochain earnings</span><span class="kv-value">Dans ${daysUntil}j (${stock.nextEarningsDate})</span></div>`;
    } else {
      nextEarningsHtml = `<div class="kv-row"><span class="kv-label">Prochain earnings</span><span class="kv-value">${stock.nextEarningsDate}</span></div>`;
    }
  }

  // News rendering avec gestion "déjà vu"
  const newsHtml = newsList.length > 0
    ? newsList.map(n => {
        const seen = diff.seenNewsUrls.has(n.url);
        const sentiment = n.sentiment || 'neutre';
        return `
          <div class="news-item ${seen ? 'seen' : ''}">
            ${!seen ? '<span class="new-dot"></span>' : ''}
            <div style="flex:1;">
              <span class="news-sentiment ${sentiment}"></span>
              <a href="${escapeHtml(n.url)}" target="_blank" rel="noopener" class="news-link">${escapeHtml(n.titre_fr || n.titre_vo || '')}</a>
              ${n.titre_vo && n.titre_fr !== n.titre_vo ? `<a href="${escapeHtml(n.url)}" target="_blank" rel="noopener" class="news-vo-link">🇬🇧 VO</a>` : ''}
              <div class="news-meta">${escapeHtml(n.date || '')}</div>
            </div>
          </div>`;
      }).join('')
    : '<div class="kv-row"><span class="kv-label muted">Aucune news majeure ce mois</span></div>';

  const verdictPillClass = `verdict-pill ${verdict.replace('é', 'e').replace('à', 'a')}` + (diff.verdictUnchanged ? ' unchanged' : '');
  const verdictEmoji = verdict === 'positif' ? '🟢' : (verdict === 'négatif' ? '🔴' : '🟡');

  return `
    <article class="stock-card">
      ${diff.verdictChanged ? '<span class="new-verdict-badge">NOUVEAU VERDICT</span>' : ''}
      <div class="card-header">
        <div class="card-title-block">
          <div class="ticker">
            ${escapeHtml(stock.ticker)}
            ${diff.isNew ? '<span class="new-verdict-badge">NOUVEAU</span>' : ''}
          </div>
          <div class="company-name">${escapeHtml(stock.name)}</div>
          ${stock.sector ? `<div class="sector-label">${escapeHtml(stock.sector)}</div>` : ''}
        </div>
        <div class="price-block">
          <div class="price">${formatCurrency(stock.price, stock.currency)}</div>
          <div class="price-change ${changeClass}">${formatPct(stock.changePct)}</div>
          <div style="margin-top:6px;">
            <span class="${verdictPillClass}">${verdictEmoji} ${escapeHtml(verdict)}</span>
          </div>
        </div>
      </div>

      <div class="card-summary">${escapeHtml(summary)}</div>

      <div class="card-section">
        <div class="card-section-title">
          💰 Dividende
          ${diff.dividendUnchanged ? '<span class="unchanged-marker">=</span>' : ''}
        </div>
        ${hausseDiv ? `<div class="div-increase-badge">🎉 HAUSSE ANNONCÉE${detailsHausse ? ' : ' + escapeHtml(detailsHausse) : ''}</div>` : ''}
        <div class="kv-row">
          <span class="kv-label">Yield</span>
          <span class="kv-value">${stock.yield != null ? stock.yield.toFixed(2) + '%' : '—'}</span>
        </div>
        <div class="kv-row">
          <span class="kv-label">Dernier dividende</span>
          <span class="kv-value">${stock.lastDividend != null ? formatCurrency(stock.lastDividend, stock.currency) : '—'}</span>
        </div>
        ${stock.exDivDate ? `<div class="kv-row"><span class="kv-label">Ex-dividende</span><span class="kv-value">${escapeHtml(stock.exDivDate)}</span></div>` : ''}
      </div>

      ${(epsHtml || nextEarningsHtml) ? `
      <div class="card-section">
        <div class="card-section-title">📊 Earnings</div>
        ${epsHtml}
        ${nextEarningsHtml}
      </div>` : ''}

      <div class="card-section">
        <div class="card-section-title">📰 News</div>
        ${newsHtml}
      </div>
    </article>
  `;
}

function sortStocks(stocks, mode) {
  const verdictOrder = { 'négatif': 0, 'neutre': 1, 'positif': 2 };
  return [...stocks].sort((a, b) => {
    if (mode === 'verdict') {
      const va = verdictOrder[a.analysis?.verdict] ?? 1;
      const vb = verdictOrder[b.analysis?.verdict] ?? 1;
      if (va !== vb) return va - vb;
      return (a.ticker || '').localeCompare(b.ticker || '');
    } else if (mode === 'change') {
      return (a.changePct ?? 0) - (b.changePct ?? 0);
    } else {
      return (a.ticker || '').localeCompare(b.ticker || '');
    }
  });
}

// ============================================================
// RENDERING : portefeuille
// ============================================================

function renderPortfolio() {
  const container = document.getElementById('portfolioList');
  if (!state.currentSnapshot) {
    container.innerHTML = '<div class="empty-state">Lance une première analyse pour voir tes actions.</div>';
    return;
  }

  const sortMode = document.getElementById('sortSelect').value;
  const showOwned = document.getElementById('filterOwned').checked;
  const showWatchlist = document.getElementById('filterWatchlist').checked;

  // Récup data des actions US/perso
  const stockData = state.stocks.map(s => {
    const data = state.currentSnapshot.data[s.ticker];
    return data ? { ...data, type: s.type } : { ...s, error: 'Pas analysé' };
  });

  // Filtres
  const filtered = stockData.filter(s => {
    if (s.type === 'owned' && !showOwned) return false;
    if (s.type === 'watchlist' && !showWatchlist) return false;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">Aucune action ne correspond aux filtres.</div>';
    return;
  }

  const sorted = sortStocks(filtered, sortMode);
  container.innerHTML = sorted.map(renderStockCard).join('');
}

// ============================================================
// RENDERING : Asie (macro + sociétés + perso)
// ============================================================

function renderAsiaMacro() {
  const container = document.getElementById('asiaMacroCard');
  const macro = state.currentSnapshot?.asiaMacro;
  if (!macro) {
    container.innerHTML = '<div class="empty-state">Lance une analyse pour générer le point macro Asie.</div>';
    return;
  }
  if (macro.error) {
    container.innerHTML = `<div class="error-card">⚠️ Erreur macro Asie : ${escapeHtml(macro.error)}</div>`;
    return;
  }

  const indices = macro.indices || {};
  const buildCountry = (key, label, indexKey) => {
    const c = macro[key];
    if (!c) return '';
    const verdictEmoji = c.verdict === 'positif' ? '🟢' : (c.verdict === 'négatif' ? '🔴' : '🟡');
    const indexVal = indices[indexKey];
    const indexStr = indexVal != null ? `${formatPct(indexVal)}` : 'N/A';
    return `
      <div class="country-block">
        <div class="country-header">
          <div class="country-name">
            ${label}
            <span class="country-index">${indexStr}</span>
          </div>
          <span class="verdict-pill ${(c.verdict || 'neutre').replace('é', 'e').replace('à', 'a')}">${verdictEmoji} ${escapeHtml(c.verdict || 'neutre')}</span>
        </div>
        ${c.alerte_majeure ? `<div class="macro-alert">🚨 ${escapeHtml(c.alerte_majeure)}</div>` : ''}
        <div class="country-summary">${escapeHtml(c.resume || '')}</div>
      </div>
    `;
  };

  container.innerHTML = `
    ${buildCountry('chine', '🇨🇳 Chine / HK', '^HSI')}
    ${buildCountry('japon', '🇯🇵 Japon', '^N225')}
    ${buildCountry('coree', '🇰🇷 Corée du Sud', '^KS11')}
    ${macro.geopolitique ? `<div class="geopolitics-block"><strong>Géopolitique :</strong> ${escapeHtml(macro.geopolitique)}</div>` : ''}
  `;
}

function renderAsiaCompanyCard(meta, withDiscovery = true) {
  const data = state.currentSnapshot?.data?.[meta.ticker];
  if (!data) {
    return `
      <article class="stock-card">
        <div class="card-header">
          <div class="card-title-block">
            <div class="ticker">${escapeHtml(meta.ticker)}</div>
            <div class="company-name">${escapeHtml(meta.name)}</div>
            <div class="sector-label">${escapeHtml(meta.country)} • ${escapeHtml(meta.sector)}</div>
          </div>
        </div>
        <div class="card-summary muted">Pas encore analysé. Lance une analyse.</div>
        ${withDiscovery ? renderDiscoveryToggle(meta) : ''}
      </article>
    `;
  }

  // On enrichit la meta avec name/country/sector
  const enriched = { ...data, name: meta.name, country: meta.country, sector: meta.sector };
  const cardHtml = renderStockCard(enriched);
  if (!withDiscovery) return cardHtml;

  // On injecte le toggle découverte juste avant le </article>
  return cardHtml.replace('</article>', renderDiscoveryToggle(meta) + '</article>');
}

function renderDiscoveryToggle(meta) {
  const id = `disc-${meta.ticker.replace(/[^a-z0-9]/gi, '')}`;
  return `
    <button class="discovery-toggle" data-target="${id}">📖 Fiche découverte ▾</button>
    <div class="discovery-content hidden" id="${id}">
      <h4>À propos</h4>
      <div>${escapeHtml(meta.description)}</div>
      <h4>⚠️ Points d'attention Asie</h4>
      <ul class="warn-list">
        ${ASIA_WARNINGS.map(w => `<li><strong>${escapeHtml(w.title)} :</strong> ${escapeHtml(w.text)}</li>`).join('')}
      </ul>
    </div>
  `;
}

function renderAsiaCompanies() {
  const container = document.getElementById('asiaCompaniesList');
  container.innerHTML = ASIA_COMPANIES.map(m => renderAsiaCompanyCard(m, true)).join('');
  // Branche les toggles fiches découverte
  container.querySelectorAll('.discovery-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      if (target) {
        target.classList.toggle('hidden');
        btn.textContent = target.classList.contains('hidden')
          ? '📖 Fiche découverte ▾'
          : '📖 Fiche découverte ▴';
      }
    });
  });
}

function renderAsiaPerso() {
  const container = document.getElementById('asiaPersoList');
  if (state.asiaPerso.length === 0) {
    container.innerHTML = '<div class="empty-state">Ajoute des tickers asiatiques depuis l\'onglet "Actions".</div>';
    return;
  }
  container.innerHTML = state.asiaPerso.map(ticker => {
    const data = state.currentSnapshot?.data?.[ticker];
    if (!data) {
      return `<div class="empty-state">${escapeHtml(ticker)} — Lance une analyse pour le charger.</div>`;
    }
    return renderStockCard(data);
  }).join('');
}

// ============================================================
// RENDERING : Gestion actions (écran 3)
// ============================================================

function renderManageList() {
  // Stocks US / perso
  const stocksList = document.getElementById('stocksManageList');
  if (state.stocks.length === 0) {
    stocksList.innerHTML = '<div class="empty-state">Aucune action. Ajoute-en une ci-dessus.</div>';
  } else {
    stocksList.innerHTML = state.stocks.map((s, idx) => `
      <div class="manage-row">
        <div class="manage-row-info">
          <div class="manage-row-ticker">${escapeHtml(s.ticker)}</div>
          <div class="manage-row-name">${escapeHtml(s.name || '')}${s.sector ? ' • ' + escapeHtml(s.sector) : ''}</div>
        </div>
        <div class="manage-row-actions">
          <button class="type-toggle ${s.type === 'owned' ? 'owned' : ''}" data-idx="${idx}" data-action="toggle-type">
            ${s.type === 'owned' ? '✓ Détenu' : '👁 Watchlist'}
          </button>
          <button class="delete-btn" data-idx="${idx}" data-action="delete-stock">×</button>
        </div>
      </div>
    `).join('');
  }

  // Asie perso
  const asiaList = document.getElementById('asiaManageList');
  let html = '';
  // 13 préremplies (non supprimables)
  html += '<div style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">📚 Préremplies (non supprimables) :</div>';
  html += ASIA_COMPANIES.map(a => `
    <div class="manage-row" style="opacity:0.7;">
      <div class="manage-row-info">
        <div class="manage-row-ticker">${escapeHtml(a.ticker)}</div>
        <div class="manage-row-name">${escapeHtml(a.name)} • ${escapeHtml(a.country)}</div>
      </div>
    </div>
  `).join('');
  // Asie perso (supprimables)
  if (state.asiaPerso.length > 0) {
    html += '<div style="font-size:12px; color:var(--text-muted); margin:12px 0 8px;">⭐ Tes ajouts :</div>';
    html += state.asiaPerso.map((ticker, idx) => `
      <div class="manage-row">
        <div class="manage-row-info">
          <div class="manage-row-ticker">${escapeHtml(ticker)}</div>
        </div>
        <div class="manage-row-actions">
          <button class="delete-btn" data-idx="${idx}" data-action="delete-asia-perso">×</button>
        </div>
      </div>
    `).join('');
  }
  asiaList.innerHTML = html;

  // Branche les handlers
  stocksList.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(btn.dataset.idx);
      const action = btn.dataset.action;
      if (action === 'toggle-type') {
        const s = state.stocks[idx];
        s.type = s.type === 'owned' ? 'watchlist' : 'owned';
        saveStocks();
        renderManageList();
        renderPortfolio();
      } else if (action === 'delete-stock') {
        const s = state.stocks[idx];
        if (confirm(`Supprimer ${s.ticker} ${s.name || ''} ?`)) {
          state.stocks.splice(idx, 1);
          saveStocks();
          renderManageList();
          renderPortfolio();
        }
      }
    });
  });

  asiaList.querySelectorAll('[data-action="delete-asia-perso"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      const t = state.asiaPerso[idx];
      if (confirm(`Supprimer ${t} de tes intérêts Asie ?`)) {
        state.asiaPerso.splice(idx, 1);
        saveAsiaPerso();
        renderManageList();
        renderAsiaPerso();
      }
    });
  });
}

// ============================================================
// HEADER : label "Dernière analyse"
// ============================================================

function updateLastAnalysisLabel() {
  const label = document.getElementById('lastAnalysisLabel');
  label.textContent = state.lastAnalysisTs
    ? `Dernière analyse : ${formatTimeAgo(state.lastAnalysisTs)}`
    : 'Jamais analysé';
}

// ============================================================
// RENDER ALL
// ============================================================

function renderAll() {
  renderPortfolio();
  renderAsiaMacro();
  renderAsiaCompanies();
  renderAsiaPerso();
  renderManageList();
  updateLastAnalysisLabel();
}

// ============================================================
// NAVIGATION
// ============================================================

function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.screen;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.getElementById(`screen-${target}`).classList.add('active');
      window.scrollTo(0, 0);
    });
  });
}

// ============================================================
// SETUP SETTINGS
// ============================================================

function setupSettings() {
  const finnhubInput = document.getElementById('finnhubKey');
  const claudeInput = document.getElementById('claudeKey');
  const translateToggle = document.getElementById('translateToggle');

  finnhubInput.value = state.finnhubKey;
  claudeInput.value = state.claudeKey;
  translateToggle.checked = state.translateEnabled;

  document.getElementById('saveKeysBtn').addEventListener('click', () => {
    state.finnhubKey = finnhubInput.value.trim();
    state.claudeKey = claudeInput.value.trim();
    localStorage.setItem(STORAGE_KEYS.FINNHUB_KEY, state.finnhubKey);
    localStorage.setItem(STORAGE_KEYS.CLAUDE_KEY, state.claudeKey);
    const msg = document.getElementById('keysSavedMsg');
    msg.textContent = '✓ Clés sauvegardées';
    msg.className = 'info-msg ok';
    setTimeout(() => { msg.textContent = ''; }, 2500);
  });

  translateToggle.addEventListener('change', () => {
    state.translateEnabled = translateToggle.checked;
    localStorage.setItem(STORAGE_KEYS.TRANSLATE, String(state.translateEnabled));
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    const dump = {
      version: 1,
      exportedAt: new Date().toISOString(),
      stocks: state.stocks,
      asiaPerso: state.asiaPerso,
      lastAnalysisTs: state.lastAnalysisTs,
      currentSnapshot: state.currentSnapshot,
      history: JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY)) || []
    };
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dgi-veille-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('✅ Export téléchargé');
  });

  document.getElementById('importInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('Importer va remplacer toutes tes données actuelles. Continuer ?')) {
      e.target.value = '';
      return;
    }
    try {
      const txt = await file.text();
      const dump = JSON.parse(txt);
      if (dump.stocks) localStorage.setItem(STORAGE_KEYS.STOCKS, JSON.stringify(dump.stocks));
      if (dump.asiaPerso) localStorage.setItem(STORAGE_KEYS.ASIA_PERSO, JSON.stringify(dump.asiaPerso));
      if (dump.currentSnapshot) localStorage.setItem(STORAGE_KEYS.CURRENT_SNAPSHOT, JSON.stringify(dump.currentSnapshot));
      if (dump.history) localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(dump.history));
      if (dump.lastAnalysisTs) localStorage.setItem(STORAGE_KEYS.LAST_ANALYSIS, dump.lastAnalysisTs);
      loadFromStorage();
      renderAll();
      showToast('✅ Import réussi');
    } catch (err) {
      showToast('❌ Fichier invalide');
      console.error(err);
    }
    e.target.value = '';
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    if (!confirm('⚠️ Reset complet : ça efface TOUT (clés API, snapshots, ajouts). Continuer ?')) return;
    if (!confirm('Vraiment sûr ? Cette action est irréversible.')) return;
    Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
    loadFromStorage();
    renderAll();
    setupSettings(); // recharger les inputs vides
    showToast('🗑️ Reset effectué');
  });
}

// ============================================================
// SETUP : ajout de tickers
// ============================================================

function setupAddTicker() {
  document.getElementById('addTickerBtn').addEventListener('click', () => {
    const input = document.getElementById('newTickerInput');
    const select = document.getElementById('newTickerType');
    const msgEl = document.getElementById('addTickerMsg');
    const ticker = input.value.trim().toUpperCase();
    const type = select.value;

    if (!ticker) {
      msgEl.textContent = '⚠️ Saisis un ticker';
      msgEl.className = 'info-msg error';
      return;
    }

    if (type === 'asia-perso') {
      // Convention : on garde la casse originale pour les tickers asiatiques (.HK, .T, .KS)
      const tickerCased = input.value.trim();
      if (state.asiaPerso.includes(tickerCased)) {
        msgEl.textContent = '⚠️ Ticker déjà présent';
        msgEl.className = 'info-msg error';
        return;
      }
      state.asiaPerso.push(tickerCased);
      saveAsiaPerso();
      msgEl.textContent = `✓ ${tickerCased} ajouté en Asie perso`;
    } else {
      if (state.stocks.some(s => s.ticker === ticker)) {
        msgEl.textContent = '⚠️ Ticker déjà présent';
        msgEl.className = 'info-msg error';
        return;
      }
      state.stocks.push({ ticker, name: ticker, sector: '', type });
      saveStocks();
      msgEl.textContent = `✓ ${ticker} ajouté en ${type}`;
    }
    msgEl.className = 'info-msg ok';
    input.value = '';
    renderManageList();
    renderPortfolio();
    setTimeout(() => { msgEl.textContent = ''; }, 3000);
  });
}

// ============================================================
// SETUP : filtres & tri du portefeuille
// ============================================================

function setupPortfolioControls() {
  document.getElementById('sortSelect').addEventListener('change', renderPortfolio);
  document.getElementById('filterOwned').addEventListener('change', renderPortfolio);
  document.getElementById('filterWatchlist').addEventListener('change', renderPortfolio);
}

// ============================================================
// SERVICE WORKER
// ============================================================

function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW register failed:', e));
    });
  }
}

// ============================================================
// INIT
// ============================================================

function init() {
  loadFromStorage();
  setupNavigation();
  setupSettings();
  setupAddTicker();
  setupPortfolioControls();

  document.getElementById('refreshBtn').addEventListener('click', runFullAnalysis);

  renderAll();
  registerSW();

  // Refresh régulier du label "il y a X min"
  setInterval(updateLastAnalysisLabel, 60000);
}

document.addEventListener('DOMContentLoaded', init);
