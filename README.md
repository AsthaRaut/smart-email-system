# Smart Mail

A web mail app that tells you the moment a new email arrives and can read it aloud.

## Features

- Register and log in (JWT and bcrypt)
- Compose, reply, Inbox, Sent and search
- Real-time alert banner for every new email, with **Read aloud** and **OK**
- Spoken announcement: "You have received a new email"
- Read any email aloud from the inbox (speaker button) or the reader (speed control, word highlighting)
- Unread counter and read/unread status
- Receives mail from outside (Gmail etc.) through IMAP
- Sends to any address through SMTP (Nodemailer)

## Tech stack

React (Vite), plain CSS, Node.js, Express, MongoDB (Mongoose), Nodemailer, Imapflow, Socket.IO, Speech Synthesis API

## Setup

**You need:** Node.js 18 or later, and a MongoDB Atlas URI (or local MongoDB).

```bash
npm run install-all                      # installs root, server and client
cp server/.env.example server/.env       # then fill in the values below
npm run dev
```

Open http://localhost:5173 (the API runs on port 5000).

### `server/.env`

| Variable | Purpose |
| --- | --- |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Long random string for login tokens |
| `CLIENT_URL` | Frontend address, `http://localhost:5173` for development |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Optional. Real sending, e.g. `smtp.gmail.com`, `587`, your address and a Gmail **App Password** |
| `IMAP_*` | Optional. Receiving outside mail. Reuses the SMTP login unless set |

Leave SMTP blank and the app still works between registered users.

## How it works

1. A user composes an email. The server sends it with Nodemailer and receives the SMTP response.
2. The email is saved in MongoDB and the recipient is identified.
3. If the recipient is online, Socket.IO pushes a `new-email` event.
4. Their browser shows the banner and speaks the announcement.
5. **Read aloud** opens the email and reads it. **OK** dismisses the banner and leaves it unread in the inbox.

Mail from outside follows the same path: the IMAP watcher stores it, then the same notification fires.

## Try it

Register two users, log in to each in a separate browser (or a private window), then send a message from one to the other. Press **Voice alerts** once after logging in, because browsers only allow speech after a click.

## Limitations

- Outside mail is received for **one** mailbox only (the `IMAP_USER` / `SMTP_USER` account). Register in the app with that same email to see it.
- Outside mail shows `Name (via Smart Mail)` as the sender, with the user's address in Reply-To.
- Email addresses are not verified at registration yet.
- An SMTP "accepted" response means the receiving server took the message, not that it reached an inbox.

## Project structure

```
client/   React app (src/App.jsx, src/styles.css, src/api.js)
server/   Express API, Socket.IO, Nodemailer, IMAP (index.js)
```
