// Escritório Pixel — servidor local sem dependências.
//
// O que ele faz:
//  - recebe os eventos dos hooks do Claude Code (POST /hook) e a status line (POST /status);
//  - roda o próprio Claude Code quando você manda uma ordem pela página (agentes "da página");
//  - segura os pedidos de permissão desses agentes até você aprovar ou negar na página;
//  - lê o histórico das conversas de terminal para mostrar as respostas na página;
//  - manda tudo para a tela por Server-Sent Events (GET /eventos).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORTA = Number(process.env.ESCRITORIO_PORTA) || 4747;
const CLAUDE = process.env.ESCRITORIO_CLAUDE || 'claude';
const WIN = process.platform === 'win32';
const MAX_MESAS = 6;
const FILEIRAS = [[0, 1, 2], [3, 4, 5]];
const ARQ_AGENTES = path.join(__dirname, 'agentes.json');

const sessoes = new Map();   // id -> sessão (terminal ou da página)
const apelidos = new Map();  // session_id do Claude -> id da sessão da página
const telas = new Set();
const atividade = [];
let modoLivre = false;
const tela = { cinco: null, semana: null, atualizado: null };
const pastasVistas = new Set();

function hoje() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
const gastoEncerrado = { dia: hoje(), entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 };
const hora = () => new Date().toTimeString().slice(0, 5);
const horaSeg = () => new Date().toTimeString().slice(0, 8);
const nomeDaPasta = cwd => (cwd ? path.basename(String(cwd).replace(/[\\/]+$/, '')) : 'sessão');

// ---------- mesas: cada projeto ocupa uma fileira ----------
function mesaPara(pasta) {
  const usadas = new Map([...sessoes.values()].map(s => [s.mesa, s]));
  for (const f of FILEIRAS) {
    const doProjeto = f.some(m => usadas.has(m) && usadas.get(m).pasta === pasta);
    const livre = f.find(m => !usadas.has(m));
    if (doProjeto && livre != null) return livre;
  }
  for (const f of FILEIRAS) if (f.every(m => !usadas.has(m))) return f[0];
  for (let i = 0; i < MAX_MESAS; i++) if (!usadas.has(i)) return i;
  return -1;
}
function novaSessao(id, dir, web) {
  const pasta = nomeDaPasta(dir);
  const mesa = mesaPara(pasta);
  if (mesa < 0) { console.log('  (escritório lotado: 6 devs no máximo)'); return null; }
  const iguais = [...sessoes.values()].filter(o => o.pasta === pasta).length;
  const s = {
    id, pasta, dir: dir || '', nome: iguais ? `${pasta} (${iguais + 1})` : pasta, mesa, web: !!web,
    estado: 'cafe', tarefa: null, pedido: null, visitas: [], log: [], chat: [], visto: Date.now(),
    contexto: null, custo: 0, hist: { arquivo: null, pos: 0, resto: '', msgs: new Map() },
    rodando: false, proc: null, pendente: null, claudeId: null, rascunho: '', inicio: 0,
  };
  sessoes.set(id, s);
  if (dir) pastasVistas.add(dir);
  registrar(s, web ? 'Chegou pela página.' : 'Chegou pelo terminal.');
  return s;
}
function registrar(s, txt, cls) {
  s.log.push({ t: hora(), txt, cls });
  if (s.log.length > 60) s.log.shift();
  atividade.push({ t: horaSeg(), id: s.id, nome: s.nome, pasta: s.pasta, mesa: s.mesa, txt, cls });
  if (atividade.length > 80) atividade.shift();
}
function chat(s, item) {
  s.chat.push({ t: hora(), ...item });
  if (s.chat.length > 160) s.chat.splice(0, s.chat.length - 160);
}
function descrever(ferramenta, e) {
  const arq = p => (p ? path.basename(String(p)) : '');
  switch (ferramenta) {
    case 'Bash': case 'PowerShell': return 'Rodando: ' + String(e.command || '').slice(0, 80);
    case 'Read': return 'Lendo ' + arq(e.file_path);
    case 'Edit': case 'MultiEdit': return 'Editando ' + arq(e.file_path);
    case 'Write': return 'Criando ' + arq(e.file_path);
    case 'Grep': case 'Glob': return 'Procurando ' + String(e.pattern || '').slice(0, 40);
    case 'WebSearch': return 'Pesquisando: ' + String(e.query || '').slice(0, 50);
    case 'WebFetch': return 'Abrindo ' + String(e.url || 'uma página').slice(0, 60);
    case 'Task': case 'Agent': return e.subagent_type ? 'Chamou o técnico ' + e.subagent_type : 'Chamou um ajudante';
    case 'TodoWrite': return 'Atualizando a lista de tarefas';
    default: return 'Usando ' + ferramenta;
  }
}

