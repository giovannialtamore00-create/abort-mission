const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const SEATS = 6;
const SURVIVOR = 'Designated Survivor';
const ROLES = {
  'President': 'Leader of the nation. Holds an Abort Mission code.',
  'Mass Media': 'Controls the public narrative. Never holds a code.',
  'Intelligence': 'Knows what others do not. Holds an Abort Mission code.',
  'Army General': 'Commands the military. Holds an Abort Mission code.',
  'Foreign Affairs': 'Speaks to the world. Holds an Abort Mission code.',
  [SURVIVOR]: 'Only one left to act. Find 2 working codes and enter them on the console. Never corrupt, never holds a code.',
};

const room = { phase: 'lobby', players: [], host: null, result: null, attempts: 0, chats: [], chatSeq: 0, leaks: [], findings: [], files: [], fileSeq: 0, leakDefcon: null, pubDefcon: null, tap: null, embassy: null, embDefcon: null, check: null, defcon: 5, ready: new Set(), started: new Map() };

const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const LEADERS = [
  'F. Roosevelt', 'Truman', 'Eisenhower', 'Kennedy', 'Reagan', 'Clinton', 'Bush', 'Obama', 'Biden', 'Trump',
  'Churchill', 'Attlee', 'Thatcher', 'Blair', 'Sunak', 'De Gaulle', 'Mitterrand', 'Macron', 'Pétain',
  'Adenauer', 'Brandt', 'Kohl', 'Merkel', 'Mussolini', 'De Gasperi', 'Berlusconi', 'Meloni', 'Schuman',
];
const roomCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ'[Math.floor(Math.random() * 23)]).join('');
const code4 =() => String(Math.floor(Math.random() * 10000)).padStart(4, '0');

function deal() {
  const humans = room.players.filter((p) => !p.isBot);
  room.players = humans;
  while (room.players.length < SEATS) room.players.push({ name: 'Bot', isBot: true, ws: null });
  // everyone (humans and bots) gets a random leader name; the typed name is kept only to recognise reconnects
  const names = shuffle(LEADERS);
  room.players.forEach((p) => { if (!p.isBot && !p.joinName) p.joinName = p.name; p.name = names.pop(); });
  // the Survivor is always a human (bots can't type the codes): pick one first, then deal the other roles to everyone else
  const seats = shuffle(room.players);
  const sIdx = seats.findIndex((p) => !p.isBot);
  [seats[0], seats[sIdx]] = [seats[sIdx], seats[0]];
  const roles = [SURVIVOR, ...shuffle(Object.keys(ROLES).filter((r) => r !== SURVIVOR))];
  seats.forEach((p, i) => { p.role = roles[i]; p.corrupt = false; p.code = null; p.realCode = false; });
  shuffle(seats.filter((p) => p.role !== SURVIVOR)).slice(0, 2).forEach((p) => (p.corrupt = true));
  const used = new Set();
  const fresh = () => { let c; do c = code4(); while (used.has(c)); used.add(c); return c; };
  seats.forEach((p) => {
    if (p.role === SURVIVOR || p.role === 'Mass Media') return;
    p.code = fresh();
    p.realCode = true; // every code works, even if a corrupt player gives it up
  });
  room.realCodes = new Set(seats.filter((p) => p.realCode).map((p) => p.code));
  room.phase = 'play';
  room.result = null;
  room.attempts = 0;
  room.chats = [];
  room.chatSeq = 0;
  room.leaks = [];
  room.findings = [];
  room.files = [];
  room.leakDefcon = null;
  room.pubDefcon = null;
  room.tap = null;
  room.embassy = null;
  room.embDefcon = null;
  room.check = null;
  room.started = new Map();
  room.usedLines = new Set();
  room.defcon = 5;
  room.defconEnds = Date.now() + DEFCON_MS;
  room.ready = new Set();
}

