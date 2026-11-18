// Hồ sơ người chơi: vai trò, giới tính, đồng phục, tên, lớp, niên khóa — lưu trong localStorage.
import * as THREE from 'three';
import { createCharacter, lookFromProfile } from './character.js';

const KEY = 'ninhgiang-profile';
const FIRST_YEAR = 1961;
const LAST_YEAR = new Date().getFullYear();
const SUBJECTS = ['Toán', 'Ngữ văn', 'Tiếng Anh', 'Vật lí', 'Hóa học', 'Sinh học', 'Lịch sử', 'Địa lí', 'GDKT&PL', 'Tin học', 'Công nghệ', 'Thể dục', 'GDQP-AN', 'Khác'];

export const DEFAULT_PROFILE = { role: 'student', gender: 'male', season: 'summer', name: 'Khách', className: '12A1', year: '2015', subject: 'Toán', note: '' };

export function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
}

/** Hồ sơ đã lưu hợp lệ (dùng bỏ qua màn tạo nhân vật lần sau). */
export function isProfileComplete(p) {
  if (!p) return false;
  const name = (p.name || '').trim();
  if (name.length < 2 || name === DEFAULT_PROFILE.name) return false;
  if (p.role === 'student' && !(p.className || '').trim()) return false;
  return true;
}

export function saveProfile(p) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

export const honorific = p => (p.role === 'teacher' ? (p.gender === 'female' ? 'Cô' : 'Thầy') : '');
export const givenName = p => p.name.trim().split(/\s+/).pop();
export const schoolYears = p => `${p.year}–${+p.year + 3}`;

/** Mã phòng lớp (vd 12A12-2011) — khớp server `classCode`. */
export function classCodeFromParts(className, year) {
  const c = String(className ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 8);
  const y = String(year ?? '');
  if (!/^\d{1,2}[A-Z]{1,2}\d{0,2}$/.test(c) || !/^\d{4}$/.test(y) || +y < 1961 || +y > 2100) return null;
  return `${c}-${y}`;
}

/** Mã phòng từ hồ sơ học sinh (tự vào lớp khi online). */
export function profileClassCode(p) {
  if (!p || p.role === 'teacher') return null;
  return classCodeFromParts(p.className, p.year);
}

export function tagLines(p) {
  if (p.role === 'teacher') return [`${honorific(p)} ${p.name}`, `GV ${p.subject} · từ năm ${p.year}`];
  return [p.name, `Lớp ${p.className} · Niên khóa ${schoolYears(p)}`];
}

