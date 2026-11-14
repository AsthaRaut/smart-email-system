import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, getToken } from './api.js';

const synth = window.speechSynthesis;
const fmt = (d) => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const intro = (m) => `Email from ${m.fromName}. Subject: ${m.subject}. Message: `;

const Bars = ({ n = 8, className = '' }) => (
  <span className={`bars ${className}`} aria-hidden="true">{Array.from({ length: n }, (_, i) => <i key={i} style={{ animationDelay: `${i * 80}ms` }} />)}</span>
);
const Speaker = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
  </svg>
);

function Body({ text, pos }) {
  if (pos == null) return text;
  if (pos < 0) return <span className="rest">{text}</span>;
  let e = pos;
  while (e < text.length && !/\s/.test(text[e])) e++;
  return (<><span className="said">{text.slice(0, pos)}</span><mark>{text.slice(pos, e)}</mark><span className="rest">{text.slice(e)}</span></>);
}

function Auth({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const d = await api(`/auth/${mode}`, { method: 'POST', body: f });
      localStorage.setItem('sm_token', d.token);
      onAuth(d.user);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  return (
    <main className="auth">
      <section className="pitch">
         <h1>Never miss <em>an email again.</em></h1>
        <p>Every new message pops up the second it lands and Smart Mail can read it out to you. Listen straight away or tap OK and come back to it later.</p>
        <div className="dispatch demo" aria-hidden="true">
          <span className="ring"><Bars n={5} /></span>
          <div className="d-text"><strong>New email from Allen</strong><span>Quarterly numbers are ready</span></div>
          <div className="d-actions"><span className="btn primary">Read aloud</span><span className="btn ghost">OK</span></div>
        </div>
      </section>
      <form className="auth-card" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Welcome back' : 'Create your mailbox'}</h2>
        {mode === 'register' && (<label>Full name<input value={f.name} onChange={set('name')} placeholder="Jones" required /></label>)}
        <label>Email address<input type="email" value={f.email} onChange={set('email')} placeholder="you@example.com" required /></label>
        <label>Password<input type="password" value={f.password} onChange={set('password')} placeholder="At least 6 characters" required /></label>
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn primary big" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Register'}</button>
        <p className="switch">
          {mode === 'login' ? 'New here?' : 'Already registered?'}{' '}
          <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(''); }}>
            {mode === 'login' ? 'Create an account' : 'Log in'}
          </button>
        </p>
      </form>
    </main>
  );
}

