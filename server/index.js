import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { Server } from 'socket.io';

const {
  PORT = 5000,
  MONGO_URI = 'mongodb://127.0.0.1:27017/smartmail',
  JWT_SECRET = 'dev-secret',
  CLIENT_URL = 'http://localhost:5173',
  SMTP_HOST, SMTP_PORT = 587, SMTP_USER, SMTP_PASS,
  IMAP_HOST = 'imap.gmail.com', IMAP_PORT = 993, IMAP_USER = SMTP_USER, IMAP_PASS = SMTP_PASS,
} = process.env;

const User = mongoose.model('User', new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
}, { timestamps: true }));

const Email = mongoose.model('Email', new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  fromName: String, fromEmail: String,
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, default: null },
  toEmail: String,
  subject: { type: String, default: '(No subject)' },
  body: String,
  read: { type: Boolean, default: false },
  source: { type: String, default: 'app' }, 
  messageId: String,
  smtp: { status: String, response: String },
}, { timestamps: true }));

const transport = SMTP_HOST
  ? nodemailer.createTransport({ host: SMTP_HOST, port: +SMTP_PORT, secure: +SMTP_PORT === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } })
  : nodemailer.createTransport({ jsonTransport: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CLIENT_URL } });
app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

const sign = (u) => jwt.sign({ id: u._id }, JWT_SECRET, { expiresIn: '7d' });
const safe = (u) => ({ id: u._id, name: u.name, email: u.email });
const room = (id) => `user:${id}`;
const unreadOf = (id) => Email.countDocuments({ to: id, read: false });
async function notify(uid, mail) {
  io.to(room(uid)).emit('new-email', {
    id: mail._id, fromName: mail.fromName, fromEmail: mail.fromEmail,
    subject: mail.subject, createdAt: mail.createdAt, unread: await unreadOf(uid),
  });
}

const auth = (req, res, next) => {
  try {
    req.uid = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET).id;
    next();
  } catch { res.status(401).json({ message: 'Please log in again.' }); }
};

io.use((socket, next) => {
  try { socket.uid = jwt.verify(socket.handshake.auth.token, JWT_SECRET).id; next(); }
  catch { next(new Error('Unauthorised')); }
});
io.on('connection', (socket) => socket.join(room(socket.uid)));

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: 'Name, email and password are required.' });
  if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters.' });
  if (await User.findOne({ email: email.toLowerCase().trim() })) return res.status(409).json({ message: 'That email is already registered.' });
  const user = await User.create({ name, email, password: await bcrypt.hash(password, 10) });
  res.status(201).json({ token: sign(user), user: safe(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const user = await User.findOne({ email: (req.body.email || '').toLowerCase().trim() });
  if (!user || !(await bcrypt.compare(req.body.password || '', user.password)))
    return res.status(401).json({ message: 'Incorrect email or password.' });
  res.json({ token: sign(user), user: safe(user) });
});

app.get('/api/auth/me', auth, async (req, res) => {
  const user = await User.findById(req.uid);
  if (!user) return res.status(401).json({ message: 'Account not found.' });
  res.json({ user: safe(user) });
});

app.get('/api/unread', auth, async (req, res) => res.json({ count: await unreadOf(req.uid) }));

app.get('/api/emails/box/:box', auth, async (req, res) => {
  const inbox = req.params.box === 'inbox';
  const filter = inbox ? { to: req.uid } : { from: req.uid };
  if (req.query.q) {
    const rx = new RegExp(req.query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ subject: rx }, { body: rx }, { fromName: rx }, { toEmail: rx }];
  }
  res.json(await Email.find(filter).sort({ createdAt: -1 }).limit(200));
});

app.get('/api/emails/:id', auth, async (req, res) => {
  const mail = await Email.findById(req.params.id).catch(() => null);
  if (!mail || ![String(mail.from), String(mail.to)].includes(String(req.uid)))
    return res.status(404).json({ message: 'Email not found.' });
  if (String(mail.to) === String(req.uid) && !mail.read) {
    mail.read = true;
    await mail.save();
    io.to(room(req.uid)).emit('unread-count', await unreadOf(req.uid));
  }
  res.json(mail);
});

