// Liga o telão mesmo quando você já tem uma status line.
// A status line antiga é guardada em telao-anterior.json e continua aparecendo, acima da linha do telão.
const fs = require('fs'), path = require('path'), os = require('os');
const arquivo = path.join(os.homedir(), '.claude', 'settings.json');
const telaoJs = path.join(__dirname, 'telao.js').replace(/\\/g, '/');
const anterior = path.join(__dirname, 'telao-anterior.json');

let cfg = {};
if (fs.existsSync(arquivo)) {
  const txt = fs.readFileSync(arquivo, 'utf8');
  try { cfg = txt.trim() ? JSON.parse(txt) : {}; }
  catch { console.log(`Não consegui ler ${arquivo}: o JSON tem um erro. Corrija e rode de novo.`); process.exit(1); }
  fs.writeFileSync(arquivo + '.antes-do-telao', txt);
}
const atual = cfg.statusLine;
if (atual && String(atual.command || '').includes(telaoJs)) { console.log('O telão já está ligado.'); process.exit(0); }
if (atual && /telao\.js/i.test(String(atual.command || ''))) {
  // era um telão de outra cópia do Escritório Pixel: só troca, não guarda
  console.log('Troquei o telão de outra pasta por este: ' + atual.command);
  try { fs.unlinkSync(anterior); } catch {}
} else if (atual) {
  fs.writeFileSync(anterior, JSON.stringify(atual, null, 2));
  console.log('Sua status line antiga foi guardada e vai continuar aparecendo, acima da linha do telão:');
  console.log('  ' + (atual.command || JSON.stringify(atual)));
}
cfg.statusLine = { type: 'command', command: `node "${telaoJs}"`, refreshInterval: 30 };
fs.writeFileSync(arquivo, JSON.stringify(cfg, null, 2));
console.log('Telão ligado! Feche e abra o claude para ver.');
