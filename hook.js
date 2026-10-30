// Chamado pelo Claude Code a cada evento. Repassa o JSON para o servidor local.
// No PreToolUse, o servidor pode devolver uma decisão (aprovar, negar ou perguntar).
// Para os agentes criados pela página, o servidor segura o pedido até você responder na página.
// Se o servidor estiver fechado, sai quieto e o Claude Code segue normal.
const http = require('http');
const agente = process.env.ESCRITORIO_AGENTE || '';
const ESPERA = agente ? 295000 : 800;
let dados = '';
const sair = () => process.exit(0);
process.stdin.on('data', c => (dados += c));
process.stdin.on('end', () => {
  let j;
  try { j = JSON.parse(dados); } catch { return sair(); }
  if (agente) j._agente = agente;
  const corpo = JSON.stringify(j);
  const req = http.request({
    host: '127.0.0.1', port: Number(process.env.ESCRITORIO_PORTA) || 4747, path: '/hook', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) }, timeout: ESPERA,
  }, r => {
    let resp = '';
    r.on('data', c => (resp += c));
    r.on('end', () => {
      if (j.hook_event_name === 'PreToolUse' && resp) {
        try {
          const d = JSON.parse(resp);
          if (d.decisao) process.stdout.write(JSON.stringify({
            hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d.decisao, permissionDecisionReason: d.motivo },
          }));
        } catch { /* resposta estranha: não decide nada */ }
      }
      sair();
    });
  });
  req.on('error', sair);
  req.on('timeout', () => { req.destroy(); sair(); });
  req.end(corpo);
});
setTimeout(sair, ESPERA + 2000);