// a chat can be wiretapped 30 seconds after its first message; until then both sides can destroy it together
const TAP_MS = 30000;
const tappable = (t) => Date.now() - t.firstAt >= TAP_MS;
// Foreign Affairs ability: chats between the two protected players can't be wiretapped until DEFCON drops
const sheltered = (t) => !!room.embassy && room.embassy.includes(t.a) && room.embassy.includes(t.b);
// EN and IT lists are parallel: index i is the same line in both languages
const BOT_SAY = {
  en: ['Who are you really?', 'I do not trust anyone here.', 'Do you have a code?', 'Something feels off about this room.', 'Tell me what you know.', 'I think one of us is corrupt.', 'We are running out of time.', 'Can you vouch for the Survivor?',
    'Have you spoken to the Survivor yet?', 'Someone is lying about their code.', 'Which side are you on?', 'I heard a rumor about you.', 'Keep this chat between us.', 'Who do you suspect?', 'The clock is not on our side.', 'I might know something useful.'],
  it: ['Chi sei davvero?', 'Non mi fido di nessuno qui.', 'Hai un codice?', 'Qualcosa non quadra in questa stanza.', 'Dimmi cosa sai.', 'Penso che uno di noi sia corrotto.', 'Stiamo finendo il tempo.', 'Puoi garantire per il Sopravvissuto?',
    'Hai già parlato con il Sopravvissuto?', 'Qualcuno mente sul proprio codice.', 'Da che parte stai?', 'Ho sentito una voce su di te.', 'Teniamo questa chat tra noi.', 'Di chi sospetti?', "L'orologio non è dalla nostra parte.", 'Forse so qualcosa di utile.'],
};
const BOT_REPLY = {
  en: ['Interesting. Go on.', 'I cannot say much.', 'Why do you ask?', 'I am not the one you should worry about.', 'Maybe. Who else have you talked to?', 'I will think about it.',
    'That is what they all say.', 'Prove it.', 'I would be careful with that.', 'Not here. Not now.', 'Who told you that?', 'I have heard otherwise.', 'You first.', 'Hmm. Noted.', 'I am watching the others.', 'Trust is expensive today.', 'Ask me again later.', 'That does not add up.'],
  it: ['Interessante. Continua.', 'Non posso dire molto.', 'Perché lo chiedi?', 'Non sono io quello di cui preoccuparti.', 'Forse. Con chi altro hai parlato?', 'Ci penso su.',
    'È quello che dicono tutti.', 'Dimostralo.', 'Starei attento con questo.', 'Non qui. Non ora.', "Chi te l'ha detto?", 'Ho sentito diversamente.', 'Prima tu.', 'Mmm. Preso nota.', "Sto tenendo d'occhio gli altri.", 'La fiducia costa cara oggi.', 'Chiedimelo più tardi.', 'Non torna.'],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];
