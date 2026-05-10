// ============================================================
// DGI VEILLE — app.js v1.1
// Améliorations : refresh sélectif, skip Claude inchangés,
// news résumées, dividendes détaillés (an N / N-1 / $).
// ============================================================

import { DEFAULT_STOCKS } from './data/stocks.js';
import { ASIA_COMPANIES, ASIA_WARNINGS } from './data/asia.js';

// ============================================================
// CONSTANTES
// ============================================================

const STORAGE_KEYS = {
  STOCKS: 'dgi.stocks',
  ASIA_PERSO: 'dgi.asiaPerso',
  FINNHUB_KEY: 'dgi.finnhubKey',
  CLAUDE_KEY: 'dgi.claudeKey',
  TRANSLATE: 'dgi.translate',
  CURRENT_SNAPSHOT: 'dgi.snapshot.current',
  HISTORY: 'dgi.snapshot.history',
  LAST_ANALYSIS: 'dgi.lastAnalysisTs',
  ANALYSIS_PREFS: 'dgi.analysisPrefs'
};

const MAX_HISTORY = 6;

const CORS_PROXIES = [
  url => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
];

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// ============================================================
// ÉTAT GLOBAL
// ============================================================

let state = {
  stocks: [],
  asiaPerso: [],
  finnhubKey: '',
  claudeKey: '',
  translateEnabled: true,
  lastAnalysisTs: null,
  currentSnapshot: null,
  previousSnapshot: null,
  isRefreshing: false,
  analysisPrefs: {
    catOwned: true,
    catWatchlist: true,
    catAsiaDiscover: false,
    catAsiaPerso: true,
    optSkipUnchanged: true
  }
};

// ============================================================
// STORAGE
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

    const history = JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY)) || [];
    state.previousSnapshot = history.length > 0 ? history[history.length - 1] : null;

    const prefs = JSON.parse(localStorage.getItem(STORAGE_KEYS.ANALYSIS_PREFS));
    if (prefs) state.analysisPrefs = { ...state.analysisPrefs, ...prefs };
  } catch (e) {
    console.error('Erreur chargement localStorage:', e);
  }
}

function saveStocks() { localStorage.setItem(STORAGE_KEYS.STOCKS, JSON.stringify(state.stocks)); }
function saveAsiaPerso() { localStorage.setItem(STORAGE_KEYS.ASIA_PERSO, JSON.stringify(state.asiaPerso)); }
function saveAnalysisPrefs() { localStorage.setItem(STORAGE_KEYS.ANALYSIS_PREFS, JSON.stringify(state.analysisPrefs)); }

function mergeSnapshot(newSnapshot) {
  // IMPORTANT : on FUSIONNE avec l'existant (refresh partiel).
  // Si on n'a analysé que les Détenus, on garde les données précédentes des autres.
  const merged = {
    timestamp: newSnapshot.timestamp,
    data: { ...(state.currentSnapshot?.data || {}) },
    asiaMacro: newSnapshot.asiaMacro || state.currentSnapshot?.asiaMacro || null
  };
  // Écrase uniquement les tickers qui ont été ré-analysés
  Object.assign(merged.data, newSnapshot.data);
  return merged;
}

function saveSnapshot(snapshot) {
  // Archive l'ancien snapshot dans l'historique
  if (state.currentSnapshot) {
    const history = JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY)) || [];
    history.push(state.currentSnapshot);
    while (history.length > MAX_HISTORY) history.shift();
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
    state.previousSnapshot = state.currentSnapshot;
  }
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
  if (min < 1)  return 'À l\'instant';
  if (min < 60) return `Il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `Il y a ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7)    return `Il y a ${d}j`;
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

function formatDateFr(isoDate) {
  if (!isoDate) return null;
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return isoDate; }
}

// ============================================================
// FETCH WITH CORS PROXY
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
      console.warn(`Proxy CORS échoué:`, e.message);
    }
  }
  throw new Error(`Tous les proxies CORS ont échoué : ${lastError?.message}`);
}

// ============================================================
// YAHOO FINANCE : chart (avec historique dividendes 2 ans)
// ============================================================

