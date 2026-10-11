# Abort Mission

6-player social deduction demo for friends over a voice call. Host runs it on their PC and shares a Cloudflare tunnel link.
Stack: Node.js + `ws`, one in-memory room, vanilla JS client. Files: `server.js`, `public/index.html`, `public/music.m4a`.
Git repo (local only, no remote), branch main.

## Docs (read only what the task needs)
- `docs/game-design.md` - roles, codes, win rule, chat, wiretap, DEFCON, languages, music, chosen defaults. Read before changing gameplay.
- `docs/running-and-testing.md` - start server/tunnel, test safely, gotchas that already cost time. Read before running or testing anything.

## Status (2026-10-11)
Built and tested with scripts (+ browser for older parts): lobby/host/join with ROOM CODE, cards, survivor console, private chat (send-as x address by name/role), DEFCON + READY, EN/IT, music, random leader names, ROLES compendium, hidden corrupt teammate, chat toggle.
Added this session (scripts only, not seen in a browser yet): bots reply to and start chats; DESTROY CHAT (both sides, any time); wiretap at 30 s and once per DEFCON; Survivor always human; music volume halved at every slider point; Intelligence LEAK FILE to Mass Media; Mass Media PUBLISH (only leaked files, redactions, once per DEFCON); President passive (always redacted in leaks). Details in docs/game-design.md.
Later: one code attempt only (wrong code = game over, "WRONG CODE â€” NUKES HIT" screen; tested by bot sim, not in a browser). Survivor can only send as name and cannot be addressed by role (server-enforced; script + browser checked on spare ports). Foreign Affairs EMBASSY ability (IT name "Ministro degli Esteri"; script test 11/11 + browser panel check). Survivor CODE CHECK once per match (script 16/16 + browser). Bot sim results in docs/game-design.md.
Newest (2026-10-11): CODE CHECK unlocks at DEFCON 4, COMMIT console unlocks at DEFCON 3, max 5 new chats per player per DEFCON (was 3), roles panel renamed UNREDACTED FILES (script 11/11 + browser check of lock text). Then: 5-min timer per DEFCON (runs out = drop; at DEFCON 1 = NUKES HIT), data-tick sound on incoming chat message (chosen from 3 previews), alarm on DEFCON change (script + browser checked). Host-only PAUSE/RESUME for the timer (script 6/6 + browser). Host-only CLOSE MATCH back to lobby (script 6/6 + browser). Bots never repeat a line in a match (shared pool of 34, then silence; script checked). Bots now type like people: skip ~1/4 messages, sometimes reply late (8-20 s), lowercase or capitalised at random per message, occasional typos and slang (script checked, not seen in a browser). Bots also post updates in old chats and start chats more often (every 4 s, 45%); destroy chat works any time (script checked, not seen in a browser). Bot sim results predate all of this.
2026-10-12: match chat log in `logs/match-*.jsonl` (start, every message, destroy, end; script checked on port 3040). End screen shows ALL MATCH CHATS to everyone, destroyed ones marked (script + browser checked on 3041).  Bots never ignore: reply after random 5-30 s, timer restarts on each new message (script: 10/10 one reply, 6-28 s). Live server not restarted yet, so it does not log until restarted.
- LIVE SERVER (port 3000) restarted 2026-10-12 with all current code (M4); room was empty. Restart again after any server.js change (only when room is empty or user says so).
- Tunnel: cloudflared at `C:Program Files (x86)cloudflaredcloudflared.exe` (not on PATH), `tunnel --url http://localhost:3000`, log in tunnel.log. Last link: https://anybody-supported-brake-freeze.trycloudflare.com (changes on restart).
- Music file `public/music.m4a`: origin unconfirmed. Cannot listen to audio.
- Old test servers may still run on ports 3001, 3002, 3003, 3010 (4 extra node.exe processes seen). Two cloudflared tunnels to 3000 are running (PIDs 8392, 29752); only one is needed (this session's 3020-3024 were stopped). Ask before killing any node you did not start.
- Committed locally in git (no remote backup).

## Next step
1. Browser check of the new UI (destroy button, PUBLISH, LEAK FILE, LEAKS box) on a spare port with 4 tabs.
2. Friends open the link, playtest (verdict green/yellow/red).
3. Improve bot strategies (see "Deductions from the sims" in docs/game-design.md), rerun sim with CODE CHECK. Open questions in docs/game-design.md (bot lines, Media leaking own chats, DEFCON 1 ending, etc.); next role ability (Army General).

## Known mistakes
- A patch put an unescaped ' in a page string and broke the whole page (also on the live port, which serves the same file). After editing index.html, run the parse check in docs/running-and-testing.md.
- Left a test browser tab connected to a test port; it took a seat and broke a script test. Navigate the tab away before scripted tests.
- Scripted tests against the live port left the room in a started game ("Game already started"). Test on a separate port.