// shared pool: each line is said at most once per match by any bot (in either language);
// replies fall back to unused openers, and when everything is used the bots go quiet
function botLine(kind, lang) {
  const pools = kind === 'reply' ? [['r', BOT_REPLY], ['s', BOT_SAY]] : [['s', BOT_SAY]];
  for (const [k, lists] of pools) {
    const free = lists.en.map((_, i) => i).filter((i) => !room.usedLines.has(k + i));
    if (free.length) { const i = pick(free); room.usedLines.add(k + i); return lists[lang][i]; }
  }
  return null;
}
const later = (min, max, fn) => setTimeout(fn, min + Math.random() * (max - min));
const langOf = (p) => (p.lang === 'it' ? 'it' : 'en');
// each player can start at most 5 new chats per DEFCON (replies in existing chats are free)
const CHATS_PER_DEFCON = 5;
const chatsLeft = (p) => CHATS_PER_DEFCON - (room.started.get(p) || 0);
const findThread = (me, other, as, mode) => room.chats.find((c) => (c.a === me && c.b === other && c.am === as && c.bm === mode) || (c.a === other && c.b === me && c.bm === as && c.am === mode));
// find the thread for this pair + modes, or create it (counts toward the starter's limit)
function threadFor(me, other, as, mode) {
  let t = findThread(me, other, as, mode);
  if (!t) { room.started.set(me, (room.started.get(me) || 0) + 1); t = { id: ++room.chatSeq, a: me, b: other, am: as, bm: mode, msgs: [], firstAt: Date.now(), kill: new Set() }; room.chats.push(t); setTimeout(broadcast, TAP_MS + 100); }
  return t;
}
// both sides pressed destroy in time: the chat is gone
function finishKill(t) { if (t.kill.has(t.a) && t.kill.has(t.b)) room.chats = room.chats.filter((c) => c !== t); }
// bots answer every message sent to them, a few seconds later
function botReply(t, bot) {
  const human = t.a === bot ? t.b : t.a;
  later(2000, 5000, () => {
    if (room.phase !== 'play' || !room.chats.includes(t)) return;
    const text = botLine('reply', langOf(human));
    if (!text) return;
    t.msgs.push({ from: bot, text });
    broadcast();
  });
}
// every few seconds a bot may start a chat with a human it has not talked to yet
setInterval(() => {
  if (room.phase !== 'play' || Math.random() > 0.3) return;
  const bots = room.players.filter((x) => x.isBot), humans = room.players.filter((x) => !x.isBot && x.ws);
  if (!bots.length || !humans.length) return;
  const bot = pick(bots), human = pick(humans);
  if (chatsLeft(bot) <= 0) return;
  if (room.chats.some((c) => (c.a === bot && c.b === human) || (c.a === human && c.b === bot))) return;
  const text = botLine('say', langOf(human));
  if (!text) return;
  const t = threadFor(bot, human, pick(['name', 'role']), human.role === SURVIVOR ? 'name' : pick(['name', 'role'])); // nobody can address the Survivor by role
  t.msgs.push({ from: bot, text });
  broadcast();
}, 6000);
// each side of a chat picks how it shows up (name or role): t.am for side a, t.bm for side b
const sideMode = (t, x) => (x === t.a ? t.am : t.bm);
const sideLabel = (t, x) => (sideMode(t, x) === 'name' ? x.name : x.role);

// a round ends when every connected human is ready or its 5 minutes run out; DEFCON counts down 5 -> 1
const DEFCON_MS = (+process.env.DEFCON_SEC || 300) * 1000; // DEFCON_SEC only for quick tests
function dropDefcon() { room.defcon--; room.ready.clear(); room.tap = null; room.embassy = null; room.started = new Map(); room.defconEnds = Date.now() + DEFCON_MS; }
function advanceIfReady() {
  const humans = room.players.filter((x) => !x.isBot && x.ws);
  if (room.phase === 'play' && room.defcon > 1 && humans.length && humans.every((x) => room.ready.has(x))) dropDefcon();
}
// time's up: DEFCON drops; at DEFCON 1 the nukes hit
setInterval(() => {
  if (room.phase !== 'play' || Date.now() < room.defconEnds) return;
  if (room.defcon > 1) dropDefcon(); else { room.phase = 'ended'; room.result = 'TIMEOUT'; }
  broadcast();
}, 1000);

function cardOf(p) {
  return { role: p.role, desc: ROLES[p.role], corrupt: p.corrupt, code: p.code };
}

