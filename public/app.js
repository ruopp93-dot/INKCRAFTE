const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

// Reveal on scroll
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('in'); });
}, { threshold: 0.12 });
$$('.reveal').forEach(el => io.observe(el));

// Parallax card
const parallax = $('.parallax .card');
if (parallax) {
  const onMove = (e) => {
    const rect = parallax.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    parallax.style.transform = `rotateY(${x * 6}deg) rotateX(${-y * 6}deg) translateZ(20px)`;
  };
  parallax.addEventListener('mousemove', onMove);
  parallax.addEventListener('mouseleave', () => parallax.style.transform = '');
}

// Year
$('#year').textContent = new Date().getFullYear();

// Lightbox
const lightbox = $('#lightbox');
const lbImg = $('#lightbox img');
const lbClose = $('#lightbox .close');
function openLightbox(src, alt) {
  lbImg.src = src; lbImg.alt = alt || 'Работа тату';
  lightbox.classList.add('open');
}
function closeLightbox() { lightbox.classList.remove('open'); }
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
lbClose.addEventListener('click', closeLightbox);

// Fetch gallery
async function loadGallery() {
  try {
    const res = await fetch('/api/photos');
    const data = await res.json();
    const wrap = $('#gallery');
    wrap.innerHTML = '';
    const items = (data.photos || []);
    if (!items.length) {
      wrap.innerHTML = '<div class="muted">Пока нет загруженных работ. Добавьте их в админке.</div>';
      return;
    }
    items.forEach((p, i) => {
      const item = document.createElement('a');
      item.href = p.url;
      item.className = 'item';
      item.innerHTML = `<img loading="lazy" src="${p.url}" alt="Тату работа ${i+1}"/>`;
      item.addEventListener('click', (e) => { e.preventDefault(); openLightbox(p.url, `Работа ${i+1}`); });
      wrap.appendChild(item);
    });
  } catch (e) {
    console.error(e);
  }
}

// Contact links
async function loadContact() {
  try {
    const res = await fetch('/api/contact');
    const c = await res.json();
    $('#footerName').textContent = c.name || 'Тату-мастер';
    const links = [];
    if (c.phone) links.push(`<a class="link" href="tel:${c.phone}">📞 ${c.phone}</a>`);
    if (c.instagram) links.push(`<a class="link" target="_blank" href="https://instagram.com/${c.instagram}">📸 Instagram</a>`);
    if (c.telegram) links.push(`<a class="link" target="_blank" href="https://t.me/${c.telegram}">✈️ Telegram</a>`);
    if (c.whatsapp) {
      const msg = encodeURIComponent('Здравствуйте! Хочу записаться на тату.');
      const wa = `https://wa.me/${c.whatsapp.replace(/\D/g,'')}?text=${msg}`;
      links.push(`<a class="link" target="_blank" href="${wa}">💬 WhatsApp</a>`);
    }
    $('#contactLinks').innerHTML = links.join('') || '<div class="muted">Контакты скоро появятся</div>';

    // Use avatar in about card background if available
    if (c.avatarUrl) {
      const card = document.querySelector('.about-media .card');
      if (card) {
        card.style.background = `linear-gradient(180deg, rgba(0,0,0,.35), rgba(0,0,0,.55)), url('${c.avatarUrl}') center/cover no-repeat`;
        card.style.border = '1px solid #232329';
      }
    }
  } catch (e) {
    console.error(e);
  }
}

loadGallery();
loadContact();
