// 角色配色：pet.json 里只写 4 个基础色，其余深浅色在这里推出来
const DEFAULT_THEME = { ink: '#4a3b2a', panel: '#fffdf6', card: '#fff3a8', accent: '#ffd76a' };

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, t) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

function applyTheme(theme) {
  const t = { ...DEFAULT_THEME, ...(theme || {}) };
  const vars = {
    '--ink': t.ink,
    '--text': mix(t.ink, '#000000', 0.25),
    '--muted': mix(t.ink, t.panel, 0.35),
    '--panel-bg': t.panel,
    '--card-bg': t.card,
    '--accent': t.accent,
    '--divider': mix(t.ink, t.panel, 0.8),
    '--done-bg': mix(t.card, '#e6e6e6', 0.7),
    '--input-bg': mix(t.card, '#ffffff', 0.6),
    '--input-border': mix(t.card, t.ink, 0.3),
    '--bubble-bg': mix(t.card, '#ffffff', 0.25),
  };
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
}

applyTheme(null);