function viewFor(p) {
  const v = {
    phase: room.phase,
    you: p.name,
    host: room.host === p,
    code: room.code,
    hasHost: !!room.host,
    names: room.players.map((x) => x.name),
    attempts: room.attempts,
    result: room.result,
  };
  if (room.phase !== 'lobby' && p.role) {
    v.card = cardOf(p);
    if (p.corrupt) v.partnerCount = room.players.filter((x) => x.corrupt && x !== p).length; // names stay hidden
  }
  if (room.phase === 'play' && p.role) {
    // private chats: threads are per unordered pair + mode; labels follow the mode (name or role)
    v.chats = room.chats.filter((t) => t.a === p || t.b === p).map((t) => {
      const o = t.a === p ? t.b : t.a;
      return { id: t.id, canKill: !tappable(t), killMine: t.kill.has(p), killOther: t.kill.has(o), as: sideMode(t, p), mode: sideMode(t, o), with: sideLabel(t, o),
        msgs: t.msgs.map((m) => ({ mine: m.from === p, label: sideLabel(t, m.from), lm: sideMode(t, m.from), text: m.text })) };
    });
    // names and roles are sent as separate lists so they can't be matched up
    v.chatNames = room.players.filter((x) => x !== p).map((x) => x.name);
    v.chatRoles = Object.keys(ROLES).filter((r) => r !== p.role && r !== SURVIVOR);
    const humans = room.players.filter((x) => !x.isBot && x.ws);
    v.defcon = room.defcon;
    v.defconLeft = Math.max(0, room.defconEnds - Date.now()); // ms left, so client clocks don't matter
    v.chatsLeft = chatsLeft(p);
    v.leaks = room.leaks;
    if (p.role === 'Mass Media') {
      v.pubUsed = room.pubDefcon === room.defcon;
      v.files = room.files.map((f) => ({ id: f.id, a: f.a, b: f.b, msgs: f.msgs })); // files only exist once Intelligence has handed them over
    }
    if (p.role === 'Foreign Affairs') v.emb = { used: room.embDefcon === room.defcon, a: room.embassy && room.embassy[0].name, b: room.embassy && room.embassy[1].name };
    if (p.role === 'Intelligence') {
      v.leakUsed = room.leakDefcon === room.defcon;
      v.findings = room.findings.map((t) => ({ id: t.id, am: t.am, bm: t.bm, a: sideLabel(t, t.a), b: sideLabel(t, t.b), count: t.msgs.length }));
    }
    if (p.role === SURVIVOR) v.check = room.check; // private: only the Survivor sees the check result
    v.ready = room.ready.has(p);
    v.readyTotal = humans.length;
    v.readyCount = humans.filter((x) => room.ready.has(x)).length;
    if (p.role === 'Intelligence') {
      const t = room.tap;
      v.tap = t
        ? { used: true, am: t.am, bm: t.bm, a: sideLabel(t, t.a), b: sideLabel(t, t.b), msgs: t.msgs.map((m) => ({ label: sideLabel(t, m.from), lm: sideMode(t, m.from), text: m.text })) }
        : { used: false, options: room.chats.filter((c) => c.a !== p && c.b !== p && tappable(c) && !sheltered(c)).map((c) => ({ id: c.id, am: c.am, bm: c.bm, a: sideLabel(c, c.a), b: sideLabel(c, c.b) })) };
    }
  }
  if (room.phase === 'ended') {
    v.reveal = room.players.map((x) => ({ name: x.name, ...cardOf(x), real: x.realCode }));
  }
  return v;
}

function broadcast() {
  for (const p of room.players) if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(viewFor(p)));
}

