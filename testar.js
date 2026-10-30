// Simula uma sessão do Claude Code para testar a tela sem usar o Claude de verdade.
// O dev chama o PO, trabalha, pede permissão e passa o card por revisor, QA e segurança.
const http = require('http');
const porta = Number(process.env.ESCRITORIO_PORTA) || 4747;
const base = { session_id: 'teste-' + Date.now(), cwd: 'C:/projetos/teste-pixel' };
const tec = (fase, tipo) => ({ hook_event_name: fase, tool_name: 'Agent', tool_input: { subagent_type: tipo, description: 'teste' } });
// números de exemplo para o telão: somem quando o teste acaba, e nunca passam por cima de dado real
const agora = Math.floor(Date.now() / 1000);
function telaoExemplo() {
  const corpo = JSON.stringify({ exemplo: true, session_id: base.session_id, cwd: base.cwd, context_window: { used_percentage: 27 },
    rate_limits: { five_hour: { used_percentage: 42, resets_at: agora + 3 * 3600 }, seven_day: { used_percentage: 18, resets_at: agora + 4 * 86400 } } });
  const req = http.request({ host: '127.0.0.1', port: porta, path: '/status', method: 'POST', headers: { 'Content-Type': 'application/json' } });
  req.on('error', () => {});
  req.end(corpo);
}
setTimeout(telaoExemplo, 500);
const passos = [
  [0, { hook_event_name: 'SessionStart' }],
  [2000, { hook_event_name: 'UserPromptSubmit', prompt: 'Arruma o botão de salvar que não funciona' }],
  [3000, tec('PreToolUse', 'po')],
  [11000, tec('PostToolUse', 'po')],
  [12000, { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'src/Botao.tsx' } }],
  [13500, { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'src/Botao.tsx' } }],
  [15000, { hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' }],
  [19000, { hook_event_name: 'PostToolUse', tool_name: 'Bash' }],
  [20000, tec('PreToolUse', 'revisor')],
  [20200, tec('PreToolUse', 'qa')],
  [20400, tec('PreToolUse', 'seguranca')],
  [30000, tec('PostToolUse', 'revisor')],
  [31000, tec('PostToolUse', 'seguranca')],
  [32000, tec('PostToolUse', 'qa')],
  [33000, tec('PreToolUse', 'documentador')],
  [40000, tec('PostToolUse', 'documentador')],
  [41000, { hook_event_name: 'Stop' }],
  [52000, { hook_event_name: 'SessionEnd' }],
];
function enviar(ev) {
  const corpo = JSON.stringify({ ...base, ...ev });
  const req = http.request({ host: '127.0.0.1', port: porta, path: '/hook', method: 'POST', headers: { 'Content-Type': 'application/json' } });
  req.on('error', () => { console.log('Não achei o servidor. Rode "node server.js" em outra janela primeiro.'); process.exit(1); });
  req.end(corpo);
  console.log('enviado:', ev.hook_event_name, ev.tool_input && ev.tool_input.subagent_type || '');
}
passos.forEach(([ms, ev]) => setTimeout(() => enviar(ev), ms));
setTimeout(() => console.log('Teste terminado: o dev de teste foi embora e o telão voltou a esperar os dados reais.'), 53000);
