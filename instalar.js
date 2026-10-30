// Adiciona os hooks do Escritório Pixel no ~/.claude/settings.json (faz backup antes).
const fs = require('fs'), path = require('path'), os = require('os');
const arquivo = path.join(os.homedir(), '.claude', 'settings.json');
const hookJs = path.join(__dirname, 'hook.js').replace(/\\/g, '/');
const comando = `node "${hookJs}"`;
const telaoJs = path.join(__dirname, 'telao.js').replace(/\\/g, '/');
const EVENTOS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd'];
const COM_MATCHER = ['PreToolUse', 'PostToolUse'];

let cfg = {};
if (fs.existsSync(arquivo)) {
  const txt = fs.readFileSync(arquivo, 'utf8');
  try { cfg = txt.trim() ? JSON.parse(txt) : {}; }
  catch { console.log(`Não consegui ler ${arquivo}: o JSON tem um erro. Corrija e rode de novo.`); process.exit(1); }
  if (!fs.existsSync(arquivo + '.backup-escritorio')) {
    fs.writeFileSync(arquivo + '.backup-escritorio', txt);
    console.log('Backup salvo em ' + arquivo + '.backup-escritorio');
  }
} else fs.mkdirSync(path.dirname(arquivo), { recursive: true });

cfg.hooks = cfg.hooks || {};

// limpa restos de outras cópias do Escritório Pixel (por exemplo, uma pasta descompactada duas vezes)
const deOutraCopia = (cmd, arq) => {
  const c = String(cmd || '').replace(/\\/g, '/');
  return /escritorio-pixel/i.test(c) && c.includes('/' + arq) && !c.includes(arq === 'hook.js' ? hookJs : telaoJs);
};
let removidos = 0;
for (const ev of Object.keys(cfg.hooks)) {
  if (!Array.isArray(cfg.hooks[ev])) continue;
  cfg.hooks[ev] = cfg.hooks[ev]
    .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => { const velho = deOutraCopia(h.command, 'hook.js'); if (velho) removidos++; return !velho; }) }))
    .filter(g => g.hooks.length);
  if (!cfg.hooks[ev].length) delete cfg.hooks[ev];
}
if (removidos) console.log(`Removi ${removidos} hooks de uma cópia antiga do Escritório Pixel.`);
if (cfg.statusLine && deOutraCopia(cfg.statusLine.command, 'telao.js')) {
  console.log('Troquei o telão de uma cópia antiga por este.');
  delete cfg.statusLine;
}
const anteriorJson = path.join(__dirname, 'telao-anterior.json');
try { if (/telao\.js/i.test(fs.readFileSync(anteriorJson, 'utf8'))) { fs.unlinkSync(anteriorJson); console.log('Apaguei o telao-anterior.json (era do telão antigo).'); } } catch {}
let novos = 0;
for (const ev of EVENTOS) {
  const lista = (cfg.hooks[ev] = cfg.hooks[ev] || []);
  // o PreToolUse pode esperar sua resposta na página (até 5 min); os outros eventos são rápidos
  const limite = ev === 'PreToolUse' ? 300 : 5;
  const meus = lista.flatMap(g => (g.hooks || []).filter(h => String(h.command || '').includes(hookJs)));
  if (meus.length) { meus.forEach(h => { h.timeout = limite; }); continue; }
  const grupo = { hooks: [{ type: 'command', command: comando, timeout: limite }] };
  if (COM_MATCHER.includes(ev)) grupo.matcher = '*';
  lista.push(grupo); novos++;
}
// telão: a status line manda o uso (5h, semana, tokens) para o servidor
let telao = '';
if (!cfg.statusLine) {
  cfg.statusLine = { type: 'command', command: `node "${telaoJs}"`, refreshInterval: 30 };
  telao = 'Telão ligado (status line instalada).';
} else if (String(cfg.statusLine.command || '').includes(telaoJs)) {
  telao = 'O telão já estava instalado.';
} else {
  telao = 'Você já tem uma status line própria, então o telão ainda não foi ligado.\nPara ligar sem perder a sua, rode:  node ligar-telao.js';
}
fs.writeFileSync(arquivo, JSON.stringify(cfg, null, 2));
console.log(telao);
console.log(novos ? `Pronto! ${novos} hooks adicionados em ${arquivo}` : 'Os hooks já estavam instalados.');
console.log('Feche e abra o Claude Code de novo para ele carregar os hooks.');
