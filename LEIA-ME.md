# Escritório Pixel

Seus devs do Claude Code viram bonequinhos num prédio em pixel art, e você conversa com eles pela própria página:

- **Chat com o dev:** mande ordens e perguntas pela página, veja a resposta do Claude aparecendo em tempo real e aprove ou negue os pedidos de permissão com um clique.
- **Escritório:** cada projeto ocupa uma fileira de mesas; cada conversa do Claude Code é um dev.
- **Salão:** quem terminou vai jogar sinuca, fliperama, tomar café ou conversar nos pufes.
- **Sala dos Técnicos:** PO, UI/UX, Revisor, QA, Segurança, DevOps e Documentador ficam nas poltronas e sobem até a mesa quando um dev chama.
- **Telão:** quanto resta da janela de 5h e da semana, e quantos tokens foram gastos hoje.
- **Modo livre:** um interruptor no telão para os devs trabalharem sem pedir permissão.

Não precisa de login nem de chave de API, nem de `npm install`. Só precisa do Node.

## Passo a passo

1. **Descompacte** a pasta num lugar fixo, por exemplo `C:\escritorio-pixel`.
   Se mudar a pasta de lugar depois, rode o passo 4 de novo.

2. **Ligue o servidor.** No VS Code, abra a pasta e um terminal integrado (Terminal > Novo Terminal) e rode:

   ```
   node server.js
   ```

   Deixe esse terminal aberto e abra `http://localhost:4747` no navegador.
   No telão tem que aparecer "ao vivo". Esse terminal é só do servidor: o Claude roda em outro lugar.

3. **Teste sem o Claude.** Em outro terminal, na mesma pasta:

   ```
   node testar.js
   ```

   Em uns 40 segundos: um dev chega, o PO desce até ele, o dev levanta a mão,
   Revisor, QA e Segurança aparecem, o Documentador passa por último e o dev vai pro salão.
   O telão mostra números marcados como "exemplo do teste", que somem quando o teste acaba.

4. **Instale no Claude Code:**

   ```
   node instalar.js
   ```

   Ele faz backup do `~/.claude/settings.json`, adiciona os hooks e liga o telão (status line).
   Se você já tiver uma status line própria, ele avisa. Aí rode `node ligar-telao.js`: o telão liga e a sua
   status line antiga continua aparecendo, numa linha acima. O `desinstalar.js` devolve a antiga no lugar.

5. **Contrate um dev pela página:** clique em **+ Dev**, cole a pasta do projeto
   (por exemplo `C:\Users\Kauã Martins\Desktop\vivacare`) e clique em **Contratar**.
   O chat dele abre na hora: mande a primeira ordem e acompanhe a resposta ali mesmo.
   (Também dá para abrir o `claude` num terminal: esse dev aparece no escritório e as respostas dele
   aparecem no chat, mas as ordens dele vão pelo terminal.)

6. **Técnicos de verdade:** copie o kit do time para o projeto (veja o `COMO-USAR.md` do kit).
   Quando um dev chamar o subagente `revisor`, `qa`, etc., o técnico sobe até a mesa dele.

## Conversar pela página

- **+ Dev** contrata um dev numa pasta. Ele roda o próprio Claude Code do seu computador (`claude -p`),
  com o seu login. Não precisa de chave de API.
- Cada mensagem continua a mesma conversa, como no terminal. A conversa fica salva em `agentes.json`
  e volta se você reiniciar o servidor.
- **Permissões:** quando o dev quer editar arquivos ou rodar comandos, aparece um cartão "Posso fazer isto?"
  com **Aprovar** e **Negar**. Ler arquivos é liberado sem perguntar. Com o modo livre ligado, só o que é
  arriscado pergunta. Sem resposta em 5 minutos, o pedido é negado.
- **Parar** interrompe o dev no meio. **Dispensar** tira o dev do escritório.
- `git push` e deploy em produção, quando bloqueados pelo `settings.json` do projeto (como no kit do time),
  não rodam pela página: faça esses pelo terminal.
- Se o comando `claude` não funcionar no CMD/PowerShell, a página mostra o erro no chat.
  Se o Claude estiver instalado em outro lugar, defina `ESCRITORIO_CLAUDE` com o caminho antes do `node server.js`.

## No VS Code

**Um dev = uma conversa do Claude Code.** Você não precisa abrir vários CMDs.

- Uma conversa no painel do Claude = um dev.
- Quer dois devs trabalhando ao mesmo tempo? Abra outra conversa com **Open in New Tab**
  (`Ctrl+Shift+Esc`, ou Ctrl+Shift+P e "Claude Code: Open in New Tab"). Cada aba vira um dev.
