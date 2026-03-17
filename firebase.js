/* ══════════════════════════════════════════
   พาร์ตี้ไฟ — firebase.js
   Firebase SDK + Auth + Firestore + RTDB + FCM
   ══════════════════════════════════════════ */

import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, doc, getDoc, updateDoc,
  onSnapshot, query, orderBy, serverTimestamp, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getDatabase, ref as dbRef, onValue, set, push
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import {
  getMessaging, getToken, onMessage
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";

/* ══════════════════════════════════════════
   🔧 แก้ไขตรงนี้ — Firebase Config ของคุณ
   วิธีหา: Firebase Console
   → Project Settings → Your apps → Web app
   ══════════════════════════════════════════ */
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT_ID-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

/* ── VAPID Key สำหรับ Cloud Messaging ──
   วิธีหา: Firebase Console
   → Project Settings → Cloud Messaging → Web Push certificates
   ─────────────────────────────────────── */
const VAPID_KEY = "YOUR_VAPID_KEY";

/* ══════════════════════════════════════════
   INIT
   ══════════════════════════════════════════ */
const fbApp   = initializeApp(firebaseConfig);
const auth    = getAuth(fbApp);
const db      = getFirestore(fbApp);
const rtdb    = getDatabase(fbApp);

let messaging = null;
try { messaging = getMessaging(fbApp); } catch(e) { /* ไม่มี service worker ใน localhost */ }

/* ══════════════════════════════════════════
   STATE
   ══════════════════════════════════════════ */
let currentUser      = null;
let allActivities    = [];
let unsubFeed        = null;
let unsubNotif       = null;
let pendingContactId = null;

/* ══════════════════════════════════════════
   AUTH STATE LISTENER
   ══════════════════════════════════════════ */
onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (user) {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('mainApp').style.display    = 'block';
    document.getElementById('userAvatar').textContent   =
      (user.displayName || user.email || '?').slice(0, 2).toUpperCase();

    startFeedListener();
    startNotifListener();
    requestFCMPermission();
  } else {
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('mainApp').style.display    = 'none';
    if (unsubFeed)  { unsubFeed();  unsubFeed  = null; }
    if (unsubNotif) { unsubNotif(); unsubNotif = null; }
  }
});

/* ══════════════════════════════════════════
   FCM — ขอสิทธิ์แจ้งเตือน
   ══════════════════════════════════════════ */
async function requestFCMPermission() {
  if (!messaging || !currentUser) return;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;

    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (token) {
      await updateDoc(doc(db, 'users', currentUser.uid), { fcmToken: token })
        .catch(() => addDoc(collection(db, 'users'), { uid: currentUser.uid, fcmToken: token }));
    }

    onMessage(messaging, payload => {
      const { title, body } = payload.notification || {};
      window.showToast(`🔔 ${title}: ${body}`);
      document.getElementById('notifDot').classList.add('show');
    });
  } catch(e) {
    /* บน localhost / HTTP จะ fail — ปกติ */
  }
}

/* ══════════════════════════════════════════
   FIRESTORE — Realtime Feed Listener
   ══════════════════════════════════════════ */
function startFeedListener() {
  const q = query(collection(db, 'activities'), orderBy('createdAt', 'desc'));
  unsubFeed = onSnapshot(q, snap => {
    allActivities = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderFeed(allActivities);
    set(dbRef(rtdb, 'presence/activityCount'), allActivities.length);
  });
}

/* ══════════════════════════════════════════
   REALTIME DB — Notification Listener
   ══════════════════════════════════════════ */
function startNotifListener() {
  if (!currentUser) return;
  const notifRef = dbRef(rtdb, `notifications/${currentUser.uid}`);
  unsubNotif = onValue(notifRef, snap => {
    const data = snap.val();
    if (!data) return;
    const items = Object.entries(data)
      .map(([k, v]) => ({ key: k, ...v }))
      .sort((a, b) => b.timestamp - a.timestamp);
    const unread = items.filter(i => !i.read).length;
    document.getElementById('notifDot').classList.toggle('show', unread > 0);
    renderNotifications(items);
  });
}