function Compose({ onClose, onSent, defaults }) {
  const [f, setF] = useState({ to: defaults?.to || '', subject: defaults?.subject || '', body: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const send = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try { onSent(await api('/emails', { method: 'POST', body: f })); }
    catch (x) { setErr(x.message); setBusy(false); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <form className="compose" onClick={(e) => e.stopPropagation()} onSubmit={send}>
        <header><h3>New message</h3><button type="button" className="icon" onClick={onClose} aria-label="Close">✕</button></header>
        <input type="email" placeholder="To (email address)" value={f.to} onChange={set('to')} required autoFocus />
        <input placeholder="Subject" value={f.subject} onChange={set('subject')} />
        <textarea placeholder="Write your message…" value={f.body} onChange={set('body')} required rows={9} />
        {err && <p className="error" role="alert">{err}</p>}
        <footer><button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send message'}</button></footer>
      </form>
    </div>
  );
}

function Mailbox({ user, onLogout }) {
  const [box, setBox] = useState('inbox');
  const [list, setList] = useState([]);
  const [sel, setSel] = useState(null);
  const [unread, setUnread] = useState(0);
  const [q, setQ] = useState('');
  const [compose, setCompose] = useState(null);
  const [voice, setVoice] = useState(localStorage.getItem('sm_voice') !== 'off');
  const [rate, setRate] = useState(1);
  const [speaking, setSpeaking] = useState(null); // { id, pos }
  const [dispatches, setDispatches] = useState([]);
  const [toasts, setToasts] = useState([]);

  const live = useRef({ tok: 0 });
  Object.assign(live.current, { box, voice, rate });

  const toast = (title, text, kind = '') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, title, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  };
  const markRead = (id) => setList((l) => l.map((x) => (x._id === id ? { ...x, read: true } : x)));

  const stop = () => { live.current.tok++; synth && synth.cancel(); setSpeaking(null); };
  const speakMail = (m) => {
    if (!synth) return toast('Voice not supported', 'Try Chrome, Edge or Safari.', 'bad');
    const t = ++live.current.tok;
    const lead = intro(m);
    synth.cancel();
    const u = new SpeechSynthesisUtterance(lead + m.body);
    u.lang = 'en-GB'; u.rate = live.current.rate;
    u.onboundary = (e) => live.current.tok === t && setSpeaking({ id: m._id, pos: e.charIndex - lead.length });
    u.onend = u.onerror = () => live.current.tok === t && setSpeaking(null);
    setSpeaking({ id: m._id, pos: -1 });
    synth.speak(u);
  };
  const announce = (text) => {
    if (!synth) return;
    live.current.tok++; setSpeaking(null); synth.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'en-GB'; synth.speak(u);
  };

  const load = useCallback(() => api(`/emails/box/${box}?q=${encodeURIComponent(q)}`).then(setList).catch(() => {}), [box, q]);
  live.current.load = load;
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api('/unread').then((d) => setUnread(d.count)).catch(() => {}); }, []);
  useEffect(() => { document.title = unread ? `(${unread}) Smart Mail` : 'Smart Mail'; }, [unread]);


  useEffect(() => {
    const s = io({ auth: { token: getToken() } });
    s.on('new-email', (m) => {
      setUnread(m.unread);
      setDispatches((d) => [...d, { key: m.id, mailId: m.id, fromName: m.fromName, subject: m.subject }].slice(-3));
      if (live.current.voice) announce(`You have received a new email from ${m.fromName}. Subject: ${m.subject}`);
      if ('Notification' in window && document.hidden && Notification.permission === 'granted')
        new Notification(`New email from ${m.fromName}`, { body: m.subject });
      if (live.current.box === 'inbox') live.current.load();
    });
    s.on('unread-count', setUnread);
    return () => { s.disconnect(); synth && synth.cancel(); };
  }, []);

  const open = async (m) => {
    if (speaking?.id !== m._id) stop();
    try { const d = await api(`/emails/${m._id}`); setSel(d); markRead(d._id); }
    catch (e) { toast('Could not open email', e.message, 'bad'); }
  };
  const readAloud = async (m) => {
    if (speaking?.id === m._id) return stop();
    try { const d = await api(`/emails/${m._id}`); markRead(d._id); speakMail(d); }
    catch (e) { toast('Could not read email', e.message, 'bad'); }
  };
  const dispatchRead = async (d) => {
    setDispatches((x) => x.filter((i) => i.key !== d.key));
    try {
      const m = await api(`/emails/${d.mailId}`);
      setBox('inbox'); setQ(''); setSel(m); markRead(m._id); speakMail(m);
    } catch (e) { toast('Could not open email', e.message, 'bad'); }
  };
  const dispatchOk = (d) => setDispatches((x) => x.filter((i) => i.key !== d.key));

  const toggleVoice = () => {
    const next = !voice;
    setVoice(next);
    localStorage.setItem('sm_voice', next ? 'on' : 'off');
    if (next) {
      announce('Voice alerts are on.');
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    } else stop();
  };
  const switchBox = (b) => { stop(); setBox(b); setSel(null); };
  const sent = (d) => {
    setCompose(null);
    toast('Message sent', d.internal ? 'Delivered to their Smart Mail inbox.' : 'Sent through SMTP to an external address.');
    if (box === 'sent') load();
  };

  const now = sel && speaking?.id === sel._id ? speaking : null;
  const progress = now && now.pos > 0 ? Math.min(100, (now.pos / sel.body.length) * 100) : 0;

  return (
    <div className={`app ${sel ? 'has-sel' : ''}`}>
      <div className="dispatches" aria-live="assertive">
        {dispatches.map((d) => (
          <div className="dispatch" key={d.key} role="alert">
            <span className="ring"><Bars n={5} /></span>
            <div className="d-text"><strong>New email from {d.fromName}</strong><span>{d.subject}</span></div>
            <div className="d-actions">
              <button className="btn primary" onClick={() => dispatchRead(d)}>Read aloud</button>
              <button className="btn ghost" onClick={() => dispatchOk(d)}>OK</button>
            </div>
          </div>
        ))}
      </div>

      <aside className="side">
        <div className="brand">Smart <em>Mail</em></div>
        <button className="btn sun wide" onClick={() => setCompose({})}>Compose</button>
        <nav>
          <button className={box === 'inbox' ? 'on' : ''} onClick={() => switchBox('inbox')}>Inbox {unread > 0 && <b className="badge">{unread}</b>}</button>
          <button className={box === 'sent' ? 'on' : ''} onClick={() => switchBox('sent')}>Sent</button>
        </nav>
        <button className={`voice ${voice ? 'active' : ''}`} onClick={toggleVoice} aria-pressed={voice}>
          <span className="dot" /> Voice alerts {voice ? 'on' : 'off'}
        </button>
        <div className="me">
          <div><strong>{user.name}</strong><small>{user.email}</small></div>
          <button className="link" onClick={onLogout}>Log out</button>
        </div>
      </aside>

      <section className="list">
        <input className="search" placeholder={`Search ${box}…`} value={q} onChange={(e) => setQ(e.target.value)} />
        <ul>
          {list.map((m) => (
            <li key={m._id} className={`row ${sel?._id === m._id ? 'sel' : ''} ${box === 'inbox' && !m.read ? 'unread' : ''}`}>
              <button className="open" onClick={() => open(m)}>
                <span className="who">
                  <span>{box === 'inbox' ? m.fromName : `To: ${m.toEmail}`}{m.source === 'imap' && <em className="tag">External</em>}</span>
                  <time>{fmt(m.createdAt)}</time>
                </span>
                <span className="subj">{m.subject}</span>
                <span className="snip">{m.body}</span>
              </button>
              <button className={`spk ${speaking?.id === m._id ? 'on' : ''}`} onClick={() => readAloud(m)} aria-label={speaking?.id === m._id ? 'Stop reading' : 'Read this email aloud'} title={speaking?.id === m._id ? 'Stop' : 'Read aloud'}>
                {speaking?.id === m._id ? <Bars n={4} /> : <Speaker />}
              </button>
            </li>
          ))}
          {!list.length && <li className="empty">{q ? 'No emails match your search.' : box === 'inbox' ? 'Your inbox is empty. New mail will announce itself here.' : 'You have not sent anything yet.'}</li>}
        </ul>
      </section>

      <article className="reader">
        {sel ? (
          <div className="sheet">
            <button className="link back" onClick={() => { stop(); setSel(null); }}>← Back to list</button>
            <div className="deck">
              {speaking?.id === sel._id
                ? <button className="btn sun" onClick={stop}>■ Stop</button>
                : <button className="btn sun" onClick={() => speakMail(sel)}>▶ Listen</button>}
              <div className="track" aria-hidden="true"><div style={{ width: `${progress}%` }} /></div>
              <label className="speed">Speed
                <select value={rate} onChange={(e) => setRate(+e.target.value)}>
                  <option value={0.8}>0.8×</option><option value={1}>1×</option><option value={1.25}>1.25×</option><option value={1.5}>1.5×</option>
                </select>
              </label>
            </div>
            <h2>{sel.subject}</h2>
            <p className="meta"><strong>{sel.fromName}</strong> &lt;{sel.fromEmail}&gt; to {sel.toEmail}<br /><time>{fmt(sel.createdAt)}</time></p>
            <div className="body"><Body text={sel.body} pos={now ? now.pos : null} /></div>
            {sel.to && box === 'inbox' && sel.fromEmail && (
              <button className="btn" onClick={() => setCompose({ to: sel.fromEmail, subject: sel.subject.startsWith('Re:') ? sel.subject : `Re: ${sel.subject}` })}>Reply</button>
            )}
          </div>
        ) : (
          <div className="placeholder"><Bars n={9} className="idle" /><h3>Pick a message</h3><p>Open one to read it, or press the speaker beside any email to hear it.</p></div>
        )}
      </article>

      {compose && <Compose defaults={compose} onClose={() => setCompose(null)} onSent={sent} />}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}><strong>{t.title}</strong><span>{t.text}</span></div>)}
      </div>
    </div>
  );
}


export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) return setReady(true);
    api('/auth/me').then((d) => setUser(d.user)).catch(() => localStorage.removeItem('sm_token')).finally(() => setReady(true));
  }, []);

  const logout = () => { localStorage.removeItem('sm_token'); setUser(null); };
  if (!ready) return <div className="splash">Loading…</div>;
  return user ? <Mailbox user={user} onLogout={logout} /> : <Auth onAuth={setUser} />;
}
