const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
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

// Cloudinary config (optional)
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUD_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUD_API_SECRET = process.env.CLOUDINARY_API_SECRET;
const CLOUD_FOLDER = process.env.CLOUDINARY_FOLDER || 'inkcraft';
const USE_CLOUD = !!(CLOUD_NAME && CLOUD_API_KEY && CLOUD_API_SECRET);
if (USE_CLOUD) {
  cloudinary.config({
    cloud_name: CLOUD_NAME,
    api_key: CLOUD_API_KEY,
    api_secret: CLOUD_API_SECRET,
    secure: true,
  });
}

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

// Upload storage: memory when using Cloudinary, disk otherwise
const storage = USE_CLOUD
  ? multer.memoryStorage()
  : multer.diskStorage({
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
app.get('/api/photos', async (req, res) => {
  try {
    if (USE_CLOUD) {
      // List from Cloudinary folder /gallery
      const result = await cloudinary.search
        .expression(`folder:${CLOUD_FOLDER}/gallery`)
        .sort_by('created_at', 'desc')
        .max_results(100)
        .execute();
      const photos = (result.resources || []).map(r => ({ url: r.secure_url, publicId: r.public_id }));
      return res.json({ photos });
    } else {
      const db = readJSONSafe(DB_FILE, defaultDB);
      const avatarName = db?.contact?.avatar ? path.basename(db.contact.avatar) : '';
      const files = fs.readdirSync(UPLOADS_DIR)
        .filter(f => allowedExt.has(path.extname(f).toLowerCase()))
        .filter(f => f !== avatarName)
        .map(f => ({ url: `/uploads/${encodeURIComponent(f)}`, publicId: f }));
      return res.json({ photos: files });
    }
  } catch (e) { res.status(500).json({ error: 'Не удалось получить список работ' }); }
});
app.post('/api/photos', requireAuth, upload.array('photos', 20), async (req, res) => {
  try {
    if (USE_CLOUD) {
      const uploads = [];
      for (const file of (req.files || [])) {
        const buffer = file.buffer;
        const uploaded = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream({ folder: `${CLOUD_FOLDER}/gallery` }, (err, result) => {
            if (err) return reject(err);
            resolve(result);
          });
          stream.end(buffer);
        });
        uploads.push({ url: uploaded.secure_url, publicId: uploaded.public_id });
      }
      return res.json({ uploaded: uploads });
    } else {
      const files = (req.files || []).map(f => ({ url: `/uploads/${encodeURIComponent(f.filename)}`, publicId: f.filename }));
      return res.json({ uploaded: files });
    }
  } catch (e) {
    res.status(500).json({ error: 'Загрузка не удалась' });
  }
});
app.delete('/api/photos', requireAuth, async (req, res) => {
  try {
    const id = req.body?.publicId;
    if (!id) return res.status(400).json({ error: 'publicId обязателен' });
    if (USE_CLOUD) {
      await cloudinary.uploader.destroy(id);
      return res.json({ ok: true });
    } else {
      const name = path.basename(id);
      const file = path.join(UPLOADS_DIR, name);
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return res.json({ ok: true });
    }
  } catch (e) { return res.status(500).json({ error: 'Не удалось удалить файл' }); }
});

// Avatar upload (Cloudinary preferred)
const avatarUpload = upload.single('avatar');
app.post('/api/avatar', requireAuth, (req, res, next) => avatarUpload(req, res, async (err) => {
  if (err) return res.status(400).json({ error: err.message });
  const db = readJSONSafe(DB_FILE, defaultDB);
  db.contact = db.contact || {};
  try {
    if (USE_CLOUD) {
      // delete previous avatar
      if (db.contact.avatarPublicId) {
        try { await cloudinary.uploader.destroy(db.contact.avatarPublicId); } catch {}
      }
      const uploaded = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ folder: `${CLOUD_FOLDER}/avatar`, public_id: 'master', overwrite: true }, (err2, result) => {
          if (err2) return reject(err2);
          resolve(result);
        });
        stream.end(req.file.buffer);
      });
      db.contact.avatarPublicId = uploaded.public_id;
      db.contact.avatar = uploaded.secure_url; // keep URL for client
      writeJSONSafe(DB_FILE, db);
      return res.json({ avatar: uploaded.secure_url });
    } else {
      const file = req.file?.filename;
      if (!file) return res.status(400).json({ error: 'Файл не получен' });
      // delete previous local avatar
      if (db.contact?.avatar) {
        const prev = path.join(UPLOADS_DIR, path.basename(db.contact.avatar));
        if (fs.existsSync(prev)) try { fs.unlinkSync(prev); } catch {}
      }
      db.contact.avatar = file;
      writeJSONSafe(DB_FILE, db);
      return res.json({ avatar: `/uploads/${encodeURIComponent(file)}` });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Не удалось загрузить аватар' });
  }
}));
app.delete('/api/avatar', requireAuth, async (req, res) => {
  const db = readJSONSafe(DB_FILE, defaultDB);
  if (USE_CLOUD && db.contact?.avatarPublicId) {
    try { await cloudinary.uploader.destroy(db.contact.avatarPublicId); } catch {}
    db.contact.avatarPublicId = '';
    db.contact.avatar = '';
    writeJSONSafe(DB_FILE, db);
  } else if (db.contact?.avatar) {
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
  let avatarUrl = '';
  if (contact.avatar) {
    // If already a full URL (cloudinary), use as-is; otherwise build local path
    avatarUrl = /^https?:\/\//.test(contact.avatar)
      ? contact.avatar
      : `/uploads/${encodeURIComponent(path.basename(contact.avatar))}`;
  }
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
    avatar: db.contact.avatar || '',
    avatarPublicId: db.contact.avatarPublicId || ''
  };
  writeJSONSafe(DB_FILE, db);
  res.json(db.contact);
});

// SPA fallback for local dev servers
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

module.exports = { app };