// ---------- permissões ----------
const ARRISCADO = [
  [/\brm\s+-[a-z]*(rf|fr)\b|\bRemove-Item\b[^\n]*-Recurse/i, 'apagar pastas inteiras'],
  [/\bgit\s+push\b/i, 'git push'],
  [/\bgit\s+reset\s+--hard\b/i, 'git reset --hard'],
  [/\bgit\s+clean\s+-[a-z]*f/i, 'git clean'],
  [/\b(drop|truncate)\s+(table|database|schema)\b/i, 'apagar tabela ou banco'],
  [/\bdelete\s+from\b(?![\s\S]*\bwhere\b)/i, 'DELETE sem WHERE'],
  [/\bnetlify\s+deploy\b[^\n]*--prod/i, 'deploy em produção'],
  [/\b(vercel|firebase)\b[^\n]*(--prod|deploy)/i, 'deploy'],
  [/\bnpm\s+publish\b/i, 'publicar pacote'],
  [/\b(curl|wget|iwr|irm)\b[^|\n]*\|\s*(sudo\s+)?(sh|bash|iex)\b/i, 'baixar e executar script'],
  [/\b(mkfs|format)\b|\bdd\s+if=/i, 'formatar disco'],
  [/\bshutdown\b|\breboot\b|Stop-Computer|Restart-Computer/i, 'desligar o computador'],
];
const SO_LEITURA = new Set(['Read', 'Grep', 'Glob', 'LS', 'TodoWrite', 'Task', 'Agent', 'NotebookRead', 'ExitPlanMode']);
const ehEnv = inp => /(^|[\\/])\.env(\.|$)/.test(String(inp.file_path || ''));
function arriscado(e) {
  const inp = e.tool_input || {};
  if (ehEnv(inp)) return 'arquivo .env';
  if (['Bash', 'PowerShell'].includes(e.tool_name)) {
    const cmd = String(inp.command || '');
    for (const [re, nome] of ARRISCADO) if (re.test(cmd)) return nome;
  }
  return null;
}
// sessões de terminal: só decide algo com o modo livre ligado
function decidirTerminal(e) {
  if (!modoLivre) return null;
  const r = arriscado(e);
  if (r) return { decisao: 'ask', motivo: `Modo livre: ${r} sempre pede confirmação.` };
  return { decisao: 'allow', motivo: 'Modo livre ligado no Escritório Pixel.' };
}
// agentes da página: ninguém responde no terminal, então a página decide
function decidirWeb(e) {
  const r = arriscado(e);
  if (r) return { segurar: true, motivo: r };
  if (SO_LEITURA.has(e.tool_name)) return { decisao: 'allow', motivo: 'Leitura liberada pelo Escritório Pixel.' };
  if (modoLivre) return { decisao: 'allow', motivo: 'Modo livre ligado no Escritório Pixel.' };
  return { segurar: true };
}
function segurar(s, e, res, motivo) {
  if (s.pendente) responder(s, false, 'Outro pedido chegou antes deste ser respondido.');
  const id = crypto.randomBytes(4).toString('hex');
  const resumo = descrever(e.tool_name, e.tool_input || {});
  const timer = setTimeout(() => responder(s, false, 'Ninguém respondeu em 5 minutos.'), 290000);
  s.pendente = { id, res, timer };
  s.estado = 'esperando'; s.pedido = resumo;
  chat(s, { k: 'perm', id, txt: resumo, aviso: motivo ? `Cuidado: ${motivo}.` : '' });
  registrar(s, '✋ Quer permissão: ' + resumo, 'ask-l');
  enviarParaTelas();
}
function responder(s, aprovar, motivo) {
  const p = s.pendente;
  if (!p) return false;
  clearTimeout(p.timer);
  s.pendente = null;
  const item = s.chat.find(c => c.k === 'perm' && c.id === p.id);
  if (item) item.ok = aprovar;
  try {
    p.res.writeHead(200, { 'Content-Type': 'application/json' });
    p.res.end(JSON.stringify(aprovar
      ? { decisao: 'allow', motivo: 'Aprovado na página do Escritório Pixel.' }
      : { decisao: 'deny', motivo: motivo || 'Negado na página do Escritório Pixel.' }));
  } catch { /* o hook já desistiu */ }
  if (s.rodando) { s.estado = 'trabalhando'; s.pedido = null; }
  registrar(s, aprovar ? '✔ Você aprovou.' : '✖ Negado.', 'you');
  enviarParaTelas();
  return true;
}