async function fetchYahooChart(ticker, range = '2y') {
  // 2 ans pour avoir année en cours + année précédente complète de dividendes
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}&events=div`;
  const res = await fetchWithCorsProxy(url);
  const data = await res.json();

  if (data?.chart?.error) throw new Error(data.chart.error.description || 'Yahoo error');
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error('Pas de données Yahoo');

  const meta = result.meta || {};
  const closes = result.indicators?.quote?.[0]?.close || [];
  const timestamps = result.timestamp || [];

  // Variation 1 mois (~22 trading days)
  const last = [...closes].reverse().find(v => v != null) ?? meta.regularMarketPrice;
  let oneMonthAgo = null;
  const targetIdx = Math.max(0, closes.length - 22);
  for (let i = targetIdx; i < closes.length; i++) {
    if (closes[i] != null) { oneMonthAgo = closes[i]; break; }
  }
  const changePct = (oneMonthAgo && last) ? ((last - oneMonthAgo) / oneMonthAgo) * 100 : null;

  // Dividendes : on récupère TOUT l'historique 2 ans
  const divs = result.events?.dividends || {};
  const dividends = Object.values(divs).map(d => ({
    amount: d.amount,
    date: new Date(d.date * 1000).toISOString().slice(0, 10)
  })).sort((a, b) => a.date.localeCompare(b.date));

  return {
    price: last,
    currency: meta.currency || 'USD',
    changePct,
    allDividends: dividends
  };
}

// ============================================================
// ANALYSE DIVIDENDES : an en cours, an précédent, hausse en $
// ============================================================

function analyzeDividends(allDividends) {
  if (!allDividends || allDividends.length === 0) {
    return {
      currentYearTotal: null,
      previousYearTotal: null,
      currentYear: null,
      previousYear: null,
      lastDividend: null,
      lastDividendDate: null,
      increaseAmount: null,
      increasePct: null,
      announcementDate: null,
      effectiveDate: null
    };
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const previousYear = currentYear - 1;

  const currentYearDivs = allDividends.filter(d => d.date.startsWith(String(currentYear)));
  const previousYearDivs = allDividends.filter(d => d.date.startsWith(String(previousYear)));

  const currentYearTotal = currentYearDivs.reduce((sum, d) => sum + d.amount, 0);
  const previousYearTotal = previousYearDivs.reduce((sum, d) => sum + d.amount, 0);

  // Dernier dividende effectivement versé
  const lastDiv = allDividends[allDividends.length - 1];

  // Détection de hausse : compare le dernier dividende à celui d'il y a ~1 an
  // (le dividende juste avant lui à -4 trimestres typiquement)
  let increaseAmount = null;
  let increasePct = null;
  let announcementDate = null;
  let effectiveDate = null;

  if (allDividends.length >= 2) {
    // Le dernier vs le dernier de l'année précédente (à la même époque)
    const last = allDividends[allDividends.length - 1];
    // On cherche un dividende ~1 an avant
    const targetDate = new Date(last.date);
    targetDate.setFullYear(targetDate.getFullYear() - 1);
    const targetIso = targetDate.toISOString().slice(0, 10);

    // Trouve le dividende le plus proche d'il y a 1 an (par date)
    let closestPrior = null;
    let minDiff = Infinity;
    for (const d of allDividends) {
      if (d.date >= last.date) continue;
      const diff = Math.abs(new Date(d.date) - targetDate);
      if (diff < minDiff) { minDiff = diff; closestPrior = d; }
    }

    if (closestPrior && Math.abs(last.amount - closestPrior.amount) > 0.001) {
      increaseAmount = last.amount - closestPrior.amount;
      increasePct = (increaseAmount / closestPrior.amount) * 100;
      effectiveDate = last.date;  // date du premier dividende au nouveau montant
    }
  }

  return {
    currentYearTotal: currentYearTotal > 0 ? currentYearTotal : null,
    previousYearTotal: previousYearTotal > 0 ? previousYearTotal : null,
    currentYear,
    previousYear,
    lastDividend: lastDiv?.amount ?? null,
    lastDividendDate: lastDiv?.date ?? null,
    increaseAmount,
    increasePct,
    announcementDate,  // Sera complété par Claude si trouvé dans les news
    effectiveDate
  };
}

// ============================================================
// YAHOO FINANCE : quoteSummary
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

    let nextEarningsDate = null;
    if (ce.earnings?.earningsDate?.[0]?.raw) {
      nextEarningsDate = new Date(ce.earnings.earningsDate[0].raw * 1000).toISOString().slice(0, 10);
    }

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
      annualDivRate: sd.dividendRate?.raw ?? sd.trailingAnnualDividendRate?.raw ?? null,
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
// FINNHUB : news
// ============================================================

async function fetchFinnhubNews(ticker) {
  if (!state.finnhubKey) return [];

  const today = new Date();
  const from = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = today.toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(ticker)}&from=${from}&to=${to}&token=${encodeURIComponent(state.finnhubKey)}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
    const news = await res.json();
    if (!Array.isArray(news)) return [];
    return news.slice(0, 30).map(n => ({
      headline: n.headline,
      summary: n.summary || '',  // résumé fourni par Finnhub
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
// YAHOO INDICES (Asie)
// ============================================================

async function fetchYahooIndices() {
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

// ============================================================
// CLAUDE API
// ============================================================

function parseClaudeJson(text) {
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
      max_tokens: 2000,  // augmenté pour les résumés de news
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
    ? headlines.map((h, i) => `[${i+1}] [${h.datetime}] ${h.headline}\n    Résumé source : ${h.summary || '(pas de résumé)'}\n    URL: ${h.url}`).join('\n\n')
    : '(Aucune news disponible)';

  const div = stockData.dividendAnalysis || {};
  const divInfo = `
