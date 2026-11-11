(function () {
  'use strict';

  const CONFIG = {
    refreshMs: 60 * 1000,   
    pastDays: 90,          
    forecastDays: 7,        
    ratioRisk: 1.8,        
    ratioDanger: 3.0,       
    rainRisk: 50,           
    rainDanger: 100,        
    tz: 'America/Sao_Paulo'
  };

  const ZONES = [
    { key: 'ok',     label: 'Normal',   flood: 'Não',      note: 'Rio dentro do normal. Sem sinal de enchente agora.' },
    { key: 'risk',   label: 'Em risco', flood: 'Possível', note: 'Rio acima do normal ou muita chuva a caminho. Acompanhe os avisos da Defesa Civil.' },
    { key: 'danger', label: 'Perigoso', flood: 'Sim',      note: 'Rio muito acima do normal. Risco alto de alagamento. Siga as orientações da Defesa Civil.' }
  ];

  const PRESETS = [
    { name: 'Porto Alegre',     lat: -30.0346, lon: -51.2177 },
    { name: 'Canoas',           lat: -29.9178, lon: -51.1839 },
    { name: 'São Leopoldo',     lat: -29.7603, lon: -51.1472 },
    { name: 'Novo Hamburgo',    lat: -29.6783, lon: -51.1306 },
    { name: 'Eldorado do Sul',  lat: -30.0847, lon: -51.6186 },
    { name: 'Lajeado',          lat: -29.4669, lon: -51.9614 },
    { name: 'Estrela',          lat: -29.5008, lon: -51.9653 },
    { name: 'Encantado',        lat: -28.9906, lon: -51.8703 },
    { name: 'Santa Cruz do Sul', lat: -29.7178, lon: -52.4258 },
    { name: 'Santa Maria',      lat: -29.6842, lon: -53.8069 },
    { name: 'Caxias do Sul',    lat: -29.1678, lon: -51.1794 },
    { name: 'Passo Fundo',      lat: -28.2628, lon: -52.4067 },
    { name: 'Pelotas',          lat: -31.7654, lon: -52.3376 },
    { name: 'Rio Grande',       lat: -32.0350, lon: -52.0986 },
    { name: 'Uruguaiana',       lat: -29.7547, lon: -57.0883 }
  ].map(function (c) { c.sub = 'RS'; return c; });

  const FLOOD_URL = 'https://flood-api.open-meteo.com/v1/flood';
  const RAIN_URL  = 'https://api.open-meteo.com/v1/forecast';
  const GEO_URL   = 'https://geocoding-api.open-meteo.com/v1/search';

  /* ===== Utilidades ===== */
  const $ = function (s) { return document.querySelector(s); };
  const nf  = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const fmt = function (v) { return v >= 100 ? nf0.format(v) : nf.format(v); };
  const css = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };

  function shortDate(iso) {
    const p = iso.split('-');
    return p[2] + '/' + p[1];
  }
  function todayStr() {
    return new Date().toLocaleDateString('en-CA', { timeZone: CONFIG.tz });
  }
  function nowHourStr() {
    return new Date().toLocaleString('sv-SE', { timeZone: CONFIG.tz }).slice(0, 13).replace(' ', 'T') + ':00';
  }
  function median(arr) {
    const s = arr.slice().sort(function (a, b) { return a - b; });
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  async function getJSON(url, timeout) {
    const ctl = new AbortController();
    const t = setTimeout(function () { ctl.abort(); }, timeout || 12000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  /* ===== Regras de classificação ===== */
  function zoneOfRatio(r) {
    if (r >= CONFIG.ratioDanger) return 2;
    if (r >= CONFIG.ratioRisk) return 1;
    return 0;
  }
  function zoneOfRain(mm) {
    if (mm >= CONFIG.rainDanger) return 2;
    if (mm >= CONFIG.rainRisk) return 1;
    return 0;
  }
  function riverLevelLabel(ratio) {
    if (ratio < 0.7) return 'Baixo';
    if (ratio < 1.3) return 'Normal';
    return 'Cheio';
  }

  /* ===== Dados ===== */
  const floodCache = new Map();

  function analyzeFlood(json) {
    const d = json && json.daily;
    if (!d || !d.time || !d.river_discharge) throw new Error('Sem dados de rio para este ponto');

    const times = d.time;
    const vals = d.river_discharge.map(function (v) { return typeof v === 'number' ? v : null; });

    let idx = times.indexOf(todayStr());
    if (idx < 0) idx = Math.max(0, times.length - CONFIG.forecastDays - 1);

    const hist = vals.slice(0, idx + 1).filter(function (v) { return v !== null; });
    if (!hist.length) throw new Error('Sem dados de rio para este ponto');

    const baseline = Math.max(median(hist), 0.01);
    const current = vals[idx] !== null ? vals[idx] : hist[hist.length - 1];

    let p = idx - 1;
    while (p >= 0 && vals[p] === null) p--;
    const prev = p >= 0 ? vals[p] : current;
    const change = prev > 0 ? (current - prev) / prev : 0;
    const trend = change > 0.03 ? 'up' : change < -0.03 ? 'down' : 'flat';

    let peak = current, peakIdx = idx;
    for (let i = idx + 1; i < vals.length; i++) {
      if (vals[i] !== null && vals[i] > peak) { peak = vals[i]; peakIdx = i; }
    }

    return {
      times: times, vals: vals, idx: idx,
      baseline: baseline,
      risk: baseline * CONFIG.ratioRisk,
      danger: baseline * CONFIG.ratioDanger,
      current: current,
      ratio: current / baseline,
      change: change, trend: trend,
      peak: peak, peakDate: times[peakIdx], peakRatio: peak / baseline
    };
  }

  async function loadFlood(city, force) {
    const key = city.lat.toFixed(3) + ',' + city.lon.toFixed(3);
    const hit = floodCache.get(key);
    if (!force && hit && Date.now() - hit.t < 5 * 60 * 1000) return hit.v;

    const url = FLOOD_URL +
      '?latitude=' + city.lat + '&longitude=' + city.lon +
      '&daily=river_discharge&past_days=' + CONFIG.pastDays +
      '&forecast_days=' + CONFIG.forecastDays +
      '&timezone=' + encodeURIComponent(CONFIG.tz);
    const v = analyzeFlood(await getJSON(url));
    floodCache.set(key, { t: Date.now(), v: v });
    return v;
  }

  async function loadRain(city) {
    const url = RAIN_URL +
      '?latitude=' + city.lat + '&longitude=' + city.lon +
      '&hourly=precipitation&past_days=1&forecast_days=2' +
      '&timezone=' + encodeURIComponent(CONFIG.tz);
    const j = await getJSON(url);
    const t = j.hourly.time;
    const v = j.hourly.precipitation.map(function (x) { return x || 0; });
    const now = nowHourStr();
    let i = t.findIndex(function (x) { return x >= now; });
    if (i < 0) i = t.length - 1;
    const sum = function (a, b) {
      return v.slice(Math.max(0, a), Math.max(0, b)).reduce(function (s, x) { return s + x; }, 0);
    };
    return { past24: sum(i - 24, i), next24: sum(i, i + 24) };
  }

  /* ===== Estado ===== */
  const state = { city: PRESETS[0], data: null, token: 0, timer: null };

  try {
    const saved = JSON.parse(localStorage.getItem('radar-cidade'));
    if (saved && typeof saved.lat === 'number' && typeof saved.lon === 'number' && saved.name) state.city = saved;
  } catch (e) { /* sem armazenamento: segue com o padrão */ }

  /* ===== Abas ===== */
  function switchTab(name) {
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false');
    });
    $('#tabPainel').hidden = name !== 'painel';
    $('#tabCidades').hidden = name !== 'cidades';
    if (name === 'painel') drawChart();
    if (name === 'cidades') {
      if (!$('#cityList').children.length) onSearch();
      $('#q').focus();
    }
  }
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () { switchTab(b.dataset.tab); });
  });

  /* ===== Painel ===== */
  function showAlert(msg) {
    const el = $('#alert');
    el.textContent = msg;
    el.hidden = false;
  }
  function hideAlert() { $('#alert').hidden = true; }

  function setLive(ok, text) {
    $('#liveText').textContent = text;
    $('.live').classList.toggle('is-off', !ok);
  }

  function setLoading() {
    $('#placeName').textContent = state.city.name + ' · RS';
    $('#statusText').textContent = 'Carregando…';
    $('#statusNote').textContent = 'Buscando dados do rio mais próximo.';
    setLive(true, 'Atualizando…');
  }

  function updateGauge(a) {
    const max = Math.max(a.danger * 1.3, a.current * 1.05);
    const pct = function (v) { return Math.min(100, (v / max) * 100); };

    const track = $('#gaugeTrack');
    track.style.setProperty('--p-risk', pct(a.risk) + '%');
    track.style.setProperty('--p-danger', pct(a.danger) + '%');
    $('#gaugeWater').style.height = pct(a.current) + '%';

    $('#tickRisk').style.bottom = pct(a.risk) + '%';
    $('#tickDanger').style.bottom = pct(a.danger) + '%';

    const now = $('#gaugeNow');
    now.style.bottom = pct(a.current) + '%';
    now.textContent = fmt(a.current) + ' m³/s';
  }

  function renderMetrics(a, rain, peakZone) {
    const rows = [
      ['Vazão agora', fmt(a.current) + ' m³/s'],
      ['Vazão normal (mediana de ' + CONFIG.pastDays + ' dias)', fmt(a.baseline) + ' m³/s'],
      ['Nível relativo', nf.format(a.ratio) + '× o normal'],
      ['Chuva nas últimas 24 h', rain ? nf.format(rain.past24) + ' mm' : 'indisponível'],
      ['Chuva prevista (24 h)', rain ? nf.format(rain.next24) + ' mm' : 'indisponível'],
      ['Pico previsto em ' + CONFIG.forecastDays + ' dias', fmt(a.peak) + ' m³/s em ' + shortDate(a.peakDate), 'z-' + ZONES[peakZone].key],
      ['Atualizado às', new Date().toLocaleTimeString('pt-BR')]
    ];
    const dl = $('#metrics');
    dl.innerHTML = '';
    rows.forEach(function (r) {
      const wrap = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = r[0];
      dd.textContent = r[1];
      if (r[2]) dd.className = r[2];
      wrap.append(dt, dd);
      dl.append(wrap);
    });
  }

  function render() {
    const a = state.data.a;
    const rain = state.data.rain;

    const riverZone = zoneOfRatio(a.ratio);
    const rainZone = rain ? zoneOfRain(rain.next24) : 0;
    const zone = Math.max(riverZone, rainZone);
    const peakZone = zoneOfRatio(a.peakRatio);
    const z = ZONES[zone];

    document.body.dataset.zone = z.key;
    $('#placeName').textContent = state.city.name + ' · RS';
    $('#statusText').textContent = z.label;

    let note = z.note;
    if (peakZone > zone) note += ' A previsão indica subida do rio nos próximos dias.';
    $('#statusNote').textContent = note;

    $('#qFlood').textContent = z.flood;
    $('#qRiver').textContent = riverLevelLabel(a.ratio);
    const pctTxt = (a.change >= 0 ? '+' : '') + nf.format(a.change * 100) + '% em 24 h';
    $('#qTrend').textContent =
      (a.trend === 'up' ? 'Subindo' : a.trend === 'down' ? 'Baixando' : 'Estável') + ' (' + pctTxt + ')';

    updateGauge(a);
    renderMetrics(a, rain, peakZone);

    chart.a = a;
    drawChart();

    setLive(true, 'Ao vivo · ' + new Date().toLocaleTimeString('pt-BR'));
  }

  async function refresh(initial) {
    const token = ++state.token;
    if (initial) setLoading();
    try {
      const results = await Promise.all([
        loadFlood(state.city, true),
        loadRain(state.city).catch(function () { return null; })
      ]);
      if (token !== state.token) return;
      state.data = { a: results[0], rain: results[1] };
      hideAlert();
      render();
    } catch (err) {
      if (token !== state.token) return;
      setLive(false, 'Sem conexão');
      showAlert('Não foi possível carregar os dados agora. Verifique sua internet. Uma nova tentativa acontece em 1 minuto.');
      if (!state.data) $('#statusText').textContent = 'Sem dados';
    }
  }

  function selectCity(c) {
    state.city = c;
    state.data = null;
    chart.a = null;
    try { localStorage.setItem('radar-cidade', JSON.stringify(c)); } catch (e) { /* ignora */ }
    switchTab('painel');
    refresh(true);
  }

  /* ===== Gráfico (canvas) ===== */
  const chart = { a: null, hover: -1 };
  const cvs = $('#chart');
  const ctx = cvs.getContext('2d');
  const tip = $('#tip');
  const PAD = { L: 48, R: 14, T: 14, B: 28 };

  function zoneColors() { return [css('--ok'), css('--risk'), css('--danger')]; }

  function drawChart() {
    const a = chart.a;
    if (!a || $('#tabPainel').hidden) return;

    const wrap = cvs.parentElement;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    cvs.width = Math.round(w * dpr);
    cvs.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const colors = zoneColors();
    const line = css('--line'), muted = css('--muted');
    const pw = w - PAD.L - PAD.R, ph = h - PAD.T - PAD.B;
    const n = a.vals.length;
    const real = a.vals.filter(function (v) { return v !== null; });
    const yMax = Math.max(a.danger * 1.15, Math.max.apply(null, real)) * 1.05;
    const X = function (i) { return PAD.L + (i / (n - 1)) * pw; };
    const Y = function (v) { return PAD.T + ph - (v / yMax) * ph; };

    ctx.font = '12px Archivo, system-ui, sans-serif';

    // faixas verde / amarela / vermelha
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = colors[0]; ctx.fillRect(PAD.L, Y(a.risk), pw, Y(0) - Y(a.risk));
    ctx.fillStyle = colors[1]; ctx.fillRect(PAD.L, Y(a.danger), pw, Y(a.risk) - Y(a.danger));
    ctx.fillStyle = colors[2]; ctx.fillRect(PAD.L, PAD.T, pw, Y(a.danger) - PAD.T);
    ctx.globalAlpha = 1;

    // área de previsão
    ctx.fillStyle = 'rgba(128,128,128,.10)';
    ctx.fillRect(X(a.idx), PAD.T, PAD.L + pw - X(a.idx), ph);

    // grade e rótulos do eixo Y
    ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.fillStyle = muted;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let k = 0; k <= 4; k++) {
      const v = (yMax * k) / 4;
      ctx.beginPath(); ctx.moveTo(PAD.L, Y(v)); ctx.lineTo(PAD.L + pw, Y(v)); ctx.stroke();
      ctx.fillText(fmt(v), PAD.L - 6, Y(v));
    }

    // rótulos do eixo X
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const step = Math.max(1, Math.round(n / 6));
    for (let i = 0; i < n; i += step) {
      if (i > a.idx - step / 2 && i < a.idx + step / 2 && i !== a.idx) continue;
      ctx.fillText(shortDate(a.times[i]), Math.min(Math.max(X(i), PAD.L + 14), PAD.L + pw - 14), PAD.T + ph + 8);
    }

    // limites de risco e perigo
    ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    [[a.risk, colors[1], 'Risco'], [a.danger, colors[2], 'Perigo']].forEach(function (t) {
      ctx.strokeStyle = t[1]; ctx.fillStyle = t[1];
      ctx.beginPath(); ctx.moveTo(PAD.L, Y(t[0])); ctx.lineTo(PAD.L + pw, Y(t[0])); ctx.stroke();
      ctx.fillText(t[2], PAD.L + 6, Y(t[0]) - 3);
    });
    ctx.setLineDash([]);

    // linha da vazão, colorida pela zona; tracejada na previsão
    ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < n - 1; i++) {
      if (a.vals[i] === null || a.vals[i + 1] === null) continue;
      ctx.strokeStyle = colors[zoneOfRatio(a.vals[i + 1] / a.baseline)];
      ctx.setLineDash(i >= a.idx ? [6, 5] : []);
      ctx.beginPath(); ctx.moveTo(X(i), Y(a.vals[i])); ctx.lineTo(X(i + 1), Y(a.vals[i + 1])); ctx.stroke();
    }
    ctx.setLineDash([]);

    // marcador de hoje
    const tz = colors[zoneOfRatio(a.ratio)];
    ctx.strokeStyle = muted; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(a.idx), PAD.T); ctx.lineTo(X(a.idx), PAD.T + ph); ctx.stroke();
    ctx.fillStyle = tz; ctx.strokeStyle = css('--card'); ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(X(a.idx), Y(a.current), 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('hoje', Math.min(X(a.idx), PAD.L + pw - 14), PAD.T + 2);

    // cursor ao passar o mouse / dedo
    if (chart.hover >= 0 && a.vals[chart.hover] !== null) {
      const i = chart.hover, v = a.vals[i];
      ctx.strokeStyle = muted; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(i), PAD.T); ctx.lineTo(X(i), PAD.T + ph); ctx.stroke();
      ctx.fillStyle = colors[zoneOfRatio(v / a.baseline)]; ctx.strokeStyle = css('--card'); ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(X(i), Y(v), 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

      tip.hidden = false;
      tip.textContent = shortDate(a.times[i]) + ' · ' + fmt(v) + ' m³/s · ' + nf.format(v / a.baseline) + '× o normal' +
        (i > a.idx ? ' (previsão)' : '');
      const tw = tip.offsetWidth;
      tip.style.left = Math.min(Math.max(X(i) - tw / 2, 4), w - tw - 4) + 'px';
    } else {
      tip.hidden = true;
    }
  }

  function onPointer(e) {
    const a = chart.a;
    if (!a) return;
    const rect = cvs.getBoundingClientRect();
    const pw = rect.width - PAD.L - PAD.R;
    const n = a.vals.length;
    let i = Math.round(((e.clientX - rect.left - PAD.L) / pw) * (n - 1));
    i = Math.min(Math.max(i, 0), n - 1);
    chart.hover = i;
    drawChart();
  }
  cvs.addEventListener('pointermove', onPointer);
  cvs.addEventListener('pointerdown', onPointer);
  cvs.addEventListener('pointerleave', function () { chart.hover = -1; drawChart(); });

  if (window.ResizeObserver) new ResizeObserver(drawChart).observe(cvs.parentElement);
  else window.addEventListener('resize', drawChart);
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawChart);
  }

  /* ===== Aba Cidades ===== */
  const input = $('#q');
  const list = $('#cityList');
  const info = $('#listInfo');
  let searchToken = 0, debounce = null;

  async function fillBadge(city, el) {
    try {
      const a = await loadFlood(city, false);
      const z = ZONES[zoneOfRatio(a.ratio)];
      el.className = 'badge badge-' + z.key;
      el.textContent = z.label;
    } catch (e) {
      el.className = 'badge';
      el.textContent = 'Sem dados';
    }
  }

  function renderCities(cities) {
    list.innerHTML = '';
    cities.forEach(function (c) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'city';

      const text = document.createElement('span');
      const name = document.createElement('span');
      const sub = document.createElement('span');
      name.className = 'city-name'; name.textContent = c.name;
      sub.className = 'city-sub'; sub.textContent = c.sub || 'RS';
      text.append(name, sub);

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Verificando…';

      btn.append(text, badge);
      btn.addEventListener('click', function () { selectCity(c); });
      li.append(btn);
      list.append(li);
      fillBadge(c, badge);
    });
  }

  async function onSearch() {
    const q = input.value.trim();
    const token = ++searchToken;

    if (q.length < 2) {
      info.textContent = 'Cidades em destaque. Digite o nome de uma cidade para buscar outra.';
      renderCities(PRESETS);
      return;
    }

    info.textContent = 'Buscando…';
    try {
      const j = await getJSON(GEO_URL + '?name=' + encodeURIComponent(q) + '&count=100&language=pt&format=json&countryCode=BR');
      if (token !== searchToken) return;

      const seen = {};
      const found = [];
      (j.results || []).forEach(function (r) {
        const isRS = (r.admin1 || '').toLowerCase().indexOf('rio grande do sul') !== -1;
        if (!isRS || seen[r.id]) return;
        seen[r.id] = true;
        found.push({ name: r.name, lat: r.latitude, lon: r.longitude, sub: 'RS' });
      });

      const shown = found.slice(0, 20);
      if (!shown.length) {
        info.textContent = 'Nenhuma cidade do RS encontrada para "' + q + '". Confira a grafia.';
        list.innerHTML = '';
        return;
      }
      info.textContent = shown.length + (shown.length === 1 ? ' cidade encontrada' : ' cidades encontradas') + '. Toque em uma para abrir o painel.';
      renderCities(shown);
    } catch (e) {
      if (token !== searchToken) return;
      info.textContent = 'Não foi possível buscar agora. Verifique sua internet e tente de novo.';
    }
  }

  input.addEventListener('input', function () {
    clearTimeout(debounce);
    debounce = setTimeout(onSearch, 350);
  });

  /* ===== Início ===== */
  refresh(true);
  state.timer = setInterval(function () { refresh(false); }, CONFIG.refreshMs);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh(false);
  });
})();