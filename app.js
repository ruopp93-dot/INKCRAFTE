const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'change-this-secret';

const allowedExt = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
function readJSONSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf-8');
    return JSON.parse(raw || 'null') ?? fallback;
  } catch (e) {
    console.error('Failed to read JSON:', e);
    return fallback;
  }
}
function writeJSONSafe(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8'); }

// Init folders and DB
ensureDir(PUBLIC_DIR);
ensureDir(UPLOADS_DIR);
ensureDir(DATA_DIR);
const defaultDB = { contact: { name: 'Тату-мастер', phone: '+7 000 000-00-00', instagram: '', telegram: '', whatsapp: '', avatar: '' } };
if (!fs.existsSync(DB_FILE)) writeJSONSafe(DB_FILE, defaultDB);

// Copy root images to uploads (best-effort; useful for local dev)
try {
  const rootFiles = fs.readdirSync(ROOT);
  for (const file of rootFiles) {
    const src = path.join(ROOT, file);
    const ext = path.extname(file).toLowerCase();
    if (allowedExt.has(ext) && fs.statSync(src).isFile()) {
      const dst = path.join(UPLOADS_DIR, file);
      if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
    }
  }
} catch {}

// Upload storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext);
    const safeBase = base.replace(/[^\p{L}\p{N}_-]+/gu, '-');
    cb(null, `${Date.now()}-${safeBase}${ext}`);
  }
});
function fileFilter(req, file, cb) { allowedExt.has(path.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(new Error('Недопустимый формат файла')); }
const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });

// Auth helpers (stateless signed cookie)
function sign(iat) {
  const payload = String(iat);
  const sig = crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64url') + '.' + sig;
}
function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [b, sig] = token.split('.');
  const payload = Buffer.from(b, 'base64url').toString('utf8');
  const check = crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(check))) return false;
  const iat = parseInt(payload, 10);
  const ageDays = (Date.now() - iat) / (1000 * 60 * 60 * 24);
  return ageDays <= 7; // valid for 7 days
}
function requireAuth(req, res, next) {
  const token = req.cookies?.admin_token;
  if (verify(token)) return next();
  return res.status(401).json({ error: 'Требуется авторизация' });
}

// Build app
const app = express();
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

// Auth endpoints
app.get('/api/auth/status', (req, res) => {
  res.json({ authenticated: verify(req.cookies?.admin_token) });
});
app.post('/api/auth/login', (req, res) => {
  const pin = String(req.body?.pin || '');
  if (pin === ADMIN_PIN) {
    const token = sign(Date.now());
    res.cookie('admin_token', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 });
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Неверный PIN' });
});
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ ok: true });
});

// Photos API
app.get('/api/photos', (req, res) => {
  try {
    const db = readJSONSafe(DB_FILE, defaultDB);
    const avatarName = db?.contact?.avatar ? path.basename(db.contact.avatar) : '';
    const files = fs.readdirSync(UPLOADS_DIR)
      .filter(f => allowedExt.has(path.extname(f).toLowerCase()))
      .filter(f => f !== avatarName)
      .map(f => ({ url: `/uploads/${encodeURIComponent(f)}`, name: f }));
    res.json({ photos: files });
  } catch (e) { res.status(500).json({ error: 'Не удалось получить список работ' }); }
});
app.post('/api/photos', requireAuth, upload.array('photos', 20), (req, res) => {
  const files = (req.files || []).map(f => ({ url: `/uploads/${encodeURIComponent(f.filename)}`, name: f.filename }));
  res.json({ uploaded: files });
});
app.delete('/api/photos/:name', requireAuth, (req, res) => {
  try {
    const raw = req.params.name;
    const name = path.basename(raw);
    const file = path.join(UPLOADS_DIR, name);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ error: 'Не удалось удалить файл' }); }
});

// Avatar upload
const avatarUpload = upload.single('avatar');
app.post('/api/avatar', requireAuth, (req, res, next) => avatarUpload(req, res, (err) => {
  if (err) return res.status(400).json({ error: err.message });
  const db = readJSONSafe(DB_FILE, defaultDB);
  const file = req.file?.filename;
  if (!file) return res.status(400).json({ error: 'Файл не получен' });
  // Optionally delete old avatar
  if (db.contact?.avatar) {
    const prev = path.join(UPLOADS_DIR, path.basename(db.contact.avatar));
    if (fs.existsSync(prev)) try { fs.unlinkSync(prev); } catch {}
  }
  db.contact = db.contact || {};
  db.contact.avatar = file;
  writeJSONSafe(DB_FILE, db);
  res.json({ avatar: `/uploads/${encodeURIComponent(file)}` });
}));
app.delete('/api/avatar', requireAuth, (req, res) => {
  const db = readJSONSafe(DB_FILE, defaultDB);
  if (db.contact?.avatar) {
    const prev = path.join(UPLOADS_DIR, path.basename(db.contact.avatar));
    if (fs.existsSync(prev)) try { fs.unlinkSync(prev); } catch {}
    db.contact.avatar = '';
    writeJSONSafe(DB_FILE, db);
  }
  res.json({ ok: true });
});

// Contact API
app.get('/api/contact', (req, res) => {
  const db = readJSONSafe(DB_FILE, defaultDB);
  const contact = db.contact || defaultDB.contact;
  const avatarUrl = contact.avatar ? `/uploads/${encodeURIComponent(path.basename(contact.avatar))}` : '';
  res.json({ ...contact, avatarUrl });
});
app.put('/api/contact', requireAuth, (req, res) => {
  const db = readJSONSafe(DB_FILE, defaultDB);
  db.contact = {
    name: req.body.name ?? db.contact.name,
    phone: req.body.phone ?? db.contact.phone,
    instagram: req.body.instagram ?? db.contact.instagram,
    telegram: req.body.telegram ?? db.contact.telegram,
    whatsapp: req.body.whatsapp ?? db.contact.whatsapp,
    avatar: db.contact.avatar || ''
  };
  writeJSONSafe(DB_FILE, db);
  res.json(db.contact);
});

// SPA fallback for local dev servers
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

module.exports = { app };
