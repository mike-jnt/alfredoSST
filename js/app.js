import { PUBLIC_DEFAULT_COURSES } from "./default-courses.js";
import { api, backendReady } from "./api.js";
const courseDefaults = { videoLabel: 'Abrir capacitación en YouTube' };

function normalizeCourse(course) {
  return {
    ...courseDefaults,
    ...course,
    id: course.courseId || course.id,
    courseId: course.courseId || course.id,
    learn: Array.isArray(course.learn) ? course.learn : [],
    questions: Array.isArray(course.questions) ? course.questions : [],
    resources: Array.isArray(course.resources) ? course.resources : [],
    coverResourceId: course.coverResourceId || ""
  };
}

let courses = backendReady ? [] : PUBLIC_DEFAULT_COURSES.map(normalizeCourse);

const state = {
  category: 'Todos',
  query: '',
  course: null,
  question: 0,
  answers: [],
  stage: 'intro',
  checkpoint: 0,
  attemptToken: null
};

const select = (selector, scope = document) => scope.querySelector(selector);
const selectAll = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const homeView = select('#homeView');
const courseView = select('#courseView');
const courseGrid = select('#courseGrid');

function escapeHTML(value = '') {
  const element = document.createElement('div');
  element.textContent = String(value);
  return element.innerHTML;
}

