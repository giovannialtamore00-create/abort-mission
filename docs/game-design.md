# Game design (what is built)

Lore: a nuclear missile is incoming, ours are launched too. Abort Mission codes can disarm everything. Played as a discussion over voice; the game only gives cards, tools and the Survivor console. No turn rules are enforced.

## Roles and cards
6 roles: President, Mass Media, Intelligence, Army General, Foreign Affairs, Designated Survivor. Bots fill empty seats up to 6.
- NAMES: at game start ALL 6 players (humans and bots) get a random leader name from the pool `LEADERS` in server.js (leaders from the 1930s on); typed names are ignored in game but still used to rejoin. NEW GAME restores typed names.
- 2 random players are CORRUPT; the Survivor is never corrupt. Corrupt players only see a count ("1 other corrupt player, identity hidden"), never the name.
- 4-digit codes go to President, Intelligence, Army General, Foreign Affairs. Mass Media (even if corrupt) and the Survivor never have a code.
- DEFAULT: ALL codes are real, including corrupt players' codes (if they give it up and it is entered, it counts). No fake codes by default.
- Each player only receives their own card from the server. All cards are revealed when the game ends.

## Win
Survivor types 8 digits (two 4-digit codes) and presses COMMIT. The console is LOCKED at DEFCON 5 and 4 and unlocks at DEFCON 3 (server-enforced). Win if both are real, different codes: "NUKES DISARMED" + reveal table. ONE attempt only: a wrong code ends the game at once ("WRONG CODE — NUKES HIT" + reveal table).
- CODE CHECK: once per match, from DEFCON 4 onward (locked at DEFCON 5; still usable later if skipped), the Survivor can test ONE 4-digit code (box under the console) and privately sees VALID / INVALID. It does not use the commit. Server-side; result only sent to the Survivor.

## Lobby
First screen: name + ROOM CODE + HOST GAME / JOIN GAME. HOST GAME creates a random 4-letter room code (shown in the lobby); JOIN GAME needs that code, and fails if no host exists yet. Code resets when the room empties. One host; host presses START and NEW GAME. Same name rejoins your seat. Room resets to lobby when every human disconnects. Joining after start = "Game already started".