// ---------- eventos dos hooks ----------
const ehTecnico = e => ['Task', 'Agent'].includes(e.tool_name) && e.tool_input && e.tool_input.subagent_type;

function sessaoDoEvento(e) {
  if (e._agente) return sessoes.get(e._agente) || null;
  const id = apelidos.get(e.session_id) || e.session_id;
  if (!id) return null;
  return sessoes.get(id) || novaSessao(id, e.cwd, false);
}
function tratar(e, res) {
  const ev = e.hook_event_name;
  console.log(`[${hora()}] ${ev} — ${nomeDaPasta(e.cwd)}${e._agente ? ' (página)' : ''}`);
  if (ev === 'SessionEnd') {
    const s = sessoes.get(e._agente || apelidos.get(e.session_id) || e.session_id);
    if (s && !s.web) encerrar(s.id);
    return false;
  }
  const s = sessaoDoEvento(e);
  if (!s) return false;
  s.visto = Date.now();
  if (e.transcript_path) s.hist.arquivo = e.transcript_path;
  switch (ev) {
    case 'UserPromptSubmit':
      s.visitas = [];
      if (!s.web) {
        s.tarefa = String(e.prompt || '').slice(0, 140);
        registrar(s, 'Nova tarefa: ' + s.tarefa, 'you');
      }
      s.estado = 'trabalhando'; s.pedido = null;
      break;
    case 'PreToolUse': {
      if (s.estado !== 'trabalhando' && !s.pendente) { s.estado = 'trabalhando'; s.pedido = null; }
      registrar(s, descrever(e.tool_name, e.tool_input || {}));
      if (ehTecnico(e)) s.visitas.push(e.tool_input.subagent_type);
      if (s.web) {
        const d = decidirWeb(e);
        if (d.segurar) { segurar(s, e, res, d.motivo); return true; }
        responderJSON(res, d); return true;
      }
      const d = decidirTerminal(e);
      if (d) {
        if (d.decisao === 'ask') registrar(s, '⚠ ' + d.motivo, 'ask-l');
        responderJSON(res, d); return true;
      }
      break;
    }
    case 'PostToolUse':
      if (s.estado === 'esperando' && !s.pendente) { s.estado = 'trabalhando'; s.pedido = null; }
      if (ehTecnico(e)) {
        const i = s.visitas.indexOf(e.tool_input.subagent_type);
        if (i >= 0) s.visitas.splice(i, 1);
        registrar(s, 'Técnico ' + e.tool_input.subagent_type + ' terminou', 'done');
      }
      break;
    case 'Notification': {
      const msg = String(e.message || '');
      if (/permission|permiss/i.test(msg) && !s.web) {
        s.estado = 'esperando'; s.pedido = msg;
        registrar(s, '✋ ' + msg, 'ask-l');
      }
      break;
    }
    case 'Stop':
      if (!s.web) { s.estado = 'pronto'; s.pedido = null; s.visitas = []; registrar(s, '✓ Terminei', 'done'); }
      break;
  }
  lerHistorico(s);
  return false;
}
function responderJSON(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// ---------- histórico (.jsonl): tokens de todas as sessões e chat das sessões de terminal ----------
const textoDe = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b && b.type === 'text').map(b => b.text).join('\n') : '');
function lerHistorico(s) {
  const h = s.hist;
  if (!h.arquivo) return;
  try {
    const tam = fs.statSync(h.arquivo).size;
    if (tam < h.pos) { h.pos = 0; h.resto = ''; }
    if (tam === h.pos) return;
    const fd = fs.openSync(h.arquivo, 'r');
    const buf = Buffer.alloc(tam - h.pos);
    fs.readSync(fd, buf, 0, buf.length, h.pos);
    fs.closeSync(fd);
    h.pos = tam;
    const linhas = (h.resto + buf.toString('utf8')).split('\n');
    h.resto = linhas.pop();
    for (const l of linhas) {
      let j;
      try { j = JSON.parse(l); } catch { continue; }
      const m = j.message;
      if (!m) continue;
      if (j.type === 'assistant' && m.usage) {
        const d = j.timestamp ? new Date(j.timestamp) : new Date();
        h.msgs.set(m.id || j.uuid, { u: m.usage, dia: d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() });
      }
      if (s.web || j.isSidechain || j.isMeta) continue;
      if (j.type === 'user') {
        const t = textoDe(m.content).trim();
        if (t && !t.startsWith('<')) chat(s, { k: 'voce', txt: t });
      } else if (j.type === 'assistant' && Array.isArray(m.content)) {
        for (const b of m.content) {
          if (b.type === 'text' && b.text && b.text.trim()) chat(s, { k: 'claude', txt: b.text });
          else if (b.type === 'tool_use') chat(s, { k: 'ferr', txt: descrever(b.name, b.input || {}) });
        }
      }
    }
  } catch { /* arquivo ainda não existe */ }
}
function somaDoDia(s) {
  const t = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 };
  const d = hoje();
  for (const { u, dia } of s.hist.msgs.values()) {
    if (dia !== d) continue;
    t.entrada += u.input_tokens || 0;
    t.saida += u.output_tokens || 0;
    t.cacheLeitura += u.cache_read_input_tokens || 0;
    t.cacheEscrita += u.cache_creation_input_tokens || 0;
  }
  return t;
}
function zerarSeVirouODia() {
  if (gastoEncerrado.dia !== hoje()) Object.assign(gastoEncerrado, { dia: hoje(), entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 });
}
function encerrar(id) {
  const s = sessoes.get(id);
  if (!s) return;
  lerHistorico(s);
  zerarSeVirouODia();
  const t = somaDoDia(s);
  for (const k of Object.keys(t)) gastoEncerrado[k] += t[k];
  if (s.proc) parar(s, true);
  if (s.claudeId) apelidos.delete(s.claudeId);
  if (tela.cinco && tela.cinco.exemplo && String(id).startsWith('teste-')) { tela.cinco = null; tela.semana = null; }
  registrar(s, 'Foi embora.');
  sessoes.delete(id);
}
function status(j) {
  const id = j._agente || apelidos.get(j.session_id) || j.session_id;
  const s = sessoes.get(id) || (j._agente ? null : novaSessao(id, j.workspace && j.workspace.current_dir || j.cwd, false));
  if (!s) return;
  if (j.transcript_path) s.hist.arquivo = j.transcript_path;
  if (j.context_window && j.context_window.used_percentage != null) s.contexto = j.context_window.used_percentage;
  if (j.cost && j.cost.total_cost_usd != null) s.custo = j.cost.total_cost_usd;
  const rl = j.rate_limits || {};
  const ex = !!j.exemplo;
  if (ex && (tela.cinco || tela.semana) && !(tela.cinco && tela.cinco.exemplo)) return lerHistorico(s);
  if (rl.five_hour) tela.cinco = { pct: rl.five_hour.used_percentage, reset: rl.five_hour.resets_at, exemplo: ex };
  if (rl.seven_day) tela.semana = { pct: rl.seven_day.used_percentage, reset: rl.seven_day.resets_at, exemplo: ex };
  if (rl.five_hour || rl.seven_day) tela.atualizado = Date.now();
  lerHistorico(s);
}