app.post('/api/emails', auth, async (req, res) => {
  const { to, subject, body } = req.body;
  if (!to || !body) return res.status(400).json({ message: 'Recipient and message are required.' });
  const toEmail = to.toLowerCase().trim();
  const sender = await User.findById(req.uid);

  let smtp, messageId;
  try {
  
    const info = await transport.sendMail({
      from: SMTP_USER
        ? { name: `${sender.name} (via Smart Mail)`, address: SMTP_USER }
        : { name: sender.name, address: sender.email },
      replyTo: { name: sender.name, address: sender.email },
      to: toEmail,
      subject: subject || '(No subject)',
      text: `${body}\n\n--\nSent by ${sender.name} <${sender.email}> via Smart Mail.\nPress Reply to answer ${sender.name} directly.`,
    });
    messageId = info.messageId;
    smtp = { status: 'accepted', response: info.response || 'Accepted by mail transport' };
  } catch (err) {
    smtp = { status: 'failed', response: err.message };
  }

  const recipient = await User.findOne({ email: toEmail });
  if (!recipient && smtp.status === 'failed')
    return res.status(502).json({ message: `Could not send: ${smtp.response}` });

  const mail = await Email.create({
    from: sender._id, fromName: sender.name, fromEmail: sender.email,
    to: recipient?._id || null, toEmail, subject: subject?.trim() || '(No subject)', body, smtp, messageId,
  });

  if (recipient) await notify(recipient._id, mail);
  res.status(201).json({ mail, internal: !!recipient });
});

async function ingest(p) {
  if (p.messageId && (await Email.exists({ messageId: p.messageId }))) return; 
  const from = p.from?.value?.[0] || {};
  const addrs = [...(p.to?.value || []), ...(p.cc?.value || [])].map((a) => a.address?.toLowerCase()).filter(Boolean);
  const recipient = await User.findOne({ email: { $in: [...addrs, IMAP_USER.toLowerCase()] } });
  if (!recipient) return;
  const subject = p.subject || '(No subject)';
  if (await Email.exists({ to: recipient._id, subject, source: 'app', createdAt: { $gt: new Date(Date.now() - 5 * 60000) } })) return;
  const body = (p.text || (p.html || '').replace(/<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim().slice(0, 20000) || '(No content)';
  const mail = await Email.create({
    from: null, fromName: from.name || from.address || 'Unknown sender', fromEmail: (from.address || '').toLowerCase(),
    to: recipient._id, toEmail: recipient.email, subject, body, source: 'imap', messageId: p.messageId,
    smtp: { status: 'received', response: 'Received via IMAP' },
  });
  await notify(recipient._id, mail);
  console.log(`New external email for ${recipient.email}: ${subject}`);
}

async function startImap() {
  if (!IMAP_USER || !IMAP_PASS) return console.log('IMAP is off (no IMAP/SMTP credentials). External mail will not arrive.');
  const client = new ImapFlow({ host: IMAP_HOST, port: +IMAP_PORT, secure: true, auth: { user: IMAP_USER, pass: IMAP_PASS }, logger: false });
  let lastUid = 0, busy = false, again = false;

  const pull = async () => {
    if (busy) { again = true; return; }
    busy = true;
    try {
      do {
        again = false;
        const found = [];
        for await (const m of client.fetch(`${lastUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
          if (m.uid > lastUid) { lastUid = m.uid; found.push(m.source); }
        }
        for (const src of found) await ingest(await simpleParser(src));
      } while (again);
    } catch (e) { console.error('IMAP fetch error:', e.message); }
    busy = false;
  };

  client.on('error', (e) => console.error('IMAP error:', e.message));
  client.on('close', () => { console.log('IMAP connection closed, retrying in 20s…'); setTimeout(startImap, 20000); });
  client.on('exists', pull);
  try {
    await client.connect();
    await client.mailboxOpen('INBOX');
    lastUid = client.mailbox.uidNext - 1; 
    console.log(`IMAP watching ${IMAP_USER} for new mail`);
  } catch (e) {
    console.error('IMAP connection failed:', e.message);
    client.close?.();
  }
}

mongoose.connect(MONGO_URI)
  .then(() => server.listen(PORT, () => { console.log(`API + Socket.IO running on http://localhost:${PORT}`); startImap(); }))
  .catch((e) => { console.error('MongoDB connection failed:', e.message); process.exit(1); });