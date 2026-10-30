// Remove só os hooks do Escritório Pixel do ~/.claude/settings.json.
const fs = require('fs'), path = require('path'), os = require('os');
const arquivo = path.join(os.homedir(), '.claude', 'settings.json');
const hookJs = path.join(__dirname, 'hook.js').replace(/\\/g, '/');
if (!fs.existsSync(arquivo)) { console.log('Nada para remover.'); process.exit(0); }
const cfg = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
for (const ev of Object.keys(cfg.hooks || {})) {
  cfg.hooks[ev] = cfg.hooks[ev]
    .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !String(h.command || '').includes(hookJs)) }))
    .filter(g => g.hooks.length);
  if (!cfg.hooks[ev].length) delete cfg.hooks[ev];
}
if (cfg.hooks && !Object.keys(cfg.hooks).length) delete cfg.hooks;
const telaoJs = path.join(__dirname, 'telao.js').replace(/\\/g, '/');
if (cfg.statusLine && String(cfg.statusLine.command || '').includes(telaoJs)) {
  const anterior = path.join(__dirname, 'telao-anterior.json');
  if (fs.existsSync(anterior)) { cfg.statusLine = JSON.parse(fs.readFileSync(anterior, 'utf8')); console.log('Sua status line antiga voltou.'); }
  else delete cfg.statusLine;
}
fs.writeFileSync(arquivo, JSON.stringify(cfg, null, 2));
console.log('Hooks e telão do Escritório Pixel removidos.');