function renderNotifications(items) {
  const panel = document.getElementById('notifPanel');
  if (!items.length) {
    panel.innerHTML = `<p style="color:var(--muted);text-align:center;padding:24px 0">ยังไม่มีการแจ้งเตือน</p>`;
    return;
  }
  panel.innerHTML = items.map(n => `
    <div class="notif-item ${n.read ? '' : 'notif-unread'}">
      <div class="notif-icon">${n.icon || '🔔'}</div>
      <div>
        <div class="notif-text">${n.text || ''}</div>
        <div class="notif-time">${timeAgo(n.timestamp)}</div>
      </div>
    </div>`).join('');
}

/* ══════════════════════════════════════════
   RENDER FEED
   ══════════════════════════════════════════ */
function renderFeed(acts) {
  const feed  = document.getElementById('feed');
  const label = document.getElementById('sectionLabel');

  if (!acts.length) {
    feed.innerHTML = `
      <div style="text-align:center;color:var(--muted);padding:56px 0">
        <i class="bi bi-binoculars" style="font-size:2.5rem;display:block;margin-bottom:12px"></i>
        ยังไม่มีกิจกรรม<br><small>กดปุ่ม + ด้านล่างเพื่อสร้างเลย!</small>
      </div>`;
    label.textContent = 'ไม่พบกิจกรรม';
    return;
  }

  label.textContent = `พบ ${acts.length} กิจกรรม`;
  feed.innerHTML = acts.map(buildCard).join('');

  feed.querySelectorAll('.card-top-area').forEach(el =>
    el.addEventListener('click', () =>
      openDetail(el.closest('[data-id]').dataset.id)
    )
  );
}

/* ── Build card HTML ── */
function buildCard(a) {
  const uid       = currentUser?.uid || '';
  const members   = Array.isArray(a.members)  ? a.members  : [];
  const requests  = Array.isArray(a.requests) ? a.requests : [];
  const joined    = members.includes(uid);
  const requested = requests.some(r => r.uid === uid);
  const full      = members.length >= a.peopleNeeded;
  const isOwner   = a.ownerId === uid;
  const need      = Math.max(0, a.peopleNeeded - members.length);
  const pendReqs  = requests.filter(r => r.status === 'pending').length;

  let btnHTML, btnClass;
  if (isOwner) {
    btnHTML  = `<i class="bi bi-person-check-fill"></i> กิจกรรมของคุณ`;
    btnClass = 's-ghost';
  } else if (joined) {
    btnHTML  = `<i class="bi bi-check-circle-fill"></i> เข้าร่วมแล้ว — กดเพื่อออก`;
    btnClass = 's-joined';
  } else if (requested) {
    btnHTML  = `<i class="bi bi-hourglass-split"></i> รอการอนุมัติ…`;
    btnClass = 's-ghost';
  } else if (full) {
    btnHTML  = `<i class="bi bi-x-circle"></i> เต็มแล้ว`;
    btnClass = 's-ghost';
  } else if (a.joinType === 'request') {
    btnHTML  = `<i class="bi bi-send-fill"></i> ส่ง Request เข้าร่วม`;
    btnClass = 's-purple';
  } else {
    btnHTML  = `<i class="bi bi-lightning-fill"></i> เข้าร่วมกิจกรรม`;
    btnClass = 's-lime';
  }

  const disabled  = (isOwner || full || requested) ? 'disabled' : '';
  const reqBadge  = (isOwner && pendReqs > 0)
    ? `<span class="request-badge"><i class="bi bi-bell-fill"></i> ${pendReqs} คำขอ</span>` : '';
  const badge     = a.urgent
    ? `<span class="urgency-badge" style="background:rgba(255,107,107,.15);color:#ff9898">ด่วน!</span>`
    : a.timeLabel
    ? `<span class="urgency-badge" style="background:rgba(255,255,255,.07);color:var(--muted)">${a.timeLabel}</span>`
    : '';

  return `
  <div class="activity-card" data-id="${a.id}" data-cat="${a.category || ''}" data-title="${a.title || ''}">
    <div class="card-accent-bar" style="background:${a.gradient || 'linear-gradient(90deg,#c8f135,#7be66e)'}"></div>
    <div class="card-body-custom">
      <div class="card-top-area">
        <div class="card-top">
          <div class="card-emoji">${a.emoji || '🎉'}</div>
          <div class="card-title-block">
            <div class="card-title">${a.title || 'ไม่มีชื่อ'}${reqBadge}</div>
            <div class="card-subtitle">${a.location || 'ไม่ระบุสถานที่'}</div>
          </div>
          ${badge}
        </div>
        <div class="card-info">
          <div class="info-pill people-pill">
            <i class="bi bi-people-fill"></i>
            <span class="pcount">ต้องการอีก <strong>${need}</strong> คน</span>
          </div>
          ${a.time     ? `<div class="info-pill"><i class="bi bi-clock"></i><span>${a.time}</span></div>` : ''}
          ${a.category ? `<div class="info-pill"><i class="bi bi-tag-fill" style="color:var(--accent2)"></i><span>${a.category}</span></div>` : ''}
        </div>
        <div class="avatar-stack">
          ${members.slice(0, 4).map((m, i) =>
            `<div class="av" style="background:${avColor(i)}">${(m || '?')[0].toUpperCase()}</div>`
          ).join('')}
          <span class="av-label">เข้าร่วม ${members.length}/${a.peopleNeeded} คน</span>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn-join ${btnClass}" style="flex:1" ${disabled}
          onclick="onJoinBtn(event,'${a.id}','${a.joinType || 'join'}','${isOwner}')">
          ${btnHTML}
        </button>
        ${isOwner && pendReqs > 0
          ? `<button class="btn-join s-purple" style="width:48px;flex-shrink:0"
               onclick="openRequests(event,'${a.id}')">
               <i class="bi bi-person-lines-fill"></i>
             </button>` : ''}
      </div>
    </div>
  </div>`;
}

