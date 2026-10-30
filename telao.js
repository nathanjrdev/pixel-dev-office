// Status line do Claude Code: manda o uso para o telão e escreve uma linha curta no terminal.
// Se existir telao-anterior.json (sua status line antiga), ela roda junto e aparece na linha de cima.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let dados = '';
process.stdin.on('data', c => (dados += c));
process.stdin.on('end', () => {
  let j = {};
  try { j = JSON.parse(dados); } catch { /* segue com linha vazia */ }
  const rl = j.rate_limits || {};
  const p = v => (v == null ? '—' : Math.round(100 - v) + '%');
  const ctx = j.context_window && j.context_window.used_percentage;
  const linha = `🏢 restante 5h ${p(rl.five_hour && rl.five_hour.used_percentage)} · semana ${p(rl.seven_day && rl.seven_day.used_percentage)} · contexto ${ctx == null ? '—' : Math.round(ctx) + '%'}`;

  let pendentes = 2, antiga = '';
  const fim = () => { if (--pendentes > 0) return; process.stdout.write((antiga ? antiga + '\n' : '') + linha); process.exit(0); };

  // 1) status line antiga, se houver
  const arqAnterior = path.join(__dirname, 'telao-anterior.json');
  let cmd = null;
  try { cmd = JSON.parse(fs.readFileSync(arqAnterior, 'utf8')).command; } catch { /* não tem */ }
  if (cmd) {
    const filho = spawn(cmd, { shell: true, windowsHide: true });
    let saida = '';
    const parar = setTimeout(() => { try { filho.kill(); } catch {} }, 1500);
    filho.stdout.on('data', c => (saida += c));
    filho.on('error', () => {});
    filho.on('close', () => { clearTimeout(parar); antiga = saida.replace(/\s+$/, ''); fim(); });
    filho.stdin.on('error', () => {});
    filho.stdin.end(dados);
  } else fim();

  // 2) manda os dados para o servidor
  const req = http.request({
    host: '127.0.0.1', port: Number(process.env.ESCRITORIO_PORTA) || 4747, path: '/status', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) }, timeout: 400,
  }, r => { r.resume(); r.on('end', fim); });
  req.on('error', fim);
  req.on('timeout', () => { req.destroy(); });
  req.end(dados);
});
setTimeout(() => { process.stdout.write('🏢'); process.exit(0); }, 2500);