function escapeAttr(value = '') {
  return escapeHTML(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderFilters() {
  const categories = ['Todos', ...new Set(courses.map(course => course.category).filter(Boolean))];
  if (!categories.includes(state.category)) state.category = 'Todos';
  select('#filterRow').innerHTML = categories.map(category => `<button type="button" class="${state.category === category ? 'active' : ''}" data-category="${escapeAttr(category)}">${escapeHTML(category)}</button>`).join('');
}

function renderCourses() {
  const query = state.query.toLowerCase().trim();
  const filtered = courses.filter(course => (state.category === 'Todos' || course.category === state.category)
    && `${course.title} ${course.description} ${course.category}`.toLowerCase().includes(query));
  courseGrid.innerHTML = filtered.map((course, index) => `
    <article class="course-card reveal visible" style="--course-accent:${escapeAttr(course.theme)};--course-soft:${escapeAttr(course.themeSoft)};--delay:${index * 55}ms">
      <div class="course-card-glow" aria-hidden="true"></div>
      ${course.coverResourceId ? `<img class="course-card-cover" src="${escapeAttr(api.resourceUrl(course.coverResourceId))}" alt="" loading="lazy">` : ''}
      <div class="course-top"><span class="course-number">${escapeHTML(course.number)}</span><span class="course-icon">${escapeHTML(course.icon)}</span></div>
      <span class="course-category">${escapeHTML(course.category)}</span>
      <h3>${escapeHTML(course.title)}</h3>
      <p>${escapeHTML(course.description)}</p>
      <div class="course-card-foot"><span>${escapeHTML(course.duration)} · ${course.questions.length} preguntas</span><a href="#curso/${encodeURIComponent(course.id)}" data-course="${escapeAttr(course.id)}" aria-label="Abrir curso ${escapeAttr(course.title)}">Entrar <span aria-hidden="true">↗</span></a></div>
    </article>`).join('');
  select('#emptyCourses').hidden = filtered.length > 0;
}

function navigateToCourse(id) {
  const course = courses.find(item => item.id === id);
  if (!course) {
    showToast('Este curso no está disponible');
    return;
  }
  const nextHash = `#curso/${course.id}`;
  if (location.hash !== nextHash) history.pushState({ courseId: course.id }, '', nextHash);
  showCourse(course);
}

function showCourse(course) {
  state.course = course;
  state.question = 0;
  state.answers = [];
  state.checkpoint = 0;
  state.attemptToken = null;
  state.stage = 'intro';
  homeView.hidden = true;
  courseView.hidden = false;
  document.body.classList.add('course-open');
  renderCoursePage();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function showHome() {
  courseView.hidden = true;
  courseView.innerHTML = '';
  homeView.hidden = false;
  document.body.classList.remove('course-open');
  state.course = null;
  state.stage = 'home';
  requestAnimationFrame(() => {
    if (!location.hash || location.hash === '#inicio') return;
    try {
      select(location.hash)?.scrollIntoView({ behavior: 'smooth' });
    } catch { /* Ignore malformed fragments. */ }
  });
}

function renderCoursePage() {
  const course = state.course;
  if (!course) return;
  const safeVideoUrl = escapeAttr(course.videoUrl);
  courseView.style.setProperty('--course-accent', course.theme);
  courseView.style.setProperty('--course-soft', course.themeSoft);
  courseView.innerHTML = `
    <section class="course-hero">
      <div class="course-orbit one" aria-hidden="true"></div><div class="course-orbit two" aria-hidden="true"></div>
      <div class="course-hero-inner">
        <a class="back-link" href="#cursos">← Volver a todos los cursos</a>
        <div class="course-hero-grid">
          <div class="course-title-block reveal visible">
            <span class="course-kicker">Curso ${escapeHTML(course.number)} · ${escapeHTML(course.category)}</span>
            <h1>${escapeHTML(course.title)}</h1>
            <p>${escapeHTML(course.description)}</p>
            <div class="course-stats"><span><b>${escapeHTML(course.duration)}</b> de contenido</span><span><b>${course.questions.length}</b> preguntas</span><span><b>80%</b> para aprobar</span></div>
          </div>
          ${course.coverResourceId ? `<div class="course-cover-hero reveal visible"><img src="${escapeAttr(api.resourceUrl(course.coverResourceId))}" alt="Imagen de ${escapeAttr(course.title)}"></div>` : `<div class="course-symbol reveal visible" aria-hidden="true"><span>${escapeHTML(course.icon)}</span><small>${escapeHTML(course.number)}</small></div>`}
        </div>
      </div>
    </section>

    <nav class="course-progress" aria-label="Progreso del curso">
      <span class="done"><b>1</b> Mira el video</span><i></i>
      <span class="current"><b>2</b> Preguntas y códigos</span><i></i>
      <span><b>3</b> Obtén tu certificado</span>
    </nav>

    <section class="course-content">
      <div class="video-stage reveal visible">
        <div class="video-copy">
          <span class="stage-number">PASO 01</span>
          <h2>Mira el video completo</h2>
          <p>El contenido se abre en YouTube. Durante la reproducción aparecerán tres códigos: anótalos en el orden en que los veas.</p>
          <a class="button video-button" href="${safeVideoUrl}" target="_blank" rel="noopener noreferrer"><span class="play-mini">▶</span>${escapeHTML(course.videoLabel)}</a>
          <small>Cuando termines, vuelve a esta página. Tu progreso seguirá aquí.</small>
        </div>
        <a class="video-visual" href="${safeVideoUrl}" target="_blank" rel="noopener noreferrer" aria-label="Abrir el video de ${escapeAttr(course.title)} en YouTube">
          <span class="watch-label">VIDEO DEL CURSO</span><span class="play-disc">▶</span><strong>${escapeHTML(course.title)}</strong><em>Ver ahora en YouTube ↗</em>
        </a>
      </div>

      <div class="learning-grid reveal visible">
        <div><span class="stage-number ink">LO QUE APRENDERÁS</span><h2>Tres ideas para llevar a la práctica</h2></div>
        <ol>${course.learn.map((item, index) => `<li><span>0${index + 1}</span><p>${escapeHTML(item)}</p></li>`).join('')}</ol>
      </div>

      ${course.resources.filter(item => item.kind !== 'cover').length ? `<section class="course-resources reveal visible"><div><span class="stage-number ink">RECURSOS DEL CURSO</span><h2>Material para consultar</h2><p>Estos archivos están almacenados directamente en Firestore.</p></div><div class="course-resource-list">${course.resources.filter(item => item.kind !== 'cover').map(item => `<a href="${escapeAttr(api.resourceUrl(item.id))}" target="_blank" rel="noopener noreferrer"><span>↗</span><div><strong>${escapeHTML(item.name)}</strong><small>${escapeHTML(item.mimeType || 'Recurso')} · ${Math.max(1, Math.round(Number(item.size || 0) / 1024))} KB</small></div></a>`).join('')}</div></section>` : ''}

      <section class="unlock-section reveal visible" id="courseWorkspace">${renderAssessmentIntro()}</section>
    </section>`;
  courseView.onclick = handleCourseAction;
}

function renderAssessmentIntro() {
  return `<div class="ready-panel"><div class="ready-check">▶</div><div><span class="stage-number ink">PASO 02</span><h2>Comienza la evaluación</h2><p>Responderás ${state.course.questions.length} preguntas. Después de las primeras tres respuestas te pediremos, uno por uno, los códigos que aparecieron en el video.</p><div class="assessment-sequence"><span>Pregunta 1</span><b>→ Código 1 →</b><span>Pregunta 2</span><b>→ Código 2 →</b><span>Pregunta 3</span><b>→ Código 3 →</b><span>Continúa la evaluación</span></div><button class="button button-primary" type="button" data-action="begin-quiz">Comenzar preguntas</button></div></div>`;
}

function handleCourseAction(event) {
  const target = event.target.closest('[data-action]');
  const action = target?.dataset.action;
  if (action === 'begin-quiz') {
    state.stage = 'quiz';
    renderQuestion();
  } else if (action === 'retry-quiz') {
    state.question = 0;
    state.answers = [];
    state.checkpoint = 0;
    state.attemptToken = null;
    state.stage = 'quiz';
    renderQuestion();
  } else if (action === 'retry-score') {
    renderScore();
  } else if (action === 'print-certificate') {
    window.print();
  } else if (action === 'copy-certificate') {
    copyText(target.dataset.code, 'Código copiado');
  }
}

function progressForQuestion(index) {
  const totalSteps = state.course.questions.length + 3;
  const completed = index + Math.min(index, 3);
  return Math.max(5, Math.round(((completed + 1) / totalSteps) * 100));
}

function renderCodeCheckpoint(codeIndex) {
  state.stage = 'checkpoint';
  state.checkpoint = codeIndex;
  const workspace = select('#courseWorkspace');
  const progress = Math.round((((codeIndex + 1) * 2) / (state.course.questions.length + 3)) * 100);
  workspace.innerHTML = `<div class="quiz-shell checkpoint-shell">
    <header class="quiz-header"><div><span class="stage-number ink">CONTROL DE ATENCIÓN</span><h2>Ingresa el código ${codeIndex + 1}</h2></div><strong>${progress}%</strong></header>
    <div class="question-progress"><span style="width:${progress}%"></span></div>
    <div class="checkpoint-message"><span>⌾</span><div><h3>Encontraste una parada de verificación</h3><p>Escribe el código número ${codeIndex + 1} que apareció en el video. Debe coincidir para continuar con la siguiente pregunta.</p></div></div>
    <form class="single-code-form" id="checkpointForm" novalidate><label for="checkpointCode">Código ${codeIndex + 1}</label><div><input id="checkpointCode" name="code" autocomplete="off" spellcheck="false" maxlength="18" placeholder="Escribe el código" required><button class="button button-primary" type="submit">Validar y continuar</button></div><p class="code-feedback" id="codeFeedback" aria-live="polite"></p></form>
  </div>`;
  workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
  select('#checkpointForm').addEventListener('submit', validateCheckpoint);
  setTimeout(() => select('#checkpointCode')?.focus(), 250);
}

async function validateCheckpoint(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const value = normalizeCode(new FormData(form).get('code'));
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Validando...';
  let valid = false;
  try {
    if (!backendReady) throw new Error('firebase_not_configured');
    const result = await api.checkCourseCode(state.course.id, state.checkpoint, value);
    valid = result.valid === true;
  } catch (error) {
    const feedback = select('#codeFeedback');
    feedback.textContent = error.message === 'firebase_not_configured'
      ? 'La plataforma está en modo de instalación. Configura Firebase para activar la validación de códigos.'
      : ['course_not_found', 'course_not_configured'].includes(error.message)
        ? 'Este curso todavía no ha sido configurado en la base de datos por administración.'
        : 'No pudimos validar el código. Revisa tu conexión e inténtalo nuevamente.';
    feedback.className = 'code-feedback error';
    submit.disabled = false;
    submit.textContent = 'Validar y continuar';
    return;
  }
  if (!valid) {
    const feedback = select('#codeFeedback');
    feedback.textContent = `El código ${state.checkpoint + 1} no coincide. Revisa lo que anotaste en el video.`;
    feedback.className = 'code-feedback error';
    form.classList.remove('shake');
    void form.offsetWidth;
    form.classList.add('shake');
    submit.disabled = false;
    submit.textContent = 'Validar y continuar';
    return;
  }
  showToast(`Código ${state.checkpoint + 1} correcto`);
  state.question += 1;
  state.stage = 'quiz';
  renderQuestion();
}

function normalizeCode(value = '') {
  return String(value).trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function renderQuestion() {
  const course = state.course;
  const question = course.questions[state.question];
  const workspace = select('#courseWorkspace');
  if (!question) {
    workspace.innerHTML = '<div class="score-card full-score"><h2>No encontramos esta pregunta</h2><p>Vuelve al catálogo e intenta abrir nuevamente el curso.</p><a class="button button-primary" href="#cursos">Volver a los cursos</a></div>';
    return;
  }
  state.stage = 'quiz';
  const progress = progressForQuestion(state.question);
  workspace.innerHTML = `<div class="quiz-shell">
    <header class="quiz-header"><div><span class="stage-number ink">EVALUACIÓN · ${escapeHTML(course.title)}</span><h2>Pregunta ${state.question + 1} de ${course.questions.length}</h2></div><strong>${progress}%</strong></header>
    <div class="question-progress"><span style="width:${progress}%"></span></div>
    <form class="question-body" id="questionForm"><h3>${escapeHTML(question.prompt)}</h3><div class="answer-list">${question.options.map((option, index) => `<label><input type="radio" name="answer" value="${index}" required><span><b>${String.fromCharCode(65 + index)}</b>${escapeHTML(option)}</span></label>`).join('')}</div><button class="button button-primary" type="submit">${state.question === course.questions.length - 1 ? 'Calcular resultado' : 'Siguiente pregunta'}</button></form>
  </div>`;
  workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
  select('#questionForm').addEventListener('submit', event => {
    event.preventDefault();
    const answer = Number(new FormData(event.currentTarget).get('answer'));
    if (!Number.isInteger(answer)) return;
    state.answers[state.question] = answer;
    if (state.question < 3) {
      renderCodeCheckpoint(state.question);
      return;
    }
    state.question += 1;
    if (state.question < course.questions.length) renderQuestion();
    else renderScore();
  });
}

async function renderScore() {
  state.stage = 'scoring';
  const workspace = select('#courseWorkspace');
  workspace.innerHTML = '<div class="score-card full-score"><div class="admin-loader" aria-label="Calculando"></div><span class="stage-number ink">RESULTADO FINAL</span><h2>Calculando tu resultado…</h2><p>Estamos validando tus respuestas.</p></div>';
  workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    if (!backendReady) throw new Error('firebase_not_configured');
    const result = await api.scoreCourse(state.course.id, state.answers);
    renderScoreResult(result);
  } catch (error) {
    const detail = error.message === 'firebase_not_configured'
      ? 'La interfaz ya está lista, pero falta configurar Firebase para habilitar calificación y certificados.'
      : ['course_not_found', 'course_not_configured'].includes(error.message)
        ? 'Este curso todavía no tiene configuradas sus respuestas privadas en Firebase.'
        : 'Conservamos tus respuestas. Revisa tu conexión y vuelve a intentarlo.';
    workspace.innerHTML = `<div class="score-card full-score"><span class="stage-number ink">RESULTADO FINAL</span><h2>No pudimos calcular el resultado</h2><p>${detail}</p><button class="button button-primary" type="button" data-action="retry-score">Calcular nuevamente</button></div>`;
  }
}

function renderScoreResult(result) {
  state.stage = 'result';
  const { score, correct, total, passed } = result;
  state.attemptToken = passed ? (result.attemptToken || null) : null;
  const workspace = select('#courseWorkspace');
  workspace.innerHTML = `<div class="score-card full-score"><div class="score-ring" style="--score:${score * 3.6}deg">${score}%</div><span class="stage-number ink">RESULTADO FINAL</span><h2>${passed ? '¡Aprobaste la capacitación!' : 'Aún puedes lograrlo'}</h2><p>${passed ? 'Tus respuestas fueron aprobadas. Completa los datos que aparecerán en el certificado.' : `Respondiste correctamente ${correct} de ${total}. Necesitas al menos 80%.`}</p>${passed ? participantForm(score) : '<button class="button button-primary" type="button" data-action="retry-quiz">Intentar nuevamente</button>'}</div>`;
  workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (passed) bindParticipantForm(score);
}

function participantForm(score) {
  return `<form class="participant-form" id="participantForm"><div class="field full"><label for="participantName">Nombre completo</label><input id="participantName" name="name" autocomplete="name" required></div><div class="field"><label for="participantId">Documento</label><input id="participantId" name="document" inputmode="numeric" required></div><div class="field"><label for="participantCompany">Empresa</label><input id="participantCompany" name="company" placeholder="Opcional"></div><button class="button button-primary" type="submit">Generar mi certificado</button><input type="hidden" value="${score}"></form>`;
}

function bindParticipantForm(score) {
  select('#participantForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const data = Object.fromEntries(new FormData(form));
    submit.disabled = true;
    submit.textContent = 'Generando...';
    try {
      if (!backendReady || !state.attemptToken) throw new Error('backend_unavailable');
      const result = await api.issueCertificate({
        attemptToken: state.attemptToken,
        name: data.name.trim(),
        document: data.document.trim(),
        company: data.company.trim()
      });
      renderCertificate(result.certificate);
    } catch {
      showToast('No fue posible guardar el certificado. Revisa la conexión o la configuración de Firebase.');
      submit.disabled = false;
      submit.textContent = 'Generar mi certificado';
    }
  });
}

function renderCertificate(cert) {
  state.stage = 'certificate';
  const workspace = select('#courseWorkspace');
  workspace.innerHTML = `<div class="certificate-wrap"><article class="certificate" aria-label="Certificado de ${escapeAttr(cert.name)}"><span class="cert-logo">CERTIFICA+ · FORMACIÓN EMPRESARIAL</span><h2>Certificado</h2><p>Se certifica que</p><div class="person-name">${escapeHTML(cert.name)}</div><p>identificado(a) con documento ${escapeHTML(cert.document)}, aprobó la capacitación</p><div class="cert-course">${escapeHTML(cert.course)}</div><p>con un resultado de ${cert.score}%.</p><div class="cert-footer"><div>Fecha de expedición<strong>${escapeHTML(cert.date)}</strong></div><div>Código de verificación<strong>${escapeHTML(cert.code)}</strong></div></div></article></div><div class="certificate-actions"><button class="button button-primary" type="button" data-action="print-certificate">Descargar / imprimir PDF</button><button class="button button-outline" type="button" data-action="copy-certificate" data-code="${escapeAttr(cert.code)}">Copiar código</button><a class="button button-outline" href="#cursos">Finalizar curso</a></div>`;
  workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function verifyCertificate(code) {
  const demo = { code: 'CERT-DEMO-2026', name: 'María Pérez', document: '1.234.***', company: 'Empresa demostrativa', course: 'Manejo defensivo', score: 100, date: '20 de septiembre de 2026' };
  if (!backendReady && code === demo.code) return demo;
  if (!backendReady) return null;
  try {
    const result = await api.verifyCertificate(code);
    return result.valid ? result.certificate : null;
  } catch {
    return null;
  }
}

function showToast(message) {
  const toast = select('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(message);
  } catch {
    showToast(`Código: ${text}`);
  }
}

function route() {
  const match = location.hash.match(/^#curso\/([a-z0-9-]+)$/);
  if (match) {
    const course = courses.find(item => item.id === match[1]);
    if (course) {
      if (state.course?.id !== course.id || courseView.hidden) showCourse(course);
      return;
    }
  }
  showHome();
}

function registerWebMCP() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const tools = [
    { name: 'list_courses', title: 'Listar cursos', description: 'Devuelve los cursos disponibles en la plataforma.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: async () => courses.map(({ id, title, category, duration }) => ({ id, title, category, duration })) },
    { name: 'start_course', title: 'Abrir curso', description: 'Abre la página completa de un curso usando su identificador.', inputSchema: { type: 'object', properties: { courseId: { type: 'string' } }, required: ['courseId'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async input => { const course = courses.find(item => item.id === input.courseId); if (!course) throw new Error('Curso no encontrado'); navigateToCourse(course.id); return { opened: true, courseId: course.id, title: course.title }; } },
    { name: 'verify_certificate', title: 'Verificar certificado', description: 'Consulta si un código de certificado existe en esta versión del portal.', inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'], additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: async input => { const record = await verifyCertificate(String(input.code).trim().toUpperCase()); return record ? { valid: true, record } : { valid: false }; } }
  ];
  tools.forEach(tool => { try { Promise.resolve(context.registerTool(tool)).catch(() => {}); } catch {} });
}

async function loadPublicCourses() {
  try {
    if (!backendReady) return;
    const data = await api.getPublicCourses();
    const remote = Array.isArray(data.courses) ? data.courses.map(normalizeCourse) : [];
    courses = remote.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || a.title.localeCompare(b.title, 'es'));
    renderFilters();
    renderCourses();
    const match = location.hash.match(/^#curso\/([a-z0-9-]+)$/);
    if (match) {
      const current = courses.find(course => course.id === match[1]);
      if (current && (!state.course || state.stage === 'intro' || state.stage === 'home')) showCourse(current);
    }
  } catch {
    if (backendReady) {
      courses = [];
      renderFilters();
      renderCourses();
    }
  }
}

function bootstrap() {
  if (backendReady) select('.demo-code')?.remove();
  renderFilters();
  renderCourses();
  registerWebMCP();
  route();
  loadPublicCourses();
}

bootstrap();

window.addEventListener('hashchange', route);
window.addEventListener('popstate', route);
select('#filterRow').addEventListener('click', event => {
  const button = event.target.closest('[data-category]');
  if (!button) return;
  state.category = button.dataset.category;
  renderFilters();
  renderCourses();
});
select('#courseSearch').addEventListener('input', event => {
  state.query = event.target.value;
  renderCourses();
});
courseGrid.addEventListener('click', event => {
  const button = event.target.closest('[data-course]');
  if (!button) return;
  event.preventDefault();
  navigateToCourse(button.dataset.course);
});

select('#verifyForm').addEventListener('submit', async event => {
  event.preventDefault();
  const code = select('#certificateCode').value.trim().toUpperCase();
  const target = select('#verifyResult');
  target.innerHTML = '<p>Consultando certificado…</p>';
  const result = await verifyCertificate(code);
  target.innerHTML = result ? `<div class="result-valid"><span>✓</span><div><strong>Certificado válido</strong><small>${escapeHTML(result.name)} · ${escapeHTML(result.course)}<br>${escapeHTML(result.date)} · Resultado ${result.score}%</small></div></div>` : '<p class="result-invalid">No encontramos un certificado con ese código. Revisa que esté escrito correctamente o confirma que Firebase ya esté configurado.</p>';
});

select('#copyDemoCode').addEventListener('click', () => {
  select('#certificateCode').value = 'CERT-DEMO-2026';
  copyText('CERT-DEMO-2026', 'Código de prueba copiado');
});
select('#menuToggle').addEventListener('click', event => {
  const nav = select('#mainNav');
  const open = nav.classList.toggle('open');
  event.currentTarget.setAttribute('aria-expanded', String(open));
});
select('#mainNav').addEventListener('click', () => {
  select('#mainNav').classList.remove('open');
  select('#menuToggle').setAttribute('aria-expanded', 'false');
});

const assistant = select('#assistantPanel');
select('#assistantButton').addEventListener('click', event => {
  assistant.hidden = !assistant.hidden;
  event.currentTarget.setAttribute('aria-expanded', String(!assistant.hidden));
});
select('#closeAssistant').addEventListener('click', () => {
  assistant.hidden = true;
  select('#assistantButton').setAttribute('aria-expanded', 'false');
});
select('#assistantBody').addEventListener('click', event => {
  const button = event.target.closest('[data-answer]');
  if (!button) return;
  select('.bot-message', select('#assistantBody')).textContent = button.dataset.answer;
});

// Instalación PWA y funcionamiento offline básico.
let deferredInstallPrompt = null;
const installButton = select('#installAppButton');
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (installButton) installButton.hidden = false;
});
installButton?.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice.catch(() => null);
  deferredInstallPrompt = null;
  installButton.hidden = true;
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  if (installButton) installButton.hidden = true;
  showToast('Certifica+ se instaló correctamente');
});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}