- Total dividendes ${div.currentYear || '?'} (en cours) : ${div.currentYearTotal != null ? div.currentYearTotal.toFixed(4) : 'inconnu'}
- Total dividendes ${div.previousYear || '?'} (précédent) : ${div.previousYearTotal != null ? div.previousYearTotal.toFixed(4) : 'inconnu'}
- Dernier dividende versé : ${div.lastDividend ?? 'inconnu'} le ${div.lastDividendDate ?? '?'}
- Hausse détectée (vs il y a 1 an) : ${div.increaseAmount != null ? `+${div.increaseAmount.toFixed(4)} (${div.increasePct?.toFixed(1)}%)` : 'aucune'}`;

  const earningsStr = stockData.latestEps?.actual != null
    ? `EPS ${stockData.latestEps.actual} vs estimé ${stockData.latestEps.estimate}, date ${stockData.latestEps.date}`
    : 'Pas de earnings récent';

  const prompt = `Tu es un analyste financier qui fait une veille mensuelle pour un investisseur DGI français.

Action : ${stockData.name} (${stockData.ticker})
Pays : ${stockData.country || 'N/A'}
Secteur : ${stockData.sector || 'N/A'}
Cours actuel : ${stockData.price} ${stockData.currency}
Variation 1 mois : ${stockData.changePct?.toFixed(2)}%
Yield : ${stockData.yield?.toFixed(2) ?? '?'}%

Données dividende :${divInfo}

Earnings récent : ${earningsStr}

News des 30 derniers jours :
${headlinesStr}

Réponds UNIQUEMENT en JSON valide, sans markdown fences :
{
  "verdict": "positif" | "neutre" | "négatif",
  "resume": "2-3 phrases en français direct, sans jargon corporate",
  "hausse_dividende_detectee": true | false,
  "details_hausse": {
    "ancien_montant": <nombre ou null>,
    "nouveau_montant": <nombre ou null>,
    "hausse_en_dollars": <nombre ou null>,
    "hausse_en_pct": <nombre ou null>,
    "date_annonce": "YYYY-MM-DD ou null si non trouvée dans les news",
    "date_application": "YYYY-MM-DD ou null"
  },
  "news_importantes": [
    {
      "titre_fr": "titre traduit en français",
      "titre_vo": "titre original",
      "resume_fr": "RÉSUMÉ DE 2-3 PHRASES en français du contenu de l'article, pas juste le titre. Explique CE QUE DIT l'article concrètement.",
      "url": "...",
      "date": "YYYY-MM-DD",
      "sentiment": "positif" | "neutre" | "négatif"
    }
  ]
}

INSTRUCTIONS IMPORTANTES :
1. Sélectionne 3-5 news les plus IMPACTANTES pour la thèse d'investissement long terme (pas les plus récentes)
2. Pour chaque news, écris un VRAI RÉSUMÉ en français de 2-3 phrases qui explique le contenu de l'article. Utilise le "Résumé source" fourni quand il existe. Ne te contente PAS de traduire le titre.
3. Pour "details_hausse", cherche dans les news la date d'annonce et la date d'application de la hausse de dividende. Si pas trouvé, mets null.
4. Si "hausse_dividende_detectee" est false, mets tous les champs de details_hausse à null.`;

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

Utilise tes connaissances + le contexte des variations d'indices. Sois honnête sur ce que tu ne sais pas.`;

  return await callClaude(prompt);
}

// ============================================================
// SKIP CLAUDE : détecte si l'action a changé depuis le dernier refresh
// ============================================================