- Duas conversas na mesma pasta aparecem como `euplus` e `euplus (2)`.
- Para cada dev mexer numa branch diferente sem esbarrar no outro, abra cada mesa (worktree) numa janela do VS Code.

**Telão com o uso real (5h e semana):** o uso chega pela status line, e a status line só roda no
**modo terminal** do Claude Code. No painel gráfico ela não roda, então o telão fica sem esses dois números.
Para ligar: Configurações do VS Code (`Ctrl+,`) > Extensions > Claude Code > marque **Use Terminal**.
O Claude passa a abrir como terminal dentro do próprio VS Code.

Se preferir continuar no painel gráfico, todo o resto funciona igual (devs, técnicos, gasto de tokens e modo livre).
Para ver a janela de 5h e a semana nesse caso, use `/usage` no próprio painel.

## Telão

| Quadro | De onde vem |
|---|---|
| Janela de 5h e Semana | Do próprio Claude Code (status line), em % restante, com o tempo até renovar |
| Gasto hoje | Soma dos tokens das conversas abertas hoje (saída, entrada e cache) |
| Contexto do dev | Toque no dev: quanto da memória da conversa já foi usada |

O Claude Code informa o limite em porcentagem, não em tokens. Por isso o "restante" é em %.
A janela de 5h e a semana aparecem para assinantes Pro e Max, depois da primeira resposta da sessão.

Acima de 85% usado, o telão fica amarelo e lembra de atualizar o handoff. Acima de 90%, fica vermelho.

## Modo livre

Ligue o interruptor no telão e os devs param de pedir permissão. O modo vale para todos os terminais na hora,
e desliga quando você desligar o interruptor ou fechar o servidor.

Mesmo ligado, estes comandos **sempre** pedem confirmação:

- apagar pastas (`rm -rf`), `git push`, `git reset --hard`, `git clean`
- `DROP`/`TRUNCATE` de tabela, `DELETE` sem `WHERE`
- deploy em produção (`netlify deploy --prod` e parecidos), `npm publish`
- baixar e executar script (`curl ... | sh`), formatar disco, desligar o PC
- ler ou mexer em arquivos `.env`

As regras de "perguntar" e "bloquear" do `settings.json` (como as do kit do time) continuam valendo por cima do modo livre.

Use o modo livre quando estiver trabalhando numa branch de card (worktree) e com o código no git,
para poder desfazer qualquer coisa. Pedidos que já estavam esperando no terminal antes de ligar ainda precisam de resposta lá.

## O que cada evento faz

| Evento do Claude Code | Na tela |
|---|---|
| `SessionStart` | O dev chega e vai pro salão |
| `UserPromptSubmit` | Vai pra mesa trabalhar |
| `PreToolUse` | Entra no log (lendo, editando, rodando…) e, no modo livre, aprova sozinho |
| `PreToolUse` chamando um subagente | O técnico levanta da poltrona e vai até a mesa |
| `PostToolUse` do subagente | O técnico volta pra Sala dos Técnicos |
| `Notification` de permissão | Levanta a mão |
| `Stop` | Dança e vai pro salão |
| `SessionEnd` | Vai embora |
| Status line | Atualiza o telão |

## Desligar

- Para tirar hooks e telão: `node desinstalar.js`
- O backup original fica em `~/.claude/settings.json.backup-escritorio`
- Se o servidor estiver fechado, nada muda no Claude Code: os hooks saem quietos e ele pede permissão normalmente.

## Problemas comuns

- **"A porta 4747 já está em uso"**: o servidor já está aberto em outra janela.
- **"Não consegui iniciar o Claude Code"** no chat: rode `claude --version` no mesmo terminal do servidor. Se não funcionar, instale o Claude Code (passo 1 do guia do CMD) e reinicie o `node server.js`.
- **Atualizou o Escritório?** Rode `node instalar.js` de novo: ele ajusta os hooks para os pedidos de permissão esperarem a sua resposta na página.
- **Nenhum dev aparece**: confira se reiniciou o Claude Code depois do passo 4 e se a janela do servidor mostra linhas como `[15:59] UserPromptSubmit — meu-projeto`.
- **Janela de 5h e semana vazias**: o Claude precisa estar no modo terminal (veja "No VS Code") e já ter respondido pelo menos uma vez. Com chave de API em vez de plano Pro/Max, esses dois quadros não existem; só o gasto aparece.
- **Números diferentes do /usage**: se aparecer "exemplo do teste" embaixo, são números do `testar.js`; eles somem quando o teste termina ou quando chega o dado real.
- **Quer outra porta**: defina a variável `ESCRITORIO_PORTA` antes de rodar o servidor e o Claude Code.
