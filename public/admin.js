const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

async function fetchContact() {
  const res = await fetch('/api/contact');
  return res.json();
}

async function saveContact(values) {
  const res = await fetch('/api/contact', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values)
  });
  return res.json();
}

async function initContact() {
  const form = $('#contactForm');
  const data = await fetchContact();
  for (const [k, v] of Object.entries(data)) {
    if (form.elements[k]) form.elements[k].value = v || '';
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    await saveContact(payload);
    alert('Сохранено');
  });

  // Avatar
  const avatarImg = $('#avatarPreview');
  avatarImg.src = data.avatarUrl || '';
  const avatarForm = $('#avatarForm');
  const avatarDel = $('#avatarDelete');
  avatarForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(avatarForm);
    const res = await fetch('/api/avatar', { method: 'POST', body: fd });
    const out = await res.json();
    if (out.avatar) avatarImg.src = out.avatar;
  });
  avatarDel.addEventListener('click', async () => {
    await fetch('/api/avatar', { method: 'DELETE' });
    avatarImg.src = '';
  });
}

async function loadPreview() {
  const res = await fetch('/api/photos');
  const data = await res.json();
  const wrap = $('#preview');
  wrap.innerHTML = '';
  (data.photos || []).forEach(p => {
    const div = document.createElement('div');
    div.className = 'thumb';
    const img = document.createElement('img');
    img.src = p.url; img.alt = p.name;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Удалить';
    btn.addEventListener('click', async () => {
      if (!confirm('Удалить это фото?')) return;
      const name = decodeURIComponent(p.url.split('/').pop());
      await fetch(`/api/photos/${encodeURIComponent(name)}`, { method: 'DELETE' });
      await loadPreview();
    });
    div.appendChild(img);
    div.appendChild(btn);
    wrap.appendChild(div);
  });
}

async function initUpload() {
  const form = $('#uploadForm');
  const status = $('#uploadStatus');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    status.textContent = 'Загрузка...';
    try {
      const res = await fetch('/api/photos', { method: 'POST', body: fd });
      const data = await res.json();
      status.textContent = `Готово: ${data.uploaded?.length || 0}`;
      await loadPreview();
    } catch (e) {
      status.textContent = 'Ошибка загрузки';
    }
  });
}

// Auth
async function checkAuth() {
  const res = await fetch('/api/auth/status');
  const { authenticated } = await res.json();
  const authSection = $('#authSection');
  const grid = document.querySelector('.grid');
  const logoutBtn = $('#logoutBtn');
  if (authenticated) {
    authSection.style.display = 'none';
    grid.style.display = '';
    logoutBtn.style.display = '';
    initContact();
    initUpload();
    loadPreview();
  } else {
    authSection.style.display = '';
    grid.style.display = 'none';
    logoutBtn.style.display = 'none';
  }
}

function initAuthUI() {
  const form = $('#loginForm');
  const msg = $('#loginMsg');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = '';
    const fd = new FormData(form);
    const pin = fd.get('pin');
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
    if (res.ok) {
      await checkAuth();
    } else {
      msg.textContent = 'Неверный PIN';
    }
  });
  $('#logoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    await checkAuth();
  });
}

initAuthUI();
checkAuth();
