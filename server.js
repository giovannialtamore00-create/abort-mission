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

const room = { phase: 'lobby', players: [], host: null, result: null, attempts: 0, chats: [], allChats: [], chatSeq: 0, leaks: [], findings: [], files: [], fileSeq: 0, leakDefcon: null, pubDefcon: null, tap: null, embassy: null, embDefcon: null, check: null, defcon: 5, ready: new Set(), started: new Map() };

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
  room.aiCalls = 0;
  room.defcon = 5;
  room.defconEnds = Date.now() + DEFCON_MS;
  room.pausedLeft = null; // ms left while the host has the timer paused
  room.ready = new Set();
}

// a chat can be wiretapped 30 seconds after its first message; both sides together can destroy it at any time
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
// follow-ups a bot posts on its own in a chat that already exists
const BOT_UPDATE = {
  en: ['Any news?', 'Still there?', 'Update: I talked to someone. Not sure about them.', 'Things are moving fast. Stay sharp.', 'I changed my mind about something.', 'Did you hear anything new?',
    'Someone just asked me about you.', 'Forget what I said before.', 'I am getting worried.', 'Back again. What did I miss?', 'The others are acting strange.', 'Keep me posted.'],
  it: ['Novità?', 'Ci sei ancora?', 'Aggiornamento: ho parlato con qualcuno. Non mi convince.', 'Le cose si muovono in fretta. Stai attento.', 'Ho cambiato idea su una cosa.', 'Hai sentito qualcosa di nuovo?',
    'Qualcuno mi ha appena chiesto di te.', 'Dimentica quello che ho detto prima.', 'Sto iniziando a preoccuparmi.', 'Eccomi di nuovo. Cosa mi sono perso?', 'Gli altri si comportano in modo strano.', 'Tienimi aggiornato.'],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];
