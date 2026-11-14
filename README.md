# Smart Mail Notification & Voice Assistant System

React (Vite) + Express + MongoDB + Nodemailer + Socket.IO + Speech Synthesis API. Styling is plain CSS.

## Run it
1. Start MongoDB locally (or put a MongoDB Atlas URI in `server/.env`).
2. From this folder: `npm run install-all`
3. `npm run dev`  → app at http://localhost:5173, API at http://localhost:5000

## Try it
Open two browsers (or one normal + one private window), register two users, log in to both,
then send a message from A to B. B gets a toast, an unread badge and a spoken alert.
Open the email and press **Listen** to hear it read aloud. Use **Voice alerts** in the sidebar to switch announcements on or off.

## Real SMTP (optional)
Fill `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` in `server/.env` (Gmail needs an App Password).
Without them, an offline Nodemailer transport is used and the internal mailbox still works.

## New in v2
- **Mail from outside** (Gmail etc.) arrives in the inbox through an IMAP watcher (`imapflow` + `mailparser`). It reuses the SMTP login by default; override with `IMAP_*` in `server/.env`.
- **Dispatch banner:** every new email slides in at the top with **Read aloud** (opens and reads it) and **OK** (dismiss; the mail stays unread in the inbox).
- **Speaker button on every inbox row**, plus a Listen deck in the reader with speed control and word-by-word highlighting.
- To receive external mail, register in the app with the *same email* as `SMTP_USER` (or the address people write to).

## Notes
- Socket.IO does not detect delivery; the backend sends via Nodemailer, stores in MongoDB, finds the recipient, then emits `new-email`.
- An SMTP "accepted" response means the receiving server took the message, not that it reached an inbox.
- Browsers only allow speech after a click, so press the **Voice alerts** button once per session.