// ---------- agentes da página: o servidor roda o Claude Code ----------
function criarAgente(dir) {
  dir = String(dir || '').trim().replace(/^"(.*)"$/, '$1');
  if (!dir) return { erro: 'Diga a pasta do projeto.' };
  let st;
  try { st = fs.statSync(dir); } catch { return { erro: `Não achei a pasta "${dir}".` }; }
  if (!st.isDirectory()) return { erro: 'Isso é um arquivo, não uma pasta.' };
  const s = novaSessao('web-' + crypto.randomBytes(4).toString('hex'), path.resolve(dir), true);
  if (!s) return { erro: 'O escritório está lotado (6 devs). Dispense alguém primeiro.' };
  salvarAgentes();
  return { id: s.id };
}
function rodar(s, texto) {
  if (!s.web) return 'Esta conversa está num terminal: mande as ordens por lá.';
  if (s.rodando) return 'Este dev ainda está trabalhando. Espere terminar ou clique em Parar.';
  texto = String(texto || '').trim();
  if (!texto) return 'Escreva a ordem primeiro.';
  s.rodando = true; s.inicio = Date.now(); s.terminouOk = false;
  s.estado = 'trabalhando'; s.pedido = null; s.visitas = []; s.rascunho = '';
  s.tarefa = texto.slice(0, 140);
  chat(s, { k: 'voce', txt: texto });
  registrar(s, 'Nova tarefa: ' + s.tarefa, 'you');
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'default'];
  if (s.claudeId) args.push('--resume', s.claudeId);
  let p;
  try {
    p = spawn(CLAUDE, args, { cwd: s.dir, env: { ...process.env, ESCRITORIO_AGENTE: s.id }, shell: WIN, windowsHide: true });
  } catch (err) { fim(s, 'Não consegui iniciar o Claude Code: ' + err.message); return null; }
  s.proc = p;
  let buf = '', erro = '';
  p.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) linhaDoClaude(s, l); }
  });
  p.stderr.on('data', d => { erro = (erro + d).slice(-3000); });
  p.on('error', err => fim(s, `Não consegui iniciar o Claude Code (${err.message}). Confira se o comando "${CLAUDE}" funciona neste computador.`));
  p.on('close', code => {
    if (buf.trim()) linhaDoClaude(s, buf);
    const msg = s.parado ? null : (code && !s.terminouOk ? (erro.trim().split('\n').slice(-3).join(' ') || `O Claude parou (código ${code}).`) : null);
    fim(s, msg);
  });
  p.stdin.on('error', () => {});
  p.stdin.end(texto);
  enviarParaTelas();
  return null;
}
function linhaDoClaude(s, l) {
  let j;
  try { j = JSON.parse(l); } catch { return; }
  if (j.type === 'system' && j.subtype === 'init') {
    if (j.session_id && j.session_id !== s.claudeId) { s.claudeId = j.session_id; apelidos.set(j.session_id, s.id); salvarAgentes(); }
    return;
  }
  if (j.parent_tool_use_id) return; // mensagens dos técnicos (subagentes) ficam de fora do chat
  if (j.type === 'stream_event' && j.event) {
    const ev = j.event;
    if (ev.type === 'message_start') s.rascunho = '';
    else if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') { s.rascunho += ev.delta.text; enviarParaTelas(); }
    return;
  }
  if (j.type === 'assistant' && j.message && Array.isArray(j.message.content)) {
    for (const b of j.message.content) {
      if (b.type === 'text' && b.text && b.text.trim()) { chat(s, { k: 'claude', txt: b.text }); s.rascunho = ''; }
      else if (b.type === 'tool_use') chat(s, { k: 'ferr', txt: descrever(b.name, b.input || {}) });
    }
    enviarParaTelas();
    return;
  }
  if (j.type === 'result') {
    s.terminouOk = !j.is_error;
    if (j.is_error) chat(s, { k: 'erro', txt: String(j.result || 'O Claude terminou com erro.') });
    const negados = (j.permission_denials || []).length;
    const seg = Math.round((j.duration_ms || (Date.now() - s.inicio)) / 1000);
    chat(s, { k: 'fim', txt: `Terminou em ${seg < 60 ? seg + ' s' : Math.floor(seg / 60) + ' min ' + (seg % 60) + ' s'}` + (negados ? ` · ${negados} ação(ões) bloqueada(s)` : '') });
  }
}
function fim(s, erro) {
  if (!s.rodando && !erro) return;
  s.rodando = false; s.proc = null; s.rascunho = ''; s.parado = false;
  if (s.pendente) responder(s, false, 'O Claude parou.');
  if (erro) chat(s, { k: 'erro', txt: erro });
  s.estado = 'pronto'; s.pedido = null; s.visitas = [];
  registrar(s, erro ? '✖ Parou com erro' : '✓ Terminei', erro ? 'ask-l' : 'done');
  lerHistorico(s);
  salvarAgentes();
  enviarParaTelas();
}
function parar(s, quieto) {
  const p = s.proc;
  if (!p) return;
  s.parado = true;
  if (s.pendente) responder(s, false, 'Você parou o Claude.');
  try {
    if (WIN) spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true });
    else { p.kill('SIGINT'); setTimeout(() => { try { p.kill('SIGTERM'); } catch {} }, 3000); }
  } catch { /* já tinha saído */ }
  if (!quieto) chat(s, { k: 'erro', txt: 'Você parou o Claude.' });
}