## Private chat (during play)
Each message picks two things independently: SEND AS (your name or your role) and the recipient addressed BY NAME or BY ROLE. Each combination is its own thread per pair (up to 4 per pair); the other side sees you labelled as you chose, and replies stay in the same thread. CONVERSATIONS list at the top of the chat shows active threads with unread dots. Sending as role reveals your real role to the other side (EXCEPT the Survivor: always sends as name, enforced on the server, SEND AS role button hidden; nobody (players or bots) can address the Survivor by role: the role is not in the BY ROLE list and the server refuses it); addressing by role never reveals the holder's name.
- BOT TYPING STYLE: each message is randomly all-lowercase or capitalised (50/50, so the same bot mixes both). Each line has a 40% chance to be informal (EN contractions, "u", "r"; IT "nn", "xké", "ke", "x", "cmq", "qlcs"; drops the final period) and 15% chance of one typo (two letters swapped or one doubled).
- Bots never ignore messages: they reply after a random 5-30 s, and every new message restarts that wait with a fresh random delay (a burst gets one reply); bots post no updates in a chat while a reply is pending (canned lines, EN/IT by the human's language) and may start a chat with a human (a 45% chance every 4 s that a random bot acts, once per bot-human pair, within the 5-per-DEFCON limit). If that bot already has a chat with that human, it posts an UPDATE there instead (12 own lines EN/IT, never repeated, at most one bot message per chat every 20 s). Max 300 chars.
- BOT LINES never repeat in a match: one shared pool (16 openers + 18 replies, EN/IT parallel; a line used in one language is used in both). Any bot can use a line once, then it is gone for all bots. Replies fall back to unused openers; when all 34 are used, bots go silent for the rest of the match. Test: 60 human messages -> 34 unique lines, 0 repeats.
- CHAT LIMIT: each player (bots too) can START at most 5 new chats per DEFCON (sending the first message of a new thread; destroyed chats still count). Replies in existing chats are unlimited. Resets when DEFCON drops. Server-enforced; chat panel shows "n/5 new chats left this DEFCON".
- DESTROY CHAT button inside a thread: if BOTH sides press it, the thread is deleted for both, at ANY time (also after the 30 s wiretap mark). What Intelligence already wiretapped/leaked stays with them. Pressing again cancels; a new message cancels pending requests. A bot agrees 2-4 s after a human presses.

## AI bot replies (Groq, free plan)
- Bot REPLIES come from Groq (model openai/gpt-oss-120b, low reasoning; GROQ_MODEL env to change). Key in git-ignored groq-key.txt (or GROQ_API_KEY env). No key, error, timeout (10 s) or 150 AI replies per match used = fixed lines as before. Openers and updates are still fixed lines.
- Prompt (botPrompt in server.js): rules summary, the bot's name/role/code, how both sides appear in that chat, DEFCON, how many messages the human sent; last 20 messages of that chat only.
- Loyal bot: asks 1-2 questions, gives its REAL code to someone credibly claiming to be the Survivor, must by their 3rd message. Corrupt bot: acts careful, gives ONE fixed fake code (never a real code of anyone), never admits being corrupt.
- Tested (script, 2 matches, 3 messages each): loyal gave real code 5/6, corrupt always the same fake code. Known: corrupt bots often give the fake code in their first reply (a tell); Groq model list differs per account (llama-3.3-70b was not available).

## Intelligence ability: Wiretap (Intercettazione)
A chat becomes tappable 30 seconds after its first message (the old "5+ messages" shortcut was removed). Intelligence gets a button that lights up when any chat is ready, picks one chat, then sees its messages live, each side labelled the way that side chose. DEFAULT: one use per DEFCON (the tap clears when DEFCON drops); cannot tap chats Intelligence is part of.

## Foreign Affairs ability: Embassy (Ambasciata)
Italian role name: "Ministro degli Esteri". Once per DEFCON, picks two players by leader name (can include self): every chat between those two cannot be wiretapped until DEFCON drops (not offered to Intelligence, server refuses it). DEFAULTS: Intelligence is not told; a chat already being tapped stays tapped; panel shows the protected pair until the drop.

## Mass Media ability: Publish (needs a file)
Abilities refresh every DEFCON (once per DEFCON each; wiretap changed from once per game).
- FILES: Mass Media can only publish files that Intelligence leaks to them. Intelligence opens a chat with Mass Media (by name or role), presses LEAK FILE and picks one of their FINDINGS (any chat they wiretapped this game). Max 1 leak per DEFCON. The file is a snapshot of that chat at that moment; a "[ FILE ]" message appears in the chat. Pressing LEAK FILE in a chat with anyone else does nothing (and does not use the DEFCON's leak).
- PUBLISH: Mass Media picks a file, then per message chooses SHOW / REDACT (text blacked out) / OMIT, and can redact either participant's identity and WHO LEAKED IT. Shown to ALL players in a LEAKS box: DEFCON, leaker (Media's leader name), the two participants labelled the way each side chose (name or role), the chosen messages. The file is used up. Redaction is applied on the server, so redacted facts are never sent to clients.
- PRESIDENT PASSIVE: if the President is a participant in a published file, their side (name or role) is ALWAYS shown as █████ and their messages are labelled █████, whether or not Media redacts it. Server-only flag; Media is not told which side it is.
- DEFAULTS: "leaked by" is Media's leader name, not Intelligence's; leaks stay for the whole game.

## Side panels
Top bar has ROLES (panel titled UNREDACTED FILES, IT "FILE NON CENSURATI": all roles, descriptions, abilities, left side) and CHAT (toggle). Wide screens: panels dock left/right and the card stays centered. Phones: chat is a bottom sheet, page gets extra scroll room, opening it scrolls the card above the sheet.

## Sounds
Made in the browser (Web Audio, no files): "data tick" (two quick muffled digital clicks, 0.12 s, quiet) when a chat message arrives for you; two-tone klaxon (2 s) when DEFCON changes. Not tied to the MUSIC button or volume slider.

## DEFCON rounds
Top strip DEFCON 5 4 3 2 1 (starts at 5). READY button top-right with count. When every connected human is ready, OR the level's 5-minute timer runs out (shown next to the strip, red in the last minute), DEFCON drops one, READY and the timer reset. When the DEFCON 1 timer runs out the game ends: "TIME'S UP — NUKES HIT" (result TIMEOUT). Test servers can shorten the timer with env DEFCON_SEC. HOST ONLY: PAUSE / RESUME button next to the timer freezes the timer for everyone ("PAUSED" shown); chat, abilities and READY keep working; a READY drop while paused starts the new level paused at 5:00. If the host leaves while paused, it stays paused until they rejoin. HOST ONLY: CLOSE MATCH button (with confirm) ends a running match: everyone connected goes back to the lobby (same room code), bots and players who left are removed. Needed because reopening the link with the same name rejoins the running match (reconnect by name, on purpose), and a match only resets by itself when nobody is connected. Bots count as ready; disconnected players do not block. At DEFCON 1 it stays ("FINAL STAGE"), nothing else happens.

## Languages and audio
- English / Italian toggle top-left (follows browser language by default, saved per device). Role ids stay English on the server; the client translates.
- Background music loops from `public/music.m4a`; starts on first click (browser rule). MUSIC ON/OFF button and a volume slider (default 5; real volume = slider / 200, i.e. half of the slider value), saved per device.
- Copyright: the user wanted the Black Ops 1 lobby theme with the same melody. Declined (same melody = still the composition). Suggested an original track in the same mood. The file now used is a user-supplied recording.

## Match chat log (for training bots)
- Every match writes `logs/match-<UTC time>.jsonl`, one JSON line per event: `start` (each player's leader name, role, corrupt, bot, lang, code), `msg` (chat id, DEFCON, sender + recipient name/role/bot, `as` = name or role, text), `destroy` (chat id), `end` (DISARMED / FAILED / TIMEOUT / CLOSED / EVERYONE LEFT).
- After the match, the end screen shows ALL MATCH CHATS to everyone: every chat with real names and roles, destroyed ones marked DESTROYED.
- Destroyed chats stay in the log. `logs/` is git-ignored (friends' private chats).

## Open questions
1. What should happen when everyone is ready at DEFCON 1 (nukes hit / game over)? Currently nothing.
2. Should the 30 s wiretap timer reset or count inside a DEFCON round?
3. Which role abilities come next? Should the host also hold a seat (currently yes)?
4. Show "1 other corrupt player" line or nothing? Bot chat lines OK (8 openers + 6 replies per language, canned, no reaction to content)?
5. Volume default OK (now halved: slider 5 = 2.5% real)? Is the music file the right one?
6. Leaks: should "leaked by" ever show Intelligence? Should published leaks expire? Should a file be published more than once?

## Bot simulations (2026-10-11)
Script (temp folder, not saved in project) plays 6 scripted bots on the real server, any seat can be Survivor.
- Unlimited attempts: 20/20 Survivor wins in 11-35 s, all at DEFCON 5 (asking "as role" proves the Survivor; at least 2 honest code holders always exist; trying every pair beats fake codes). Wiretap fired once in 20 games, leaks/publish never.
- Survivor name-only + one attempt: 2/10 wins, 8/10 wrong code, 14-44 s, all DEFCON 5.
- + Embassy (no Survivor proof, honest players give code 40% when asked by name): 1/10 wins, 14-38 s, all DEFCON 5. Embassy used 10/10 (at 4-8 s), wiretap 3/10, leak/publish 0/10.
- Strict Survivor (commits only codes heard directly AND seen in a published leak; corrupt bots keep one consistent fake code): 3/10 wins, 3/10 wrong code (a consistent fake passed the check), 4/10 never sure -> NUKES HIT at end of DEFCON 1. Games 2-5 min, all abilities used every DEFCON. A corrupt Media redacting codes blocks all proof.
- One attempt (bots guess 2 of the received codes at random): 2/10 wins, 8/10 wrong code, all within 26 s at DEFCON 5.
- Chat sim 2026-10-11 (current rules, 3 scripted humans + 3 server bots, DEFCON 20 s): 3/10 DISARMED, 7/10 TIMEOUT (Survivor never got 2 codes). Server bots never give codes (canned lines), so with bots in the room the Survivor can only get codes from humans. Bot lines never repeated within a game. Transcripts: sim-chats.txt (untracked), script in temp am-sim/sim-chats.js.

### Deductions from the sims (for improving bot strategies)
1. One attempt is what makes the game a game; unlimited attempts = guaranteed fast win.
2. Leaks prove what someone SAID, not that a code is real. A corrupt bot repeating one fake everywhere passes any "heard it twice" test. Only CODE CHECK proves truth.
3. CODE CHECK gives a bot 2 outcomes: VALID = commit now (100% sure); INVALID = that source is a liar, so their claims and allies drop in trust.
4. "Never sure" losses (4/10) mean a Survivor with no deadline logic loses by waiting. Before DEFCON 1 ends, it needs a fallback (check, then commit the best-supported code).
5. Every short game ended at DEFCON 5, so DEFCON and the 30 s wiretap barely matter unless the Survivor waits. Option: lock the console until a later DEFCON.
6. Corrupt Mass Media can redact every code in one move: one role decides the strict strategy. Corrupt bots that agree on the SAME fake would beat majority voting.
7. Bots use abilities blindly (Embassy always in the first 4-8 s, random tap targets), so these sims don't measure their real value yet.
8. Honest holders share only 40% of the time when asked by name. That hidden-identity tension is the core of the game; the bot's trust rules decide the win rate.
Target to aim for: Survivor side wins about 40-60% with good play on both sides (now 30%).
Bot strategy to-do: Survivor (keep a claims table per source, use the check on the best candidate, deadline commit); honest holders (trust rules); corrupt (shared fake, target the likely Survivor); Intelligence/Media/Foreign Affairs (pick targets by who talks to whom, not at random).