export function setupProfileForm({ onSubmit }) {
  const $ = id => document.getElementById(id);
  const form = $('profileForm');

  const years = [];
  for (let y = LAST_YEAR; y >= FIRST_YEAR; y--) years.push(y);
  const yearSel = $('pfYear');
  const fillYears = teacher => {
    const keep = yearSel.value;
    yearSel.replaceChildren(...years.map(y => new Option(teacher ? `${y}` : `${y} – ${y + 3}`, y)));
    if (keep) yearSel.value = keep;
  };
  $('pfSubject').replaceChildren(...SUBJECTS.map(s => new Option(s, s)));
  const classes = [];
  const maxClass = { 10: 12, 11: 12, 12: 12 };
  for (const g of [10, 11, 12]) for (const l of 'ABCD') for (let n = 1; n <= maxClass[g]; n++) classes.push(`${g}${l}${n}`);
  $('pfClassList').replaceChildren(...classes.map(c => new Option(c)));

  const radio = name => form.querySelector(`input[name="${name}"]:checked`)?.value;
  const setRadio = (name, v) => {
    const el = form.querySelector(`input[name="${name}"][value="${v}"]`);
    if (el) el.checked = true;
  };

  function read() {
    return {
      role: radio('pf-role'),
      gender: radio('pf-gender'),
      season: radio('pf-season'),
      name: $('pfName').value.trim().replace(/\s+/g, ' '),
      className: $('pfClass').value.trim().toUpperCase(),
      year: yearSel.value,
      subject: $('pfSubject').value,
      note: $('pfNote').value.trim(),
    };
  }

  function write(p) {
    setRadio('pf-role', p.role);
    setRadio('pf-gender', p.gender);
    setRadio('pf-season', p.season);
    fillYears(p.role === 'teacher');
    $('pfName').value = p.name === DEFAULT_PROFILE.name ? '' : p.name;
    $('pfClass').value = p.className || '';
    yearSel.value = p.year || '2015';
    $('pfSubject').value = p.subject || 'Toán';
    $('pfNote').value = p.note || '';
  }

  function valid(p) {
    if (p.name.length < 2) return 'Nhập họ và tên (ít nhất 2 ký tự).';
    if (p.role === 'student' && !p.className) return 'Nhập lớp của bạn, ví dụ 12A1.';
    return '';
  }

  // xem trước nhân vật 3D
  const pv = $('preview');
  const pr = new THREE.WebGLRenderer({ canvas: pv, antialias: true, alpha: true });
  pr.setPixelRatio(matchMedia('(pointer: coarse)').matches ? Math.min(devicePixelRatio, 1.25) : Math.min(devicePixelRatio, 2));
  pr.outputColorSpace = THREE.SRGBColorSpace;
  const ps = new THREE.Scene();
  ps.add(new THREE.HemisphereLight(0xffffff, 0x8a7a60, 2.2));
  const dl = new THREE.DirectionalLight(0xffffff, 1.6);
  dl.position.set(2, 4, 3);
  ps.add(dl);
  const pc = new THREE.PerspectiveCamera(32, pv.width / pv.height, 0.1, 20);
  pc.position.set(0, 1.15, 4.2);
  pc.lookAt(0, 0.85, 0);
  let preview = null, previewKey = '';

  function refreshPreview(p) {
    const key = [p.role, p.gender, p.season].join();
    if (key === previewKey) return;
    previewKey = key;
    const rot = preview ? preview.root.rotation.y : 0.5;
    if (preview) ps.remove(preview.root);
    preview = createCharacter(lookFromProfile(p));
    preview.root.rotation.y = rot;
    ps.add(preview.root);
  }

  function update() {
    const p = read();
    const teacher = p.role === 'teacher';
    if (yearSel.dataset.mode !== p.role) {
      fillYears(teacher);
      yearSel.dataset.mode = p.role;
    }
    $('rowClass').hidden = teacher;
    $('rowSubject').hidden = !teacher;
    $('pfUniformHint').hidden = teacher;
    $('pfUniformHint').textContent = p.season === 'winter'
      ? 'Đồng phục mùa đông: áo khoác trắng–xanh navy, quần xanh.'
      : 'Đồng phục mùa hè: áo sơ mi trắng, quần xanh đậm.';
    $('lblYear').textContent = teacher ? 'Năm về trường công tác' : 'Niên khóa';
    $('lblName').textContent = teacher ? `Họ và tên ${p.gender === 'female' ? 'cô' : 'thầy'}` : 'Họ và tên';
    $('pfNoteCount').textContent = `${p.note.length}/64`;
    const err = valid(p);
    $('startBtn').disabled = !!err;
    $('pfSummary').textContent = err || (teacher
      ? `${honorific(p)} ${p.name} · giáo viên ${p.subject} · về trường từ năm ${p.year}`
      : `${p.name} · lớp ${p.className} · niên khóa ${schoolYears(p)}`);
    $('pfSummary').classList.toggle('error', !!err);
    refreshPreview(p);
  }

  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const p = read();
    if (valid(p)) return;
    saveProfile(p);
    onSubmit(p);
  });

  write(loadProfile() || DEFAULT_PROFILE);
  update();

  return {
    open() {
      write(loadProfile() || DEFAULT_PROFILE);
      update();
    },
    tick(dt) {
      if (!preview || pv.offsetParent === null) return;
      preview.root.rotation.y += dt * 0.8;
      preview.update(dt, 0, false);
      pr.render(ps, pc);
    },
  };
}