// guarda os agentes da página para sobreviverem a um reinício do servidor
function salvarAgentes() {
  const lista = [...sessoes.values()].filter(s => s.web).map(s => ({ id: s.id, dir: s.dir, claudeId: s.claudeId, chat: s.chat.slice(-80), arquivo: s.hist.arquivo }));
  try { fs.writeFileSync(ARQ_AGENTES, JSON.stringify(lista, null, 1)); } catch { /* sem permissão de escrita */ }
}
function carregarAgentes() {
  let lista = [];
  try { lista = JSON.parse(fs.readFileSync(ARQ_AGENTES, 'utf8')); } catch { return; }
  for (const a of lista) {
    if (!a.dir || !fs.existsSync(a.dir)) continue;
    const s = novaSessao(a.id, a.dir, true);
    if (!s) continue;
    s.claudeId = a.claudeId || null;
    s.chat = Array.isArray(a.chat) ? a.chat : [];
    s.hist.arquivo = a.arquivo || null;
    if (s.claudeId) apelidos.set(s.claudeId, s.id);
    lerHistorico(s);
  }
}

// ---------- estado para a tela ----------
function estado() {
  zerarSeVirouODia();
  const gasto = { ...gastoEncerrado };
  const lista = [...sessoes.values()].map(s => {
    const t = somaDoDia(s);
    for (const k of Object.keys(t)) gasto[k] += t[k];
    return {
      id: s.id, nome: s.nome, pasta: s.pasta, dir: s.dir, mesa: s.mesa, web: s.web, estado: s.estado, tarefa: s.tarefa,
      pedido: s.pedido, visitas: s.visitas, log: s.log.slice(-30), contexto: s.contexto,
      tokens: t.entrada + t.saida + t.cacheLeitura + t.cacheEscrita, chat: s.chat.slice(-120), rascunho: s.rascunho,
      rodando: s.rodando, pendente: s.pendente ? s.pendente.id : null, inicio: s.inicio,
    };
  });
  return { sessoes: lista, tela, gasto, modoLivre, atividade: atividade.slice(-40), pastas: [...pastasVistas].slice(-12) };
}
let agendado = null;
function enviarParaTelas() {
  if (agendado) return;
  agendado = setTimeout(() => {
    agendado = null;
    const dados = `data: ${JSON.stringify(estado())}\n\n`;
    for (const res of telas) res.write(dados);
  }, 150);
}
function lerCorpo(req, fim2) {
  let corpo = '';
  req.on('data', c => { corpo += c; if (corpo.length > 2e6) req.destroy(); });
  req.on('end', () => { let j = null; try { j = JSON.parse(corpo || '{}'); } catch (err) { console.log('  JSON inválido:', err.message); } fim2(j || {}); });
}
const ok = (res, obj) => responderJSON(res, obj || { ok: true });
const falha = (res, msg, cod) => { res.writeHead(cod || 400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ erro: msg })); };

