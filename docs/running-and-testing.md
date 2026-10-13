# Running and testing

## Run for friends
1. `cd C:\Users\giova\abort-mission` then `node server.js` (default port 3000; `PORT=3001 node server.js` for another).
2. `cloudflared tunnel --url http://localhost:3000` prints a `https://....trycloudflare.com` link (free, no account, new link each run). Output also goes to `tunnel.log` if redirected.
3. Everyone opens the link; the host presses HOST GAME, others JOIN GAME.
Restarting node drops everyone; they refresh. The tunnel can stay up while node restarts. Static files (index.html, music) are read on every request, but `server.js` changes need a restart.

## Testing safely (lessons)
- NEVER script against port 3000 while friends may be in the room; use a spare port (3001-3003 are in use by old test servers).
- Every scripted client must be closed at the end, or the room stays in a started game.
- A browser tab left on a test port auto-reconnects and takes a seat; navigate it away first.
- Max 6 seats: a 6-human script test guarantees a human holds every role (e.g. Intelligence).
- Long bash heredocs can fail on this machine; write patch/test scripts with the Write tool and run them, delete afterwards.
- The Browser pane screenshot sometimes times out; retry. Prefer `javascript_tool` text checks for logic.
- `.m4a` from Downloads has a hidden special character in its name; use PowerShell `Get-ChildItem -Filter *.m4a` and `Copy-Item -LiteralPath`.
- Python is NOT installed; patch files with Edit or a small `node -` script.
- The Survivor can be any seat, bots included (since M32), so a script with 1 human gets a bot Survivor about 5 times in 6; a bot Survivor never gets a human role slot guaranteed, use 6 humans to control roles.
- Scripts outside the project must `require('C:/Users/giova/abort-mission/node_modules/ws')` (Windows path, not /c/...).
- Chats become tappable only after 30 s, so wiretap/leak tests take ~35 s.

## Verified so far
Scripts: 3-player chat routing, DEFCON/READY flow (including disconnect and new game), range requests for audio, bot replies + bot-started chats, destroy chat (both sides, before 30 s; refused after), Intelligence -> Mass Media file leak (only to Media, 1 per DEFCON), Media publish with redactions (only from files, 1 per DEFCON), President always redacted. Browser (older): top strip, READY, Italian text, volume slider.
Not yet checked in a browser: destroy button, PUBLISH panel, LEAK FILE picker, LEAKS box. Not tested: wiretap freeing up after DEFCON drops. Not yet done: a real multi-person playtest.
- After editing public/index.html, check it parses: `node -e "const s=require('fs').readFileSync('public/index.html','utf8');new Function(s.slice(s.indexOf('<script>')+8,s.lastIndexOf('</script>')));console.log('ok')"`
- `DEFCON_SEC=3 PORT=3030 node server.js` makes each DEFCON last 3 s for timer tests (timer is checked once per second, so allow +1 s).