function hasSignificantChange(currentData, previousData) {
  if (!previousData || previousData.error || !previousData.analysis) return true;
  if (previousData.analysis.error) return true;

  // Compare prix (>2% change), yield, dividende, dernier earnings, news
  const priceChange = previousData.price && currentData.price
    ? Math.abs((currentData.price - previousData.price) / previousData.price) > 0.02
    : true;

  const divChange = (currentData.dividendAnalysis?.lastDividendDate
    !== previousData.dividendAnalysis?.lastDividendDate);

  const epsChange = currentData.latestEps?.date !== previousData.latestEps?.date;

  // News : si une nouvelle URL apparaît qui n'était pas dans le précédent
  const prevUrls = new Set((previousData.rawNews || []).map(n => n.url));
  const hasNewNews = (currentData.rawNews || []).some(n => n.url && !prevUrls.has(n.url));

  return priceChange || divChange || epsChange || hasNewNews;
}

// ============================================================
// PROCESS ONE STOCK
// ============================================================

async function processOneStock(stockMeta, progressCb, skipUnchanged = true) {
  const ticker = stockMeta.ticker;
  try {
    progressCb(`Analyse ${stockMeta.name || ticker}…`);

    const chartData = await fetchYahooChart(ticker);
    const summaryData = await fetchYahooSummary(ticker);
    const news = await fetchFinnhubNews(ticker);

    // Analyse dividendes locale (calculée depuis chart)
    const dividendAnalysis = analyzeDividends(chartData.allDividends);

    // Yield si manquant dans summary : on le recalcule depuis chart
    let yieldValue = summaryData.yield;
    if (yieldValue == null && dividendAnalysis.currentYearTotal != null && chartData.price) {
      // approximation : annualiser le dernier dividende × fréquence implicite
      const annualEstimate = dividendAnalysis.previousYearTotal || dividendAnalysis.currentYearTotal;
      if (annualEstimate > 0) {
        yieldValue = (annualEstimate / chartData.price) * 100;
      }
    }

    const stockData = {
      ticker,
      name: stockMeta.name || summaryData.name || ticker,
      sector: stockMeta.sector || summaryData.sector,
      country: stockMeta.country || summaryData.country,
      type: stockMeta.type || 'owned',
      price: chartData.price,
      currency: chartData.currency,
      changePct: chartData.changePct,
      yield: yieldValue,
      annualDivRate: summaryData.annualDivRate,
      exDivDate: summaryData.exDivDate,
      nextEarningsDate: summaryData.nextEarningsDate,
      latestEps: summaryData.latestEps,
      dividendAnalysis,
      rawNews: news
    };

    // Décision : skip Claude ou pas ?
    const previousData = state.currentSnapshot?.data?.[ticker];
    const shouldCallClaude = !skipUnchanged
      || !previousData
      || hasSignificantChange(stockData, previousData);

    let analysis = null;
    let usedCache = false;

    if (shouldCallClaude && state.claudeKey) {
      try {
        analysis = await analyzeStockWithClaude(stockData, news);
      } catch (e) {
        console.warn(`Claude échec pour ${ticker}:`, e.message);
        analysis = { error: e.message };
      }
    } else if (previousData?.analysis) {
      // On réutilise l'ancienne analyse Claude
      analysis = previousData.analysis;
      usedCache = true;
    }

    return { ...stockData, analysis, usedCache, error: null };
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

// ============================================================
// RUN ANALYSIS
// ============================================================

function getCountByCategory() {
  return {
    owned: state.stocks.filter(s => s.type === 'owned').length,
    watchlist: state.stocks.filter(s => s.type === 'watchlist').length,
    asiaPerso: state.asiaPerso.length,
    asiaDiscover: ASIA_COMPANIES.length
  };
}

function buildAnalysisQueue(prefs) {
  const queue = [];
  if (prefs.catOwned) {
    queue.push(...state.stocks.filter(s => s.type === 'owned'));
  }
  if (prefs.catWatchlist) {
    queue.push(...state.stocks.filter(s => s.type === 'watchlist'));
  }
  if (prefs.catAsiaPerso) {
    queue.push(...state.asiaPerso.map(t => ({ ticker: t, name: t, type: 'asia-perso' })));
  }
  if (prefs.catAsiaDiscover) {
    queue.push(...ASIA_COMPANIES.map(a => ({ ...a, type: 'asia-discover' })));
  }
  return queue;
}

async function runFullAnalysis() {
  if (state.isRefreshing) return;
  if (!state.claudeKey) { showToast('⚠️ Configure ta clé Claude dans Settings'); return; }
  if (!state.finnhubKey) { showToast('⚠️ Configure ta clé Finnhub dans Settings'); return; }

  const prefs = state.analysisPrefs;
  const queue = buildAnalysisQueue(prefs);

  if (queue.length === 0 && !prefs.catAsiaDiscover) {
    showToast('⚠️ Coche au moins une catégorie');
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

  const includeMacro = prefs.catAsiaDiscover;
  const total = queue.length + (includeMacro ? 1 : 0);

  const partialSnapshot = {
    timestamp: new Date().toISOString(),
    data: {},
    asiaMacro: null
  };

  let cachedCount = 0;
  let analyzedCount = 0;

  // Analyse chaque action
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    progressBar.style.width = `${(i / total) * 100}%`;
    const result = await processOneStock(item, msg => {
      progressLabel.textContent = `${msg} (${i + 1}/${queue.length})`;
    }, prefs.optSkipUnchanged);
    partialSnapshot.data[item.ticker] = result;
    if (result.usedCache) cachedCount++; else if (result.analysis && !result.error) analyzedCount++;
    await new Promise(r => setTimeout(r, 250));
  }

  // Macro Asie si Asie-Découverte coché
  if (includeMacro) {
    progressLabel.textContent = 'Analyse macro Asie…';
    progressBar.style.width = `${(queue.length / total) * 100}%`;
    try {
      const indices = await fetchYahooIndices();
      partialSnapshot.asiaMacro = await analyzeAsiaMacro(indices);
      partialSnapshot.asiaMacro.indices = indices;
    } catch (e) {
      console.error('Macro Asie échec:', e);
      partialSnapshot.asiaMacro = { error: e.message };
    }
  }

  progressBar.style.width = '100%';
  progressLabel.textContent = 'Sauvegarde…';

  // Fusion avec snapshot précédent (refresh partiel)
  const mergedSnapshot = mergeSnapshot(partialSnapshot);
  saveSnapshot(mergedSnapshot);

  setTimeout(() => {
    progressContainer.classList.add('hidden');
    progressBar.style.width = '0%';
    btn.disabled = false;
    btn.textContent = '🚀 Lancer l\'analyse sélectionnée';
    state.isRefreshing = false;
    updateLastAnalysisLabel();
    renderAll();
    const msg = cachedCount > 0
      ? `✅ ${analyzedCount} analysées, ${cachedCount} cachées`
      : `✅ Analyse terminée (${analyzedCount})`;
    showToast(msg, 3500);
  }, 500);
}

// ============================================================
// COMPARAISON SNAPSHOTS
// ============================================================

function compareStock(current, previous) {
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

  const currLast = current.dividendAnalysis?.lastDividend;
  const prevLast = previous.dividendAnalysis?.lastDividend;
  const dividendUnchanged = (currLast === prevLast);

  return { isNew: false, verdictChanged, verdictUnchanged, dividendUnchanged, seenNewsUrls };
}

// ============================================================
// RENDERING : carte action
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
  const newsList = stock.analysis?.news_importantes || [];
  const div = stock.dividendAnalysis || {};
  const hausseDetails = stock.analysis?.details_hausse || {};
  const isHausse = stock.analysis?.hausse_dividende_detectee || (div.increaseAmount != null && div.increaseAmount > 0);

  const changeClass = stock.changePct > 0 ? 'positive' : (stock.changePct < 0 ? 'negative' : 'neutral');

  // Earnings
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
      nextEarningsHtml = `<div class="kv-row"><span class="kv-label">Prochain earnings</span><span class="kv-value">Dans ${daysUntil}j (${formatDateFr(stock.nextEarningsDate)})</span></div>`;
    } else {
      nextEarningsHtml = `<div class="kv-row"><span class="kv-label">Prochain earnings</span><span class="kv-value">${formatDateFr(stock.nextEarningsDate)}</span></div>`;
    }
  }

  // Hausse dividende détaillée
  let hausseHtml = '';
  if (isHausse) {
    const ancien = hausseDetails.ancien_montant ?? (div.lastDividend != null && div.increaseAmount != null ? div.lastDividend - div.increaseAmount : null);
    const nouveau = hausseDetails.nouveau_montant ?? div.lastDividend;
    const hausse$ = hausseDetails.hausse_en_dollars ?? div.increaseAmount;
    const haussePct = hausseDetails.hausse_en_pct ?? div.increasePct;
    const dateAnnonce = hausseDetails.date_annonce;
    const dateAppli = hausseDetails.date_application ?? div.effectiveDate;

    hausseHtml = `
      <div class="div-increase-badge">
        <div style="font-size:14px; margin-bottom:6px;">🎉 HAUSSE DE DIVIDENDE</div>
        ${ancien != null && nouveau != null ? `<div class="haus-row"><span>Ancien → Nouveau</span><strong>${formatCurrency(ancien, stock.currency)} → ${formatCurrency(nouveau, stock.currency)}</strong></div>` : ''}
        ${hausse$ != null ? `<div class="haus-row"><span>Hausse en ${stock.currency || '$'}</span><strong>+${Math.abs(hausse$).toFixed(4)}${haussePct != null ? ` (${haussePct > 0 ? '+' : ''}${haussePct.toFixed(1)}%)` : ''}</strong></div>` : ''}
        ${dateAnnonce ? `<div class="haus-row"><span>Date d'annonce</span><strong>${formatDateFr(dateAnnonce)}</strong></div>` : ''}
        ${dateAppli ? `<div class="haus-row"><span>Date d'application</span><strong>${formatDateFr(dateAppli)}</strong></div>` : ''}
      </div>`;
  }

  // Section dividende
  const divRows = [];
  if (stock.yield != null) {
    divRows.push(`<div class="kv-row"><span class="kv-label">Yield</span><span class="kv-value">${stock.yield.toFixed(2)}%</span></div>`);
  }
  if (div.currentYearTotal != null) {
    divRows.push(`<div class="kv-row"><span class="kv-label">Total ${div.currentYear} (en cours)</span><span class="kv-value">${formatCurrency(div.currentYearTotal, stock.currency)}</span></div>`);
  }
  if (div.previousYearTotal != null) {
    divRows.push(`<div class="kv-row"><span class="kv-label">Total ${div.previousYear}</span><span class="kv-value">${formatCurrency(div.previousYearTotal, stock.currency)}</span></div>`);
  }
  if (div.lastDividend != null) {
    divRows.push(`<div class="kv-row"><span class="kv-label">Dernier versé</span><span class="kv-value">${formatCurrency(div.lastDividend, stock.currency)} <span class="muted">(${formatDateFr(div.lastDividendDate)})</span></span></div>`);
  }
  if (stock.exDivDate) {
    divRows.push(`<div class="kv-row"><span class="kv-label">Prochain ex-div</span><span class="kv-value">${escapeHtml(stock.exDivDate)}</span></div>`);
  }
  if (divRows.length === 0) {
    divRows.push(`<div class="kv-row"><span class="kv-label muted">Pas de données dividende disponibles</span></div>`);
  }

  // News avec résumés
  const newsHtml = newsList.length > 0
    ? newsList.map(n => {
        const seen = diff.seenNewsUrls.has(n.url);
        const sentiment = n.sentiment || 'neutre';
        return `
          <div class="news-item ${seen ? 'seen' : ''}">
            ${!seen ? '<span class="new-dot"></span>' : ''}
            <div style="flex:1;">
              <div class="news-headline">
                <span class="news-sentiment ${sentiment}"></span>
                <a href="${escapeHtml(n.url)}" target="_blank" rel="noopener" class="news-link">${escapeHtml(n.titre_fr || n.titre_vo || '')}</a>
              </div>
              ${n.resume_fr ? `<div class="news-summary">${escapeHtml(n.resume_fr)}</div>` : ''}
              <div class="news-meta">
                ${escapeHtml(formatDateFr(n.date) || '')}
                ${n.titre_vo && n.titre_fr !== n.titre_vo ? `· <a href="${escapeHtml(n.url)}" target="_blank" rel="noopener" class="news-vo-link">🇬🇧 VO</a>` : ''}
              </div>
            </div>
          </div>`;
      }).join('')
    : '<div class="kv-row"><span class="kv-label muted">Aucune news majeure ce mois</span></div>';

  const verdictPillClass = `verdict-pill ${verdict.replace('é', 'e').replace('à', 'a')}` + (diff.verdictUnchanged ? ' unchanged' : '');
  const verdictEmoji = verdict === 'positif' ? '🟢' : (verdict === 'négatif' ? '🔴' : '🟡');

  return `
    <article class="stock-card">
      ${diff.verdictChanged ? '<span class="new-verdict-badge">NOUVEAU VERDICT</span>' : ''}
      ${stock.usedCache ? '<span class="cached-marker">💾 cache (rien de neuf)</span>' : ''}
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
          ${diff.dividendUnchanged && !isHausse ? '<span class="unchanged-marker">=</span>' : ''}
        </div>
        ${hausseHtml}
        ${divRows.join('')}
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
// RENDER PORTFOLIO / ASIA / MANAGE
// ============================================================

function renderPortfolio() {
  const container = document.getElementById('portfolioList');
  if (!state.currentSnapshot) {
    container.innerHTML = '<div class="empty-state">Va dans l\'onglet "Analyse" pour lancer une première veille.</div>';
    return;
  }

  const sortMode = document.getElementById('sortSelect').value;
  const showOwned = document.getElementById('filterOwned').checked;
  const showWatchlist = document.getElementById('filterWatchlist').checked;

  const stockData = state.stocks.map(s => {
    const data = state.currentSnapshot.data[s.ticker];
    return data ? { ...data, type: s.type, name: s.name || data.name, sector: s.sector || data.sector } : { ...s, error: 'Pas encore analysé' };
  });

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

function renderAsiaMacro() {
  const container = document.getElementById('asiaMacroCard');
  const macro = state.currentSnapshot?.asiaMacro;
  if (!macro) {
    container.innerHTML = '<div class="empty-state">Lance une analyse Asie pour générer le point macro.</div>';
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
          <div class="country-name">${label}<span class="country-index">${indexStr}</span></div>
          <span class="verdict-pill ${(c.verdict || 'neutre').replace('é', 'e').replace('à', 'a')}">${verdictEmoji} ${escapeHtml(c.verdict || 'neutre')}</span>
        </div>
        ${c.alerte_majeure ? `<div class="macro-alert">🚨 ${escapeHtml(c.alerte_majeure)}</div>` : ''}
        <div class="country-summary">${escapeHtml(c.resume || '')}</div>
      </div>`;
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
        <div class="card-summary muted">Pas encore analysé. Coche "Asie - Découverte" dans l'onglet Analyse.</div>
        ${withDiscovery ? renderDiscoveryToggle(meta) : ''}
      </article>`;
  }
  const enriched = { ...data, name: meta.name, country: meta.country, sector: meta.sector };
  const cardHtml = renderStockCard(enriched);
  if (!withDiscovery) return cardHtml;
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
    </div>`;
}

function renderAsiaCompanies() {
  const container = document.getElementById('asiaCompaniesList');
  container.innerHTML = ASIA_COMPANIES.map(m => renderAsiaCompanyCard(m, true)).join('');
  container.querySelectorAll('.discovery-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      if (target) {
        target.classList.toggle('hidden');
        btn.textContent = target.classList.contains('hidden') ? '📖 Fiche découverte ▾' : '📖 Fiche découverte ▴';
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

function renderManageList() {
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
      </div>`).join('');
  }

  const asiaList = document.getElementById('asiaManageList');
  let html = '<div style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">📚 Préremplies (non supprimables) :</div>';
  html += ASIA_COMPANIES.map(a => `
    <div class="manage-row" style="opacity:0.7;">
      <div class="manage-row-info">
        <div class="manage-row-ticker">${escapeHtml(a.ticker)}</div>
        <div class="manage-row-name">${escapeHtml(a.name)} • ${escapeHtml(a.country)}</div>
      </div>
    </div>`).join('');
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
      </div>`).join('');
  }
  asiaList.innerHTML = html;

  stocksList.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      const action = btn.dataset.action;
      if (action === 'toggle-type') {
        const s = state.stocks[idx];
        s.type = s.type === 'owned' ? 'watchlist' : 'owned';
        saveStocks();
        renderManageList();
        renderPortfolio();
        renderAnalysisCounts();
      } else if (action === 'delete-stock') {
        const s = state.stocks[idx];
        if (confirm(`Supprimer ${s.ticker} ${s.name || ''} ?`)) {
          state.stocks.splice(idx, 1);
          saveStocks();
          renderManageList();
          renderPortfolio();
          renderAnalysisCounts();
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
        renderAnalysisCounts();
      }
    });
  });
}

// ============================================================
// RENDER ANALYSE (compteurs + estimation)
// ============================================================

function renderAnalysisCounts() {
  const c = getCountByCategory();
  const el = id => document.getElementById(id);
  if (el('catOwnedCount'))     el('catOwnedCount').textContent = `${c.owned} actions`;
  if (el('catWatchlistCount')) el('catWatchlistCount').textContent = `${c.watchlist} actions`;
  if (el('catAsiaPersoCount')) el('catAsiaPersoCount').textContent = `${c.asiaPerso} actions`;

  updateAnalysisEstimate();
}

function updateAnalysisEstimate() {
  const prefs = readPrefsFromUI();
  const queue = buildAnalysisQueue(prefs);
  const total = queue.length + (prefs.catAsiaDiscover ? 1 : 0);
  const secPerStock = prefs.optSkipUnchanged && state.currentSnapshot ? 4 : 8;  // estimation
  const estSec = total * secPerStock;
  const estEl = document.getElementById('analysisEstimate');
  if (!estEl) return;
  if (total === 0) {
    estEl.textContent = 'Aucune catégorie sélectionnée.';
  } else {
    const min = Math.floor(estSec / 60);
    const sec = estSec % 60;
    const timeStr = min > 0 ? `~${min} min ${sec > 0 ? sec + 's' : ''}` : `~${sec}s`;
    estEl.textContent = `Analyse de ${total} élément${total > 1 ? 's' : ''} • estimé ${timeStr}`;
  }
}

function renderLastAnalysisInfo() {
  const info = document.getElementById('lastAnalysisInfo');
  if (!state.currentSnapshot) {
    info.innerHTML = '<div class="empty-state">Aucune analyse pour l\'instant.</div>';
    return;
  }
  const data = state.currentSnapshot.data;
  const tickers = Object.keys(data);
  const errors = tickers.filter(t => data[t].error).length;
  const cached = tickers.filter(t => data[t].usedCache).length;
  const analyzed = tickers.length - errors - cached;
  const dt = new Date(state.currentSnapshot.timestamp);
  info.innerHTML = `
    <div class="stock-card">
      <div style="font-size:14px;">
        <div><strong>📅 Date :</strong> ${dt.toLocaleString('fr-FR')}</div>
        <div style="margin-top:8px;"><strong>✅ ${analyzed}</strong> analysées via IA</div>
        ${cached > 0 ? `<div><strong>💾 ${cached}</strong> récupérées depuis le cache (rien de neuf)</div>` : ''}
        ${errors > 0 ? `<div style="color:var(--verdict-negative);"><strong>⚠️ ${errors}</strong> en erreur</div>` : ''}
        <div style="margin-top:8px;"><strong>Total stocké :</strong> ${tickers.length} tickers</div>
      </div>
    </div>`;
}

// ============================================================
// READ / WRITE PREFS
// ============================================================

function readPrefsFromUI() {
  return {
    catOwned: document.getElementById('catOwned')?.checked ?? true,
    catWatchlist: document.getElementById('catWatchlist')?.checked ?? true,
    catAsiaDiscover: document.getElementById('catAsiaDiscover')?.checked ?? false,
    catAsiaPerso: document.getElementById('catAsiaPerso')?.checked ?? true,
    optSkipUnchanged: document.getElementById('optSkipUnchanged')?.checked ?? true
  };
}

function applyPrefsToUI() {
  const p = state.analysisPrefs;
  ['catOwned', 'catWatchlist', 'catAsiaDiscover', 'catAsiaPerso', 'optSkipUnchanged'].forEach(k => {
    const el = document.getElementById(k);
    if (el) el.checked = p[k];
  });
}

// ============================================================
// HEADER LABEL
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
  renderAnalysisCounts();
  renderLastAnalysisInfo();
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
// SETUP
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
      version: 1.1,
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
    setupSettings();
    showToast('🗑️ Reset effectué');
  });
}

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
    renderAnalysisCounts();
    setTimeout(() => { msgEl.textContent = ''; }, 3000);
  });
}

function setupPortfolioControls() {
  document.getElementById('sortSelect').addEventListener('change', renderPortfolio);
  document.getElementById('filterOwned').addEventListener('change', renderPortfolio);
  document.getElementById('filterWatchlist').addEventListener('change', renderPortfolio);
}

function setupAnalysisControls() {
  applyPrefsToUI();
  ['catOwned', 'catWatchlist', 'catAsiaDiscover', 'catAsiaPerso', 'optSkipUnchanged'].forEach(k => {
    const el = document.getElementById(k);
    if (el) el.addEventListener('change', () => {
      state.analysisPrefs = readPrefsFromUI();
      saveAnalysisPrefs();
      updateAnalysisEstimate();
    });
  });
  document.getElementById('refreshBtn').addEventListener('click', runFullAnalysis);
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
  setupAnalysisControls();
  renderAll();
  registerSW();
  setInterval(updateLastAnalysisLabel, 60000);
}

document.addEventListener('DOMContentLoaded', init);