// lines written by real players (sent through the end-screen button, reviewed by hand): { openers: {en, it}, questions: {en, it} }
const LEARNED = (() => {
  const empty = { openers: { en: [], it: [] }, questions: { en: [], it: [] } };
  try { return { ...empty, ...JSON.parse(fs.readFileSync(path.join(__dirname, 'learned-lines.json'), 'utf8')) }; } catch { return empty; }
})();
// shared pool: each line is said at most once per match by any bot (in either language);
// replies fall back to unused openers, and when everything is used the bots go quiet
function botLine(kind, lang) {
  if (kind === 'say') { // real players' openers first (learned-lines.json), {name} = a random player
    const list = LEARNED.openers[lang] || [], free = list.map((_, i) => i).filter((i) => !room.usedLines.has('L' + lang + i));
    if (free.length) { const i = pick(free); room.usedLines.add('L' + lang + i); return list[i].replace(/\{name\}/g, () => pick(room.players).name); }
    return null; // bots only open chats with learned openers
  }
  const pools = kind === 'reply' ? [['r', BOT_REPLY], ['s', BOT_SAY]] : kind === 'update' ? [['u', BOT_UPDATE]] : [['s', BOT_SAY]];
  for (const [k, lists] of pools) {
    const free = lists.en.map((_, i) => i).filter((i) => !room.usedLines.has(k + i));
    if (free.length) { const i = pick(free); room.usedLines.add(k + i); return lists[lang][i]; }
  }
  return null;
}
// make a bot line look typed by a person: sometimes informal, sometimes a typo, random casing per message
const INFORMAL = {
  en: [[/\bI am\b/g, "I'm"], [/\bdo not\b/g, "don't"], [/\bdoes not\b/g, "doesn't"], [/\bcannot\b/g, "can't"], [/\bThat is\b/g, "That's"], [/\bWho are\b/g, 'who r'], [/\byou\b/g, 'u'], [/\bWe are\b/g, "We're"], [/\bI will\b/g, "I'll"], [/\bI would\b/g, "I'd"]],
  it: [[/\bnon\b/gi, 'nn'], [/\bperché\b/gi, 'xké'], [/\bche\b/g, 'ke'], [/\bcomunque\b/g, 'cmq'], [/\bqualcosa\b/g, 'qlcs'], [/\bper\b/g, 'x']],
};
function typo(text) {
  const words = text.split(' '), idx = words.map((w, i) => i).filter((i) => /^[\p{L}]{4,}$/u.test(words[i]));
  if (!idx.length) return text;
  const i = pick(idx), w = words[i], j = 1 + Math.floor(Math.random() * (w.length - 2));
  words[i] = Math.random() < 0.5 ? w.slice(0, j) + w[j + 1] + w[j] + w.slice(j + 2) : w.slice(0, j) + w[j] + w.slice(j); // swap two letters or double one
  return words.join(' ');
}
function humanize(text, bot, lang) {
  if (Math.random() < 0.4) { for (const [re, to] of INFORMAL[lang]) text = text.replace(re, to); text = text.replace(/\.$/, ''); }
  if (Math.random() < 0.15) text = typo(text);
  return Math.random() < 0.5 ? text.toLowerCase() : text[0].toUpperCase() + text.slice(1);
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
  if (!t) { room.started.set(me, (room.started.get(me) || 0) + 1); t = { id: ++room.chatSeq, a: me, b: other, am: as, bm: mode, msgs: [], firstAt: Date.now(), kill: new Set() }; room.chats.push(t); room.allChats.push(t); setTimeout(broadcast, TAP_MS + 100); }
  return t;
}
// both sides pressed destroy in time: the chat is gone
function finishKill(t) { if (t.kill.has(t.a) && t.kill.has(t.b)) { room.chats = room.chats.filter((c) => c !== t); matchLog({ ev: 'destroy', chat: t.id }); } }
// match log for training bots: one JSON line per event in logs/match-<date>.jsonl (start, every chat message, destroy, end)
let logFile = null;
function matchLog(e) {
  if (!logFile) return;
  try { fs.appendFileSync(logFile, JSON.stringify({ t: new Date().toISOString(), defcon: room.defcon, ...e }) + '\n'); } catch (err) { console.error('match log:', err.message); }
}
function startLog() {
  fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
  logFile = path.join(__dirname, 'logs', 'match-' + new Date().toISOString().replace(/[:.]/g, '-') + '.jsonl');
  matchLog({ ev: 'start', players: room.players.map((p) => ({ name: p.name, role: p.role, corrupt: p.corrupt, bot: p.isBot, lang: p.lang || null, code: p.code })) });
}
function endLog(result) { matchLog({ ev: 'end', result }); logFile = null; }
// every chat message goes through here so it is also logged
function addMsg(t, from, text) {
  t.msgs.push({ from, text }); t.lastAt = Date.now();
  const to = from === t.a ? t.b : t.a;
  matchLog({ ev: 'msg', chat: t.id, from: from.name, fromRole: from.role, fromBot: from.isBot, as: sideMode(t, from), to: to.name, toRole: to.role, toBot: to.isBot, text });
}
// AI replies via Groq (free plan): key from GROQ_API_KEY or the git-ignored file groq-key.txt; no key = fixed lines
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const AI_CALLS_PER_MATCH = 150;
const groqKey = () => process.env.GROQ_API_KEY || (() => { try { return fs.readFileSync(path.join(__dirname, 'groq-key.txt'), 'utf8').trim(); } catch { return ''; } })();
const fakeCode = (real) => { let c; do c = code4(); while (c === real || room.realCodes.has(c)); return c; }; // a corrupt bot's one made-up code (never anyone's real code)
// a few real player lines as style examples for the AI (never copied word for word)
function styleExamples(lang) {
  const all = [...(LEARNED.openers[lang] || []), ...(LEARNED.questions[lang] || [])];
  if (!all.length) return '';
  const ex = all.slice().sort(() => Math.random() - 0.5).slice(0, 6).map((x) => '- ' + x.replace(/\{name\}/g, 'someone'));
  return `Examples of how real players write in this game (copy the tone and length, not the words):\n${ex.join('\n')}\n`;
}
// reply length varies: early in a chat only short bits, once the chat is established sometimes a longer one (avg ~5 words per sentence)
const ESTABLISHED = 6; // messages in a chat before bots may write longer lines or change the subject
function lengthStyle(t, topic) {
  const r = Math.random(), established = t.msgs.length >= ESTABLISHED;
  if (topic) return 'Write 1-2 short sentences, 12-18 words in total, 5 words per sentence on average.';
  if (r < (established ? 0.4 : 0.7)) return 'Write a one-liner of 1-4 words, like "not now", "i dont know", "maybe", "why?".';
  if (!established || r < 0.8) return 'Write ONE short sentence of 4-8 words.';
  return 'Write 1-2 short sentences, 10-15 words in total, 5 words per sentence on average.';
}
// subjects a bot can bring up on its own in an established chat (only ones that make sense at this DEFCON)
function pickTopic(t, bot, human) {
  const others = room.players.filter((x) => x !== bot && x !== human).map((x) => x.name);
  const topics = [
    'ask if there is any news, or what the others have told them',
    others.length && `pass on a vague rumor about ${pick(others)} (hearsay, e.g. acting strange, dodging questions, too eager); you may stretch the truth`,
    others.length && `say you do not trust ${pick(others)} and ask what they think`,
    'ask if anyone has leaked or published any file (Intelligence can leak files to Mass Media, who can publish them)',
    'ask if they think someone is wiretapping this chat',
    'remind them how little time is left and ask what the plan is',
    room.defcon <= 4 && sideMode(t, human) === 'name' && 'ask the one claiming to be the Survivor whether they have used their CODE CHECK on anyone yet',
    room.defcon <= 3 && sideMode(t, human) === 'name' && 'ask the one claiming to be the Survivor whether they have entered any code yet, and how many they have collected',
  ].filter(Boolean);
  return pick(topics);
}
function botPrompt(t, bot, human, topic) {
  const goal = bot.corrupt
    ? `You are secretly CORRUPT: you want the nukes to hit. Never admit it or hint at it. ${bot.code ? `Never give your real code ${bot.code}. Act exactly like a careful loyal player: ask a question or two first, then give your fake code ${bot.fake || (bot.fake = fakeCode(bot.code))} (a wrong code typed by the Survivor ends the game). Always the same fake code, never a different one.` : 'You have no code; sow doubt, point suspicion at loyal players.'} There is 1 other corrupt player; you do not know who.`
    : `You are LOYAL: you want the nukes disarmed. ${bot.code ? 'Your real code is ' + bot.code + '. Give it ONLY to someone you believe is the real Designated Survivor, never to anyone else. There are no passwords or secret proofs in this game: ask at most one or two simple questions, look for contradictions (a corrupt player may pretend to be the Survivor; someone writing as a role is not the Survivor, who can only write as a name). Once they have answered a question or insisted, and nothing contradicts them, give your code in that message; by their 3rd message claiming to be the Survivor (as a name, no contradictions) you MUST give it: if nobody trusts the Survivor, everyone loses.' : 'You have no code; help the Survivor find trustworthy players.'}`;
  return `You are a player in "DEFCON Survivors", a 6-player social deduction game played in private text chats. A nuclear missile is incoming. The Designated Survivor (always loyal, has no code) must collect two real 4-digit codes from the code holders (President, Intelligence, Army General, Foreign Affairs) and type both; one wrong code ends the game. Mass Media has no code. 2 players are secretly corrupt. Players chat as their leader name or their role; someone writing as a role is really that role, someone writing as a name could be anyone.
You are ${bot.name}, role: ${bot.role}. In this chat you appear to the other player as "${sideLabel(t, bot)}" and they appear as "${sideLabel(t, human)}" (that is all you know about them).
${goal}
${sideMode(t, human) === 'role' ? `IMPORTANT: they are signed with a ROLE (${sideLabel(t, human)}), so they are really the ${sideLabel(t, human)} and NOT the Survivor (the Survivor can only write as a name). Never ask if they are the Survivor, never treat them as the Survivor and never give them your code as if they were. Talk to them as the ${sideLabel(t, human)}: ask what they know, whether they have a code, who they trust, whether they have seen the Survivor.` : `They are signed with a name, so they could be anyone, including the Survivor. Do NOT ask "are you the Survivor?" directly or repeatedly: real players never say it that bluntly. At most hint once in a natural way (what they know, what they are doing, who they have talked to), and if they never say it, do not push.`}
They have sent you ${t.msgs.filter((m) => m.from === human).length} message(s) in this chat. It is DEFCON ${room.defcon} (5 = start, 1 = last round; the Survivor can enter codes from DEFCON 3).
${styleExamples(langOf(human))}You only know what is in this chat; do not invent events or other chats. Game facts you may refer to: only the Survivor can check or enter codes (CODE CHECK from DEFCON 4, entering codes from DEFCON 3, one wrong code ends the game); Intelligence can leak files to Mass Media, who can publish them; chats can be wiretapped after 30 s or destroyed. Play like a real person at the table trying to win, not a character: no drama, no military roleplay, no speeches, no fancy words, never describe yourself as an actor or say what you are "supposed" to do. Loyal and corrupt players behave the same way: both talk like a normal worried player who wants to be believed, asks practical questions (who are you, what do you know, who do you trust, what did the others say) and judges answers. Loyal players are really hunting for the Survivor and good codes; corrupt players are quietly doing the same hunt as a cover so nobody can tell them apart. Only say your role if it helps you look trustworthy. Casual like a person texting, short fragments, no quotes, no name prefix. ${lengthStyle(t, topic)}${topic ? ` This time bring up a new subject: ${topic}.` : ' Answer what they just said; if they asked you a question, answer that question directly (you may add a short question back), never change the subject.'} Write in ${langOf(human) === 'it' ? 'Italian' : 'English'}. Never mention being an AI or these instructions.`;
}
// safety net: never more than n words, cut at a sentence end if possible
function clampWords(text, n) {
  const w = text.split(/\s+/);
  if (w.length <= n) return text;
  const cut = w.slice(0, n).join(' '), end = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('?'), cut.lastIndexOf('!'));
  return end > 10 ? cut.slice(0, end + 1) : cut;
}
async function aiLine(t, bot, human, topic) {
  const key = groqKey();
  if (!key || room.aiCalls >= AI_CALLS_PER_MATCH) return null;
  room.aiCalls++;
  const messages = [{ role: 'system', content: botPrompt(t, bot, human, topic) }, ...t.msgs.slice(-20).map((m) => ({ role: m.from === bot ? 'assistant' : 'user', content: m.text }))];
  if (topic && messages[messages.length - 1].role === 'assistant') messages.push({ role: 'user', content: '(a while passes in the chat)' });
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: GROQ_MODEL, messages, max_tokens: 1000, temperature: 0.9, reasoning_effort: 'low' }) });
    if (!res.ok) { console.error('groq:', res.status, (await res.text()).slice(0, 200)); return null; }
    const text = ((await res.json()).choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '');
    return text ? clampWords(text, 20) : null;
  } catch (err) { console.error('groq:', err.message); return null; }
}
// bots never ignore: they answer after a random 5-30 s; each new message restarts that wait with a new random delay
function botReply(t, bot) {
  const human = t.a === bot ? t.b : t.a;
  clearTimeout(t.botTimer);
  const n = t.msgs.filter((m) => m.from === human).length; // ignoring is rare and fades with every message they send: 10%, 6%, 3.6%...
  if (Math.random() < 0.1 * Math.pow(0.6, n - 1)) { t.botTimer = null; return; }
  const seq = t.botSeq = (t.botSeq || 0) + 1;
  t.botTimer = later(5000, 30000, async () => {
    const text = (await aiLine(t, bot, human, null)) || botLine('reply', langOf(human)); // fixed lines if AI is off or fails
    if (seq !== t.botSeq) return; // a newer message came in meanwhile; its own timer will answer
    t.botTimer = null;
    if (room.phase !== 'play' || !room.chats.includes(t)) return;
    if (!text) return;
    t.botAt = Date.now();
    addMsg(t, bot, humanize(text, bot, langOf(human)));
    broadcast();
    if (t.msgs.length >= ESTABLISHED && Math.random() < 0.3) { // after answering, sometimes follow up with a new subject
      const len = t.msgs.length;
      later(6000, 15000, async () => {
        if (t.msgs.length !== len || t.botTimer || t.aiBusy || room.phase !== 'play' || !room.chats.includes(t)) return;
        const x = await aiLine(t, bot, human, pickTopic(t, bot, human));
        if (!x || t.msgs.length !== len || t.botTimer || room.phase !== 'play' || !room.chats.includes(t)) return;
        t.botAt = Date.now(); addMsg(t, bot, humanize(x, bot, langOf(human))); broadcast();
      });
    }
  });
}
// every few seconds a bot may start a chat with a human it has not talked to yet,
// or post an update in an old chat with them (at most once every 20 s per chat)
setInterval(() => {
  if (room.phase !== 'play' || Math.random() > 0.45) return;
  const bots = room.players.filter((x) => x.isBot), humans = room.players.filter((x) => !x.isBot && x.ws);
  if (!bots.length || !humans.length) return;
  const bot = pick(bots), human = pick(humans);
  const old = room.chats.filter((c) => (c.a === bot && c.b === human) || (c.a === human && c.b === bot));
  let t, text;
  if (old.length) {
    t = pick(old);
    if (t.botTimer || t.aiBusy || Date.now() - (t.botAt || 0) < 20000) return; // no update while a reply is pending
    if (groqKey() && room.aiCalls < AI_CALLS_PER_MATCH) { // AI: a new subject, only in an established chat that has been quiet a while
      if (t.msgs.length < ESTABLISHED || Date.now() - (t.lastAt || 0) < 100000 || Math.random() > 0.3) return; // after 100+ s of silence, and even then not always
      t.aiBusy = true;
      aiLine(t, bot, human, pickTopic(t, bot, human)).then((x) => {
        t.aiBusy = false;
        if (!x || t.botTimer || room.phase !== 'play' || !room.chats.includes(t)) return;
        t.kill.clear(); t.botAt = Date.now();
        addMsg(t, bot, humanize(x, bot, langOf(human)));
        broadcast();
      });
      return;
    }
    text = botLine('update', langOf(human));
    if (!text) return;
    t.kill.clear(); // a new message cancels any destroy requests
  } else {
    if (chatsLeft(bot) <= 0) return;
    text = botLine('say', langOf(human));
    if (!text) return;
    t = threadFor(bot, human, pick(['name', 'role']), human.role === SURVIVOR ? 'name' : pick(['name', 'role'])); // nobody can address the Survivor by role
  }
  t.botAt = Date.now();
  addMsg(t, bot, humanize(text, bot, langOf(human)));
  broadcast();
}, 4000);
// each side of a chat picks how it shows up (name or role): t.am for side a, t.bm for side b
const sideMode = (t, x) => (x === t.a ? t.am : t.bm);
const sideLabel = (t, x) => (sideMode(t, x) === 'name' ? x.name : x.role);