function onMessage(ws, msg) {
  let me = ws.player;
  if (msg.type === 'join') {
    const name = String(msg.name || '').trim().slice(0, 16);
    if (!name) return;
    if (!msg.host && (!room.code || String(msg.code || '').trim().toUpperCase() !== room.code)) return ws.send(JSON.stringify({ error: 'Wrong room code' }));
    me = room.players.find((p) => !p.isBot && (p.joinName || p.name).toLowerCase() === name.toLowerCase());
    if (me) { me.ws = ws; }
    else {
      if (room.phase !== 'lobby') return ws.send(JSON.stringify({ error: 'Game already started' }));
      if (room.players.length >= SEATS) return ws.send(JSON.stringify({ error: 'Room is full' }));
      me = { name, joinName: name, isBot: false, ws, lang: msg.lang === 'it' ? 'it' : 'en' };
      room.players.push(me);
    }
    if (msg.host) {
      if (room.host && room.host !== me && room.host.ws) ws.send(JSON.stringify({ error: 'Room already has a host' }));
      else { room.host = me; if (!room.code) room.code = roomCode(); }
    }
    ws.player = me;
    return broadcast();
  }
  if (!me) return;
  const isHost = room.host === me;
  if (msg.type === 'start' && isHost && room.phase === 'lobby') { deal(); broadcast(); }
  else if (msg.type === 'newgame' && isHost) {
    room.players = room.players.filter((p) => !p.isBot);
    room.players.forEach((p) => { delete p.role; p.name = p.joinName || p.name; });
    room.phase = 'lobby'; room.result = null; room.chats = []; room.tap = null; room.embassy = null; room.defcon = 5; room.ready = new Set(); broadcast();
  } else if (msg.type === 'commit' && room.phase === 'play' && me.role === SURVIVOR && room.defcon <= 3) { // console unlocks at DEFCON 3
    const d = String(msg.digits || '');
    room.attempts++;
    const a = d.slice(0, 4), b = d.slice(4);
    const ok = /^\d{8}$/.test(d) && a !== b && room.realCodes.has(a) && room.realCodes.has(b);
    // one attempt only: a wrong code ends the game
    room.phase = 'ended'; room.result = ok ? 'DISARMED' : 'FAILED';
    broadcast();
  } else if (msg.type === 'check' && room.phase === 'play' && me.role === SURVIVOR && !room.check && room.defcon <= 4) {
    // one code check per match, from DEFCON 4: tests a single 4-digit code without using the commit
    const d = String(msg.code || '');
    if (!/^\d{4}$/.test(d)) return;
    room.check = { code: d, ok: room.realCodes.has(d) };
    broadcast();
  } else if (msg.type === 'chat' && room.phase === 'play') {
    const text = String(msg.text || '').trim().slice(0, 300);
    const mode = msg.mode === 'role' ? 'role' : 'name'; // how the recipient is addressed
    // how I show up; the Survivor can only write as their name
    const as = me.role === SURVIVOR ? 'name' : msg.as === 'role' ? 'role' : msg.as === 'name' ? 'name' : mode;
    const other = room.players.find((x) => x !== me && (mode === 'role' ? x.role === msg.to : x.name === msg.to));
    if (!text || !other || (mode === 'role' && other.role === SURVIVOR)) return; // the Survivor can't be addressed by role
    if (!findThread(me, other, as, mode) && chatsLeft(me) <= 0) return; // no new chats left this DEFCON
    const t = threadFor(me, other, as, mode);
    t.msgs.push({ from: me, text });
    t.kill.clear(); // a new message cancels any destroy requests
    broadcast();
    if (other.isBot) botReply(t, other);
  } else if (msg.type === 'destroy' && room.phase === 'play') {
    const t = room.chats.find((c) => c.id === msg.id && (c.a === me || c.b === me));
    if (!t || tappable(t)) return; // too late: the wiretap window is open
    const other = t.a === me ? t.b : t.a;
    if (t.kill.has(me)) t.kill.delete(me); else t.kill.add(me);
    if (other.isBot && t.kill.has(me)) later(2000, 4000, () => { if (room.chats.includes(t) && !tappable(t) && t.kill.has(me)) { t.kill.add(other); finishKill(t); broadcast(); } });
    finishKill(t);
    broadcast();
  } else if (msg.type === 'leakfile' && room.phase === 'play' && me.role === 'Intelligence' && room.leakDefcon !== room.defcon) {
    // Intelligence hands one finding to Mass Media from an open chat with them (max 1 per DEFCON); a chat with anyone else does nothing
    const t = room.chats.find((c) => c.id === msg.chat && (c.a === me || c.b === me) && c.msgs.length);
    const f = room.findings.find((x) => x.id === msg.finding);
    const media = t && (t.a === me ? t.b : t.a);
    if (!t || !f || !media || media.role !== 'Mass Media') return;
    room.files.push({ id: ++room.fileSeq,
      a: { label: sideLabel(f, f.a), mode: f.am }, b: { label: sideLabel(f, f.b), mode: f.bm },
      pres: { a: f.a.role === 'President', b: f.b.role === 'President' }, // server-only: the President is always redacted when published
      msgs: f.msgs.map((m) => ({ from: m.from === f.a ? 'a' : 'b', text: m.text })) });
    room.leakDefcon = room.defcon;
    t.msgs.push({ from: me, text: '[ FILE ]' });
    t.kill.clear();
    broadcast();
  } else if (msg.type === 'publish' && room.phase === 'play' && me.role === 'Mass Media' && room.pubDefcon !== room.defcon) {
    const f = room.files.find((x) => x.id === msg.id);
    if (!f || !Array.isArray(msg.msgs)) return;
    const seen = new Set();
    const extract = msg.msgs.filter((x) => x && f.msgs[x.i] && !seen.has(x.i) && seen.add(x.i)).sort((x, y) => x.i - y.i)
      .map((x) => ({ from: f.msgs[x.i].from, text: x.red ? null : f.msgs[x.i].text }));
    if (!extract.length) return;
    // redaction happens here, so redacted facts never reach any client
    room.leaks.push({ defcon: room.defcon, by: msg.redBy ? null : me.name,
      a: msg.redA || f.pres.a ? null : f.a, b: msg.redB || f.pres.b ? null : f.b, msgs: extract });
    room.files = room.files.filter((x) => x !== f);
    room.pubDefcon = room.defcon;
    broadcast();
  } else if (msg.type === 'lang') { me.lang = msg.lang === 'it' ? 'it' : 'en';
  } else if (msg.type === 'tap' && room.phase === 'play' && me.role === 'Intelligence' && !room.tap) {
    const t = room.chats.find((c) => c.id === msg.id);
    if (t && t.a !== me && t.b !== me && tappable(t) && !sheltered(t)) { room.tap = t; if (!room.findings.includes(t)) room.findings.push(t); broadcast(); } // one wiretap per game
  } else if (msg.type === 'embassy' && room.phase === 'play' && me.role === 'Foreign Affairs' && room.embDefcon !== room.defcon) {
    // shelter every chat between two players (by leader name) from wiretaps, once per DEFCON
    const x = room.players.find((p) => p.name === msg.a), y = room.players.find((p) => p.name === msg.b);
    if (!x || !y || x === y) return;
    room.embassy = [x, y]; room.embDefcon = room.defcon;
    broadcast();
  } else if (msg.type === 'ready' && room.phase === 'play') {
    if (room.ready.has(me)) room.ready.delete(me); else room.ready.add(me);
    advanceIfReady();
    broadcast();
  }
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4' };
const server = http.createServer((req, res) => {
  const f = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : path.normalize(req.url.split('?')[0]).replace(/^(\.\.[\\/])+/, ''));
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const type = MIME[path.extname(f)] || 'text/plain';
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || ''); // iPhones need Range support for audio
    if (m) {
      const start = m[1] ? +m[1] : 0, end = m[2] ? Math.min(+m[2], data.length - 1) : data.length - 1;
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 });
      return res.end(data.subarray(start, end + 1));
    }
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes' });
    res.end(data);
  });
});
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  ws.on('message', (raw) => { try { onMessage(ws, JSON.parse(raw)); } catch (e) {} });
  ws.on('close', () => {
    const p = ws.player;
    if (p && p.ws === ws) {
      p.ws = null;
      if (!room.players.some((x) => x.ws)) { room.phase = 'lobby'; room.players = []; room.host = null; room.code = null; room.result = null; room.chats = []; room.tap = null; room.embassy = null; room.defcon = 5; room.ready = new Set(); return; }
      if (room.phase === 'play') { advanceIfReady(); broadcast(); }
      if (room.phase === 'lobby') { room.players = room.players.filter((x) => x !== p); if (room.host === p) room.host = null; broadcast(); }
    }
  });
});
server.listen(PORT, () => console.log('Abort Mission on http://localhost:' + PORT));