function avColor(i) {
  return [
    'linear-gradient(135deg,#f77f00,#d62828)',
    'linear-gradient(135deg,#4cc9f0,#4361ee)',
    'linear-gradient(135deg,#7b2d8b,#c77dff)',
    'linear-gradient(135deg,#43aa8b,#90be6d)'
  ][i % 4];
}

/* ══════════════════════════════════════════
   JOIN / LEAVE TOGGLE
   ══════════════════════════════════════════ */
window.onJoinBtn = async (e, actId, joinType, isOwner) => {
  e.stopPropagation();
  if (isOwner === 'true') return;
  if (!currentUser) { window.showToast('⚠️ กรุณาเข้าสู่ระบบก่อน'); return; }

  const btn = e.currentTarget;
  if (btn.disabled) return;

  const actRef = doc(db, 'activities', actId);
  const snap   = await getDoc(actRef);
  if (!snap.exists()) return;

  const a       = snap.data();
  const members = Array.isArray(a.members) ? a.members : [];
  const joined  = members.includes(currentUser.uid);

  if (joined) {
    if (!confirm('ออกจากกิจกรรมนี้?')) return;
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span>`;
    await updateDoc(actRef, { members: arrayRemove(currentUser.uid) });
    set(dbRef(rtdb, `activityMeta/${actId}/memberCount`), members.length - 1);
    window.showToast('👋 ออกจากกิจกรรมแล้ว');
    return;
  }

  if (joinType === 'request') {
    pendingContactId = actId;
    document.getElementById('contactTitle').textContent = `📩 ส่ง Request: ${a.title}`;
    document.getElementById('contactSub').textContent   = 'ผู้จัดจะได้รับการแจ้งเตือนและอนุมัติคำขอ';
    document.getElementById('contactMsg').value = '';
    window.openModal('contactModal');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<span class="spin"></span>`;
  try {
    await updateDoc(actRef, { members: arrayUnion(currentUser.uid) });
    set(dbRef(rtdb, `activityMeta/${actId}/memberCount`), members.length + 1);
    await pushNotification(a.ownerId, {
      icon: a.emoji || '🎉',
      text: `${currentUser.displayName || currentUser.email} เข้าร่วม "${a.title}"`,
      activityId: actId, read: false, timestamp: Date.now()
    });
    window.showToast('✅ เข้าร่วมกิจกรรมสำเร็จ!');
  } catch(err) {
    window.showToast('❌ ' + err.message);
    btn.disabled = false;
  }
};

/* ══════════════════════════════════════════
   SUBMIT REQUEST
   ══════════════════════════════════════════ */
window.submitRequest = async () => {
  const msg = document.getElementById('contactMsg').value.trim();
  if (!msg) { window.showToast('⚠️ กรุณาพิมพ์ข้อความก่อน'); return; }

  const btn = document.getElementById('contactSubmitBtn');
  btn.disabled  = true;
  btn.innerHTML = `<span class="spin light"></span> กำลังส่ง…`;

  const actRef = doc(db, 'activities', pendingContactId);
  const snap   = await getDoc(actRef);
  const a      = snap.data();

  try {
    await updateDoc(actRef, {
      requests: arrayUnion({
        uid:    currentUser.uid,
        name:   currentUser.displayName || currentUser.email,
        msg,
        status: 'pending',
        sentAt: Date.now()
      })
    });
    await pushNotification(a.ownerId, {
      icon: '📩',
      text: `${currentUser.displayName || currentUser.email} ส่ง request เข้าร่วม "${a.title}"`,
      activityId: pendingContactId, read: false, timestamp: Date.now()
    });
    window.showToast('✉️ ส่ง Request แล้ว รอเจ้าของห้องอนุมัติ!');
    window.closeModal('contactModal');
  } catch(err) {
    window.showToast('❌ ' + err.message);
  } finally {
    btn.disabled  = false;
    btn.innerHTML = `<i class="bi bi-send-fill"></i> ส่ง Request`;
  }
};

/* ══════════════════════════════════════════
   REQUESTS PANEL (Host view)
   ══════════════════════════════════════════ */
window.openRequests = async (e, actId) => {
  e.stopPropagation();
  const snap = await getDoc(doc(db, 'activities', actId));
  const a    = snap.data();
  const reqs = (a.requests || []).filter(r => r.status === 'pending');

  document.getElementById('reqModalSub').textContent   = `กิจกรรม: ${a.title}`;
  document.getElementById('requestsList').innerHTML = reqs.length
    ? reqs.map((r, i) => `
        <div class="member-row">
          <div class="member-av" style="background:${avColor(i)}">${(r.name || '?')[0].toUpperCase()}</div>
          <div style="flex:1">
            <div style="font-weight:600;font-size:.9rem">${r.name}</div>
            <div style="font-size:.8rem;color:var(--muted)">${r.msg}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button onclick="approveRequest('${actId}','${r.uid}','${r.name}')"
              style="padding:6px 12px;border-radius:8px;border:none;background:var(--accent);color:#0d0d0f;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif">
              ✓ อนุมัติ
            </button>
            <button onclick="rejectRequest('${actId}','${r.uid}')"
              style="padding:6px 12px;border-radius:8px;border:none;background:rgba(255,107,107,.15);color:#ff9898;border:1px solid rgba(255,107,107,.3);cursor:pointer;font-family:'Sarabun',sans-serif">
              ✕
            </button>
          </div>
        </div>`).join('')
    : `<p style="color:var(--muted);padding:24px 0;text-align:center">ไม่มีคำขอที่รอการอนุมัติ</p>`;

  window.openModal('requestsModal');
};

window.approveRequest = async (actId, uid, name) => {
  const actRef      = doc(db, 'activities', actId);
  const snap        = await getDoc(actRef);
  const a           = snap.data();
  const updatedReqs = (a.requests || []).map(r => r.uid === uid ? { ...r, status: 'approved' } : r);

  await updateDoc(actRef, { requests: updatedReqs, members: arrayUnion(uid) });
  set(dbRef(rtdb, `activityMeta/${actId}/memberCount`), (a.members || []).length + 1);
  await pushNotification(uid, {
    icon: '✅',
    text: `คำขอเข้าร่วม "${a.title}" ได้รับการอนุมัติแล้ว!`,
    activityId: actId, read: false, timestamp: Date.now()
  });
  window.showToast(`✅ อนุมัติ ${name} แล้ว`);
  window.closeModal('requestsModal');
};

window.rejectRequest = async (actId, uid) => {
  const actRef      = doc(db, 'activities', actId);
  const snap        = await getDoc(actRef);
  const a           = snap.data();
  const updatedReqs = (a.requests || []).map(r => r.uid === uid ? { ...r, status: 'rejected' } : r);

  await updateDoc(actRef, { requests: updatedReqs });
  await pushNotification(uid, {
    icon: '❌',
    text: `คำขอเข้าร่วม "${a.title}" ไม่ได้รับการอนุมัติ`,
    activityId: actId, read: false, timestamp: Date.now()
  });
  window.showToast('ปฏิเสธ request แล้ว');
  window.closeModal('requestsModal');
};

/* ── Push via Realtime DB ── */
async function pushNotification(toUid, payload) {
  if (!toUid) return;
  await push(dbRef(rtdb, `notifications/${toUid}`), payload);
}

/* ══════════════════════════════════════════
   DETAIL MODAL
   ══════════════════════════════════════════ */
window.openDetail = (id) => {
  const a = allActivities.find(x => x.id === id);
  if (!a) return;

  const members  = a.members  || [];
  const requests = (a.requests || []).filter(r => r.status === 'pending');
  const isOwner  = a.ownerId === currentUser?.uid;

  document.getElementById('detailContent').innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
      <div class="card-emoji" style="width:56px;height:56px;font-size:1.8rem">${a.emoji || '🎉'}</div>
      <div>
        <div style="font-weight:700;font-size:1.2rem">${a.title}</div>
        <div style="font-size:.82rem;color:var(--muted)">${a.category || ''} · จัดโดย ${a.ownerName || 'ไม่ระบุ'}</div>
      </div>
    </div>
    ${a.description ? `<p style="font-size:.9rem;color:var(--muted);margin-bottom:14px">${a.description}</p>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      <div class="info-pill people-pill">
        <i class="bi bi-people-fill"></i>
        <span class="pcount">ต้องการ <strong>${a.peopleNeeded}</strong> คน</span>
      </div>
      ${a.time     ? `<div class="info-pill"><i class="bi bi-clock"></i><span>${a.time}</span></div>` : ''}
      ${a.location ? `<div class="info-pill"><i class="bi bi-geo-alt-fill"></i><span>${a.location}</span></div>` : ''}
      <div class="info-pill">
        <i class="bi bi-shield-fill-check" style="color:${a.joinType === 'request' ? '#b39dff' : 'var(--accent)'}"></i>
        <span>${a.joinType === 'request' ? 'ต้องอนุมัติ' : 'เข้าร่วมทันที'}</span>
      </div>
    </div>
    <div class="sec-head">สมาชิก (${members.length}/${a.peopleNeeded})</div>
    ${members.length
      ? members.map((m, i) => `
          <div class="member-row">
            <div class="member-av" style="background:${avColor(i)}">${m[0].toUpperCase()}</div>
            <div>
              <div style="font-weight:500;font-size:.9rem">${m}</div>
              <div style="font-size:.75rem;color:var(--muted)">${i === 0 ? 'ผู้จัด' : 'สมาชิก'}</div>
            </div>
          </div>`).join('')
      : `<p style="color:var(--muted);font-size:.85rem;padding:12px 0">ยังไม่มีผู้เข้าร่วม</p>`}
    ${isOwner && requests.length
      ? `<div class="sec-head">คำขอรอการอนุมัติ (${requests.length})</div>
         ${requests.map((r, i) => `
           <div class="member-row">
             <div class="member-av" style="background:${avColor(i)}">${r.name[0].toUpperCase()}</div>
             <div style="flex:1">
               <div style="font-weight:500;font-size:.9rem">${r.name}</div>
               <div style="font-size:.78rem;color:var(--muted)">${r.msg}</div>
             </div>
             <button onclick="approveRequest('${a.id}','${r.uid}','${r.name}')"
               style="padding:5px 11px;border-radius:8px;border:none;background:var(--accent);color:#0d0d0f;font-weight:600;cursor:pointer;font-size:.82rem;font-family:'Sarabun',sans-serif">
               อนุมัติ
             </button>
           </div>`).join('')}` : ''}
    <div style="height:12px"></div>`;

  window.openModal('detailModal');
};

/* ══════════════════════════════════════════
   CREATE ACTIVITY
   ══════════════════════════════════════════ */
window.submitCreate = async () => {
  if (!currentUser) { window.showToast('⚠️ กรุณาเข้าสู่ระบบก่อน'); return; }

  const title  = document.getElementById('c-title').value.trim();
  const people = parseInt(document.getElementById('c-people').value) || 0;
  if (!title)     { window.showToast('⚠️ กรุณาใส่ชื่อกิจกรรม'); return; }
  if (people < 1) { window.showToast('⚠️ ระบุจำนวนคนที่ต้องการ'); return; }

  const emoji    = document.querySelector('.emoji-opt.sel')?.dataset.e || '🎉';
  const gradient = document.querySelector('.grad-opt.sel')?.dataset.g  || 'linear-gradient(90deg,#c8f135,#7be66e)';
  const btn      = document.getElementById('createSubmitBtn');
  btn.disabled   = true;
  btn.innerHTML  = `<span class="spin"></span> กำลังสร้าง…`;

  try {
    const docRef = await addDoc(collection(db, 'activities'), {
      title,
      location:     document.getElementById('c-loc').value.trim(),
      time:         document.getElementById('c-time').value.trim(),
      peopleNeeded: people,
      description:  document.getElementById('c-desc').value.trim(),
      emoji,
      gradient,
      category:     document.getElementById('c-cat').value,
      joinType:     document.getElementById('c-jointype').value,
      members:      [currentUser.uid],
      requests:     [],
      ownerId:      currentUser.uid,
      ownerName:    currentUser.displayName || currentUser.email,
      createdAt:    serverTimestamp(),
      urgent:       false,
    });

    set(dbRef(rtdb, `activityMeta/${docRef.id}`), {
      memberCount: 1,
      title
    });

    window.showToast('🎉 สร้างกิจกรรมสำเร็จ!');
    window.closeModal('createModal');
    ['c-title', 'c-loc', 'c-time', 'c-people', 'c-desc'].forEach(id => {
      document.getElementById(id).value = '';
    });
  } catch(err) {
    window.showToast('❌ ' + err.message);
  } finally {
    btn.disabled  = false;
    btn.innerHTML = `<i class="bi bi-plus-circle-fill"></i> สร้างกิจกรรม`;
  }
};

/* ══════════════════════════════════════════
   AUTH FUNCTIONS
   ══════════════════════════════════════════ */
window.doLogin = async (btn) => {
  const email = document.getElementById('li-email').value.trim();
  const pass  = document.getElementById('li-pass').value;
  const errEl = document.getElementById('li-err');
  errEl.textContent = '';
  setLoading(btn, true);
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch(e) {
    errEl.textContent = thErr(e.code);
    setLoading(btn, false, 'เข้าสู่ระบบ');
  }
};

window.doRegister = async (btn) => {
  const name  = document.getElementById('re-name').value.trim();
  const email = document.getElementById('re-email').value.trim();
  const pass  = document.getElementById('re-pass').value;
  const errEl = document.getElementById('re-err');
  errEl.textContent = '';
  setLoading(btn, true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    if (name) await updateProfile(cred.user, { displayName: name });
  } catch(e) {
    errEl.textContent = thErr(e.code);
    setLoading(btn, false, 'สมัครสมาชิก');
  }
};

window.doGoogle = async () => {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch(e) {
    window.showToast('❌ ' + e.message);
  }
};

window.doSignOut = async () => {
  if (!confirm('ออกจากระบบ?')) return;
  await signOut(auth);
};

/* ── Error messages (Thai) ── */
function thErr(code) {
  const map = {
    'auth/user-not-found':       'ไม่พบบัญชีนี้',
    'auth/wrong-password':       'รหัสผ่านไม่ถูกต้อง',
    'auth/email-already-in-use': 'อีเมลนี้ถูกใช้แล้ว',
    'auth/weak-password':        'รหัสผ่านต้องมีอย่างน้อย 6 ตัว',
    'auth/invalid-email':        'รูปแบบอีเมลไม่ถูกต้อง',
    'auth/invalid-credential':   'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  };
  return map[code] || code;
}

function setLoading(btn, loading, resetText = '') {
  btn.disabled = loading;
  btn.querySelector('span').textContent = loading ? 'กำลังดำเนินการ…' : resetText;
}

/* ── Utility ── */
function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000)    return 'เมื่อกี้';
  if (diff < 3600000)  return `${Math.floor(diff / 60000)} นาทีที่แล้ว`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} ชั่วโมงที่แล้ว`;
  return `${Math.floor(diff / 86400000)} วันที่แล้ว`;
}