// a round ends when every connected human is ready or its 5 minutes run out; DEFCON counts down 5 -> 1
const DEFCON_MS = (+process.env.DEFCON_SEC || 300) * 1000; // DEFCON_SEC only for quick tests
function dropDefcon() { room.defcon--; room.ready.clear(); room.tap = null; room.embassy = null; room.started = new Map(); room.defconEnds = Date.now() + DEFCON_MS; if (room.pausedLeft != null) room.pausedLeft = DEFCON_MS; }
function advanceIfReady() {
  const humans = room.players.filter((x) => !x.isBot && x.ws);
  if (room.phase === 'play' && room.defcon > 1 && humans.length && humans.every((x) => room.ready.has(x))) dropDefcon();
}
// time's up: DEFCON drops; at DEFCON 1 the nukes hit
setInterval(() => {
  if (room.phase !== 'play' || room.pausedLeft != null || Date.now() < room.defconEnds) return;
  if (room.defcon > 1) dropDefcon(); else { room.phase = 'ended'; room.result = 'TIMEOUT'; endLog(room.result); }
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
      return { id: t.id, canKill: true,killMine: t.kill.has(p), killOther: t.kill.has(o), as: sideMode(t, p), mode: sideMode(t, o), with: sideLabel(t, o),
        msgs: t.msgs.map((m) => ({ mine: m.from === p, label: sideLabel(t, m.from), lm: sideMode(t, m.from), text: m.text })) };
    });
    // names and roles are sent as separate lists so they can't be matched up
    v.chatNames = room.players.filter((x) => x !== p).map((x) => x.name);
    v.chatRoles = Object.keys(ROLES).filter((r) => r !== p.role && r !== SURVIVOR);
    const humans = room.players.filter((x) => !x.isBot && x.ws);
    v.defcon = room.defcon;
    v.defconLeft = room.pausedLeft != null ? room.pausedLeft : Math.max(0, room.defconEnds - Date.now()); // ms left, so client clocks don't matter
    v.paused = room.pausedLeft != null;
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
    // post-match: every chat of the match, with real names and roles, destroyed ones included
    v.chatLog = room.allChats.filter((t) => t.msgs.length).map((t) => ({ a: { name: t.a.name, role: t.a.role }, b: { name: t.b.name, role: t.b.role },
      destroyed: !room.chats.includes(t), msgs: t.msgs.map((m) => ({ a: m.from === t.a, mine: m.from === p, text: m.text })) }));
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
  if (msg.type === 'start' && isHost && room.phase === 'lobby') { deal(); room.allChats = []; startLog(); broadcast(); }
  else if (msg.type === 'pause' && isHost && room.phase === 'play') {
    // host only: freeze or resume the DEFCON timer
    if (room.pausedLeft != null) { room.defconEnds = Date.now() + room.pausedLeft; room.pausedLeft = null; }
    else room.pausedLeft = Math.max(0, room.defconEnds - Date.now());
    broadcast();
  } else if ((msg.type === 'newgame' || (msg.type === 'close' && room.phase === 'play')) && isHost) {
    // newgame after the end, or the host closes a running match: back to the lobby (closing also drops players who left)
    if (room.phase === 'play') endLog('CLOSED');
    room.players = room.players.filter((p) => !p.isBot && (msg.type === 'newgame' || p.ws));
    room.players.forEach((p) => { delete p.role; p.name = p.joinName || p.name; });
    room.phase = 'lobby'; room.result = null; room.chats = []; room.tap = null; room.embassy = null; room.defcon = 5; room.ready = new Set(); broadcast();
  } else if (msg.type === 'commit' && room.phase === 'play' && me.role === SURVIVOR && room.defcon <= 3) { // console unlocks at DEFCON 3
    const d = String(msg.digits || '');
    room.attempts++;
    const a = d.slice(0, 4), b = d.slice(4);
    const ok = /^\d{8}$/.test(d) && a !== b && room.realCodes.has(a) && room.realCodes.has(b);
    // one attempt only: a wrong code ends the game
    room.phase = 'ended'; room.result = ok ? 'DISARMED' : 'FAILED'; endLog(room.result);
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
    addMsg(t, me, text);
    t.kill.clear(); // a new message cancels any destroy requests
    broadcast();
    if (other.isBot) botReply(t, other);
  } else if (msg.type === 'destroy' && room.phase === 'play') {
    const t = room.chats.find((c) => c.id === msg.id && (c.a === me || c.b === me));
    if (!t) return; // allowed any time; what Intelligence already wiretapped stays in their findings
    const other = t.a === me ? t.b : t.a;
    if (t.kill.has(me)) t.kill.delete(me); else t.kill.add(me);
    if (other.isBot && t.kill.has(me)) later(2000, 4000, () => { if (room.chats.includes(t) && t.kill.has(me)) { t.kill.add(other); finishKill(t); broadcast(); } });
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
    addMsg(t, me, '[ FILE ]');
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
      if (!room.players.some((x) => x.ws)) { if (room.phase === 'play') endLog('EVERYONE LEFT'); room.phase = 'lobby'; room.players = []; room.host = null; room.code = null; room.result = null; room.chats = []; room.tap = null; room.embassy = null; room.defcon = 5; room.ready = new Set(); return; }
      if (room.phase === 'play') { advanceIfReady(); broadcast(); }
      if (room.phase === 'lobby') { room.players = room.players.filter((x) => x !== p); if (room.host === p) room.host = null; broadcast(); }
    }
  });
});
server.listen(PORT, () => console.log('DEFCON Survivors on http://localhost:' + PORT));