const servidor = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return fs.createReadStream(path.join(__dirname, 'public', 'index.html')).pipe(res);
  }
  if (req.method === 'GET' && url === '/eventos') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(estado())}\n\n`);
    telas.add(res);
    req.on('close', () => telas.delete(res));
    return;
  }
  if (req.method !== 'POST') { res.writeHead(404); return res.end('Não encontrado'); }

  if (url === '/hook') return lerCorpo(req, j => {
    const respondido = tratar(j, res);
    enviarParaTelas();
    if (!respondido) { res.writeHead(204); res.end(); }
  });
  if (url === '/status') return lerCorpo(req, j => { if (j.session_id) { status(j); enviarParaTelas(); } res.writeHead(204); res.end(); });
  if (url === '/modo-livre') return lerCorpo(req, j => {
    modoLivre = !!j.ligado;
    console.log(`[${hora()}] Modo livre ${modoLivre ? 'LIGADO' : 'desligado'}`);
    if (modoLivre) for (const s of sessoes.values()) if (s.pendente) responder(s, true);
    enviarParaTelas(); ok(res);
  });
  if (url === '/agentes') return lerCorpo(req, j => {
    const r = criarAgente(j.pasta);
    if (r.erro) return falha(res, r.erro);
    enviarParaTelas(); ok(res, r);
  });
  const m = url.match(/^\/agentes\/([^/]+)\/(mensagem|permissao|parar|dispensar)$/);
  if (m) return lerCorpo(req, j => {
    const s = sessoes.get(decodeURIComponent(m[1]));
    if (!s) return falha(res, 'Esse dev não está mais no escritório.', 404);
    if (m[2] === 'mensagem') { const erro = rodar(s, j.texto); if (erro) return falha(res, erro); }
    else if (m[2] === 'permissao') { if (!responder(s, !!j.aprovar)) return falha(res, 'Não tem pedido esperando resposta.'); }
    else if (m[2] === 'parar') parar(s);
    else if (m[2] === 'dispensar') { if (!s.web) return falha(res, 'Sessões de terminal saem quando você fecha o terminal.'); encerrar(s.id); salvarAgentes(); }
    enviarParaTelas(); ok(res);
  });
  res.writeHead(404); res.end('Não encontrado');
});

setInterval(() => {
  for (const res of telas) res.write(': ping\n\n');
  const limite = Date.now() - 3 * 60 * 60 * 1000;
  for (const [id, s] of sessoes) if (!s.web && s.visto < limite) encerrar(id);
  enviarParaTelas();
}, 20000);
// lê o histórico das conversas de terminal a cada 3 s (para as respostas aparecerem mesmo sem status line)
setInterval(() => {
  let mudou = false;
  for (const s of sessoes.values()) {
    if (!s.hist.arquivo) continue;
    const antes = s.chat.length + s.hist.msgs.size;
    lerHistorico(s);
    if (s.chat.length + s.hist.msgs.size !== antes) mudou = true;
  }
  if (mudou) enviarParaTelas();
}, 3000);

carregarAgentes();
servidor.listen(PORTA, '127.0.0.1', () => {
  console.log(`\n  Escritório Pixel aberto em http://localhost:${PORTA}\n  Deixe esta janela aberta. Ctrl+C para fechar.\n`);
});
servidor.on('error', err => {
  if (err.code === 'EADDRINUSE') console.log(`A porta ${PORTA} já está em uso. O servidor já está rodando em outra janela?`);
  else console.log(err);
  process.exit(1);
});
