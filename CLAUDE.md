# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Escritório Pixel is a pixel-art visualization tool for Claude Code that renders AI agents as animated characters in a virtual office. It provides a web interface to interact with Claude Code instances, monitor their activity, manage permissions, and track token usage—all without requiring API keys or npm dependencies.

## Commands

### Server
```bash
node server.js              # Start the local server (port 4747)
ESCRITORIO_PORTA=8080 node server.js  # Use custom port
```

### Installation/Uninstallation
```bash
node instalar.js            # Install hooks and status line into ~/.claude/settings.json
node desinstalar.js         # Remove hooks and restore backup
node ligar-telao.js         # Enable telão (status line) without removing existing status line
```

### Testing
```bash
node testar.js              # Run simulation test (~40s) to verify visualization
```

## Architecture

### Three-Process Model

1. **server.js** - HTTP server handling:
   - Receives hook events from Claude Code via POST /hook
   - Spawns Claude Code processes for web-based agents
   - Manages permission requests and holds them until user approval
   - Serves real-time updates via Server-Sent Events (GET /eventos)
   - Reads conversation transcripts (.jsonl) for token counting and chat history

2. **hook.js** - Hook bridge called by Claude Code on each event:
   - Forwards event JSON to server
   - For PreToolUse events, waits up to 5 minutes for permission decision
   - Fails silently if server is unreachable

3. **telao.js** - Status line script:
   - Sends rate limit data (5-hour, weekly) to server
   - Supports chaining with pre-existing status line via telao-anterior.json

### Session Management

- **Terminal sessions**: Tracked by Claude's session_id, created automatically on first event
- **Web sessions**: Created via POST /agentes, spawn Claude Code as child process
- **Session mapping**: `apelidos` Map links Claude session_id to internal session id
- **Persistence**: Web agents saved to agentes.json and restored on server restart

### Agent-Subagent Visualization

Not multi-agent communication—it's one agent delegating work:

- "Devs" = individual Claude Code sessions (terminal or web)
- "Técnicos" = subagents (Agent tool with subagent_type) spawned by a single dev
- Visual: When a dev calls a subagent, the "técnico" character walks from the tech room to the dev's desk
- server.js line 162: `ehTecnico` detects Tool use of type Agent/Task with subagent_type
- public/index.html lines 429-451: techGo/techHome handle pathfinding and state

### Permission System

Three decision sources (server.js lines 105-159):

1. **Arriscado patterns**: Always ask (git push, rm -rf, DROP TABLE, .env files, etc.)
2. **Read-only tools**: Auto-allow (Read, Grep, Glob, TodoWrite, Agent)
3. **Modo livre**: Auto-allow everything except arriscado patterns

For web agents, server holds the permission request and waits for user response via UI (up to 5 min timeout).

### Real-Time Communication

- **Server-Sent Events** (GET /eventos): Server pushes full state snapshot every 150ms when changes occur
- **State includes**: sessions, rate limits, token counts, activity log, chat history, pending permissions
- **Debouncing**: Uses setTimeout in enviarParaTelas() to batch updates

### Token Accounting

server.js lines 236-300:

- Reads .jsonl transcript files incrementally (offset/position tracking)
- Extracts usage from assistant messages: input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens
- Per-day summation: somaDoDia() calculates current day usage per session
- gastoEncerrado tracks tokens from closed sessions (prevents double-counting)

### Frontend Architecture (public/index.html)

Single-file SPA with no frameworks:

- **Canvas rendering**: All pixel art drawn programmatically via 2D context
- **drawAgent()** (line 730): Procedural character rendering based on state (trabalhando, esperando, pronto, cafe)
- **Técnicos animation**: techGo/techMove handle pathfinding from tech room to dev desk
- **Estado management**: Server sends full state snapshot; client reconciles DOM without losing focus
- **Chat system**: Real-time message display with permission approval UI

### File Structure

```
server.js           - Main HTTP server, session management, permission logic
hook.js             - Event forwarder (Claude Code → server)
telao.js            - Status line script (rate limits → server)
instalar.js         - Adds hooks to ~/.claude/settings.json with backup
desinstalar.js      - Restores original settings.json from backup
ligar-telao.js      - Chains telão with existing status line
testar.js           - Simulation for testing visualization
agentes.json        - Persisted web agent state (auto-generated)
public/index.html   - Complete frontend (HTML + CSS + JS in one file)
```

## Key Constraints

- **No external dependencies**: Pure Node.js stdlib only (http, fs, path, child_process, crypto)
- **No npm install required**: Intentional design choice
- **Windows compatibility**: Handles path separators, uses taskkill for process termination
- **Fails gracefully**: If server is down, hooks exit silently without blocking Claude Code

## Environment Variables

- `ESCRITORIO_PORTA`: Server port (default 4747)
- `ESCRITORIO_CLAUDE`: Path to claude executable (default 'claude')
- `ESCRITORIO_AGENTE`: Internal session ID injected for web agents

## State Machine (Dev States)

- `cafe`: Idle in break room
- `trabalhando`: Actively processing
- `esperando`: Waiting for permission
- `pronto`: Finished, celebrating
- `poltrona`: (técnicos only) Idle in tech room

## Editing Guidelines

### Server Changes

- Permission logic in decidirTerminal/decidirWeb must maintain security (arriscado patterns)
- enviarParaTelas() debouncing prevents excessive SSE traffic
- lerHistorico() incremental reading prevents re-parsing entire transcript files

### Frontend Changes

- Keep index.html as single file (intentional for portability)
- Canvas coordinate system: origin at top-left, Y increases downward
- All colors use CSS variables defined in :root
- drawAgent state animations tied to time parameter for smooth interpolation

### Hook Changes

- instalar.js must maintain backward compatibility with settings.json backup/restore
- PreToolUse hooks need 300s timeout (5 min for UI response); other events use 5s
- Hook matcher '*' required for PreToolUse/PostToolUse to intercept tool calls
