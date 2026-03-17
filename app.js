/* ══════════════════════════════════════════
   พาร์ตี้ไฟ — app.js
   UI interactions (ไม่เกี่ยวกับ Firebase)
   ══════════════════════════════════════════ */

/* ════════════════════════════════
   MODALS
════════════════════════════════ */
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

window.openModal  = openModal;
window.closeModal = closeModal;

/* ════════════════════════════════
   TOAST NOTIFICATION
════════════════════════════════ */
let _toastTimer;

function showToast(msg) {
  const t = document.getElementById('toastBar');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

window.showToast = showToast;

/* ════════════════════════════════
   FILTER CHIPS + SEARCH
════════════════════════════════ */
document.querySelectorAll('.chip').forEach(chip =>
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    applyFilter();
  })
);

function applyFilter() {
  const cat   = document.querySelector('.chip.active')?.dataset.cat || 'all';
  const query = (document.getElementById('searchInput')?.value || '').toLowerCase();

  document.querySelectorAll('.activity-card').forEach(card => {
    const matchCat   = cat === 'all' || card.dataset.cat === cat;
    const matchQuery = !query || card.dataset.title.toLowerCase().includes(query);
    card.style.display = (matchCat && matchQuery) ? '' : 'none';
  });
}

window.applyFilter = applyFilter;

/* ════════════════════════════════
   BOTTOM NAVIGATION
════════════════════════════════ */
function setNav(el, page) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  el.classList.add('active');

  if (page === 'explore') showToast('🧭 สำรวจ — เร็วๆ นี้!');
  if (page === 'myplans') showToast('📅 แผนของฉัน — เร็วๆ นี้!');
  if (page === 'profile') showToast('👤 โปรไฟล์ — เร็วๆ นี้!');
}

window.setNav = setNav;

/* ════════════════════════════════
   AUTH TAB SWITCHER
════════════════════════════════ */
function switchTab(tab) {
  document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
  document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
  document.getElementById('panelLogin').style.display    = tab === 'login'    ? '' : 'none';
  document.getElementById('panelRegister').style.display = tab === 'register' ? '' : 'none';
  document.getElementById('li-err').textContent = '';
  document.getElementById('re-err').textContent = '';
}

window.switchTab = switchTab;

/* ════════════════════════════════
   EMOJI PICKER
════════════════════════════════ */
document.querySelectorAll('.emoji-opt').forEach(el =>
  el.addEventListener('click', () => {
    document.querySelectorAll('.emoji-opt').forEach(e => e.classList.remove('sel'));
    el.classList.add('sel');
  })
);

/* ════════════════════════════════
   GRADIENT PICKER
════════════════════════════════ */
document.querySelectorAll('.grad-opt').forEach(el =>
  el.addEventListener('click', () => {
    document.querySelectorAll('.grad-opt').forEach(e => e.classList.remove('sel'));
    el.classList.add('sel');
  })
);
