import { api, backendReady } from "./api.js";
import { firebaseConfigured, signIn, signOut, watchAuth } from "./firebase-client.js";
import { prevenirConfig } from "./firebase-config.js";

const publicSiteUrl = String(prevenirConfig.publicSiteUrl || "https://alfredosst.web.app").replace(/\/$/, "");
const publicHref = path => `${publicSiteUrl}/${String(path || "").replace(/^\//, "")}`;

const palettes = [
  { name: 'Dorado', theme: '#ffb43b', soft: '#fff0d3' },
  { name: 'Verde', theme: '#15a58d', soft: '#dff7f1' },
  { name: 'Coral', theme: '#ef6557', soft: '#ffe5e1' },
  { name: 'Violeta', theme: '#8065d8', soft: '#eee9ff' },
  { name: 'Azul', theme: '#2778d5', soft: '#e1efff' },
  { name: 'Rosa', theme: '#e46a9b', soft: '#ffe4ef' }
];

const state = {
  courses: [],
  courseId: null,
  mode: 'edit',
  draft: null
};

const select = (selector, scope = document) => scope.querySelector(selector);
const selectAll = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const adminView = select('#adminView');

function escapeHTML(value = '') {
  const element = document.createElement('div');
  element.textContent = String(value);
  return element.innerHTML;
}

function escapeAttr(value = '') {
  return escapeHTML(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function hydrateResourceImages(scope = document) {
  const images = [...scope.querySelectorAll('[data-resource-image]')];
  await Promise.all(images.map(async image => {
    try {
      image.src = await api.resourceObjectUrl(image.dataset.resourceImage);
      image.hidden = false;
    } catch {
      image.remove();
    }
  }));
}

function normalizeCode(value = '') {
  return String(value).trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function blankQuestion(index) {
  return {
    prompt: `Pregunta ${index + 1}`,
    options: ['Opción A', 'Opción B', 'Opción C'],
    correct: 0
  };
}

function blankCourse() {
  const palette = palettes[state.courses.length % palettes.length];
  return {
    title: '',
    category: '',
    duration: '30 min',
    description: '',
    icon: '✦',
    theme: palette.theme,
    themeSoft: palette.soft,
    videoUrl: '',
    codes: ['', '', ''],
    learn: ['', '', ''],
    questions: [0, 1, 2, 3].map(blankQuestion)
  };
}

function showToast(message) {
  const toast = select('#adminToast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function renderSetupRequired() {
  adminView.innerHTML = `<section class="admin-login"><div class="admin-login-copy"><a class="back-link" href="${publicHref()}">← Volver a la plataforma</a><span class="admin-kicker">CENTRO DE CONTROL</span><h1>Falta conectar Firebase.</h1><p>La interfaz administrativa ya está instalada. Solo debes activar Authentication, crear Firestore y desplegar las reglas de seguridad.</p></div><div class="admin-login-card"><span class="admin-lock">⚙</span><h2>Configuración pendiente</h2><p>Edita <code>public/js/firebase-config.js</code>, activa Authentication y despliega las reglas de Firestore siguiendo el README. Esta versión no usa Cloud Functions.</p><a class="button button-outline" href="${publicHref()}">Ver plataforma pública</a></div></section>`;
}

function renderAccess(status = {}) {
  const body = status.canClaim
    ? `<span class="admin-lock">✓</span><h2>Activar administrador único</h2><p>Esta cuenta quedará registrada en Firestore como el administrador único de Prevenir PSST. Asegúrate de mantener solamente esta cuenta en Firebase Authentication.</p><button class="button button-primary" type="button" id="claimAdminButton">Activar administración</button><button class="button button-outline" type="button" data-admin-action="signout">Cerrar sesión</button><p class="admin-form-message" id="adminClaimMessage" aria-live="polite"></p>`
    : `<span class="admin-lock">!</span><h2>Acceso no autorizado</h2><p>La cuenta <strong>${escapeHTML(status.email || '')}</strong> no coincide con el administrador único. </p><button class="button button-outline" type="button" data-admin-action="signout">Cerrar sesión</button>`;
  adminView.innerHTML = `<section class="admin-login"><div class="admin-login-copy"><a class="back-link" href="${publicHref()}">← Volver a la plataforma</a><span class="admin-kicker">CENTRO DE CONTROL</span><h1>Configura cada capacitación.</h1><p>Este espacio está separado del portal público. Solo la única cuenta registrada en Firebase Authentication puede administrar la plataforma.</p></div><div class="admin-login-card">${body}</div></section>`;
  select('#claimAdminButton')?.addEventListener('click', claimAccess);
}

function renderLogin() {
  adminView.innerHTML = `<section class="admin-login"><div class="admin-login-copy"><a class="back-link" href="${publicHref()}">← Volver a la plataforma</a><span class="admin-kicker">CENTRO DE CONTROL</span><h1>Administración privada.</h1><p>Inicia sesión con la cuenta creada en Firebase Authentication. Conocer esta URL no concede acceso.</p></div><div class="admin-login-card"><span class="admin-lock">⌾</span><h2>Iniciar sesión</h2><form id="adminLoginForm" class="admin-auth-form"><label>Correo<input type="email" name="email" autocomplete="username" required></label><label>Contraseña<input type="password" name="password" autocomplete="current-password" minlength="6" required></label><button class="button button-primary" type="submit">Entrar</button><p class="admin-form-message" id="adminLoginMessage" aria-live="polite"></p></form></div></section>`;
  select('#adminLoginForm').addEventListener('submit', handleLogin);
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = select('#adminLoginMessage');
  const submit = form.querySelector('button[type="submit"]');
  const data = new FormData(form);
  submit.disabled = true;
  submit.textContent = 'Ingresando...';
  message.textContent = '';
  try {
    await signIn(String(data.get('email') || '').trim(), String(data.get('password') || ''));
  } catch (error) {
    message.textContent = error.code === 'auth/invalid-credential' ? 'Correo o contraseña incorrectos.' : 'No fue posible iniciar sesión. Revisa Firebase Authentication.';
    submit.disabled = false;
    submit.textContent = 'Entrar';
  }
}

function renderUnavailable() {
  adminView.innerHTML = `<section class="admin-login"><div class="admin-login-copy"><a class="back-link" href="${publicHref()}">← Volver a la plataforma</a><span class="admin-kicker">CENTRO DE CONTROL</span><h1>No pudimos abrir el panel.</h1></div><div class="admin-login-card"><span class="admin-lock">!</span><h2>Servicio no disponible</h2><p>Revisa tu conexión e inténtalo nuevamente.</p><button class="button button-primary" type="button" data-admin-action="retry">Reintentar</button></div></section>`;
}

async function claimAccess() {
  const button = select('#claimAdminButton');
  button.disabled = true;
  button.textContent = 'Activando...';
  try {
    const result = await api.bootstrapAdmin();
    if (!result.isAdmin) throw new Error('claim_failed');
    await loadCourses();
    renderDashboard();
    showToast('Administrador único activado');
  } catch {
    select('#adminClaimMessage').textContent = 'No fue posible activar la administración. Revisa Authentication y las reglas de Firestore.';
    button.disabled = false;
    button.textContent = 'Activar administración';
  }
}

async function loadCourses() {
  const data = await api.listAdminCourses();
  const remote = Array.isArray(data.courses) ? data.courses : [];
  state.courses = remote.map(course => ({ ...course, setupDraft: !course.configured })).sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || a.title.localeCompare(b.title, 'es'));
  if (!state.courseId || !state.courses.some(course => course.courseId === state.courseId)) state.courseId = state.courses[0]?.courseId || null;
}

function selectedCourse() {
  if (state.mode === 'new') return state.draft || blankCourse();
  return state.courses.find(course => course.courseId === state.courseId) || state.courses[0] || blankCourse();
}

function renderCourseList() {
  return state.courses.map(course => `<button type="button" class="${state.mode === 'edit' && course.courseId === state.courseId ? 'active' : ''}" data-admin-course="${escapeAttr(course.courseId)}" style="--admin-accent:${escapeAttr(course.theme)}" aria-current="${state.mode === 'edit' && course.courseId === state.courseId ? 'page' : 'false'}"><span>${escapeHTML(course.number)}</span><div><strong>${escapeHTML(course.title)}</strong><small>${course.isCustom ? 'Curso creado' : (course.configured ? 'Personalizado' : escapeHTML(course.category))}</small></div></button>`).join('');
}

function renderQuestionCards(questions) {
  return questions.map((question, index) => `<article class="admin-question-card" data-question-index="${index}">
    <header><div><span>${String(index + 1).padStart(2, '0')}</span><h3>Pregunta ${index + 1}</h3></div>${questions.length > 4 ? `<button type="button" class="question-remove" data-admin-action="remove-question" data-question-index="${index}" aria-label="Eliminar pregunta ${index + 1}">Eliminar</button>` : ''}</header>
    <label>Enunciado<input class="question-prompt" value="${escapeAttr(question.prompt)}" maxlength="240" required></label>
    <div class="question-options">
      ${question.options.map((option, optionIndex) => `<label><span>${String.fromCharCode(65 + optionIndex)}</span><input class="question-option" value="${escapeAttr(option)}" maxlength="180" required></label>`).join('')}
    </div>
    <label class="correct-answer-label">Respuesta correcta<select class="question-correct">${Number(question.correct) < 0 ? '<option value="-1" selected disabled>Selecciona la correcta</option>' : ''}${[0, 1, 2].map(optionIndex => `<option value="${optionIndex}" ${Number(question.correct) === optionIndex ? 'selected' : ''}>Opción ${String.fromCharCode(65 + optionIndex)}</option>`).join('')}</select></label>
  </article>`).join('');
}

function renderDashboard() {
  const course = selectedCourse();
  const isNew = state.mode === 'new';
  const palette = palettes.find(item => item.theme === course.theme) || palettes[0];
  const codes = Array.isArray(course.codes) && course.codes.length === 3 ? course.codes : ['', '', ''];
  const learn = Array.isArray(course.learn) && course.learn.length === 3 ? course.learn : ['', '', ''];
  const questions = Array.isArray(course.questions) && course.questions.length >= 4 ? course.questions : [0, 1, 2, 3].map(blankQuestion);
  const resources = Array.isArray(course.resources) ? course.resources : [];
  const cover = resources.find(item => item.id === course.coverResourceId) || resources.find(item => item.kind === 'cover') || null;
  state.draft = isNew ? { ...course, codes, learn, questions } : null;

  adminView.innerHTML = `<section class="admin-shell">
    <aside class="admin-sidebar">
      <div><span class="admin-kicker">PREVENIR PSST · ADMIN</span><h2>Capacitaciones</h2><p>Edita el contenido completo o crea una nueva capacitación.</p></div>
      <button type="button" class="admin-create-course ${isNew ? 'active' : ''}" data-admin-action="new-course"><span>＋</span> Crear nuevo curso</button>
      <nav class="admin-course-list" aria-label="Cursos configurables">${renderCourseList()}</nav>
      <div class="admin-side-actions"><a href="${publicHref()}">Ver plataforma pública</a><button type="button" data-admin-action="signout">Cerrar sesión</button></div>
    </aside>
    <div class="admin-workspace">
      <header class="admin-header"><div><span class="admin-kicker">${isNew ? 'NUEVA CAPACITACIÓN' : 'EDITAR CAPACITACIÓN'}</span><h1>${isNew ? 'Crear un curso' : escapeHTML(course.title)}</h1></div>${isNew ? '<button class="button button-outline" type="button" data-admin-action="cancel-new">Cancelar</button>' : `<a class="button button-outline" href="${publicHref(`#curso/${encodeURIComponent(course.courseId)}`)}" target="_blank" rel="noopener noreferrer">Vista del estudiante ↗</a>`}</header>
      <div class="admin-summary"><article><span>${isNew ? '＋' : escapeHTML(course.number)}</span><div><strong>${isNew ? 'Nuevo' : 'Curso activo'}</strong><small>${isNew ? 'Se publicará al guardar' : 'Visible en el catálogo'}</small></div></article><article><span>03</span><div><strong>Códigos</strong><small>Solicitados entre preguntas</small></div></article><article><span>${String(questions.length).padStart(2, '0')}</span><div><strong>Preguntas</strong><small>Evaluación editable</small></div></article></div>${course.setupDraft ? '<div class="admin-setup-warning"><strong>Curso base pendiente de configurar:</strong> completa los tres códigos y selecciona manualmente la respuesta correcta de cada pregunta antes de guardarlo en Firebase.</div>' : ''}
      <form class="admin-editor admin-course-editor" id="courseConfigForm" novalidate>
        <section>
          <div class="editor-section-head"><span>01</span><div><h2>Información del curso</h2><p>Estos datos aparecen en la tarjeta y en la portada de la capacitación.</p></div></div>
          <div class="admin-field-grid">
            <label class="wide">Nombre del curso<input name="title" value="${escapeAttr(course.title)}" maxlength="100" required></label>
            <label>Categoría<input name="category" value="${escapeAttr(course.category)}" maxlength="60" placeholder="Ej. Seguridad y salud" required></label>
            <label>Duración<input name="duration" value="${escapeAttr(course.duration)}" maxlength="30" placeholder="Ej. 30 min" required></label>
            <label>Símbolo<input name="icon" value="${escapeAttr(course.icon || '✦')}" maxlength="4" required></label>
            <label>Color<select name="theme">${palettes.map(item => `<option value="${item.theme}" ${item.theme === palette.theme ? 'selected' : ''}>${item.name}</option>`).join('')}</select></label>
            <label class="wide">Descripción<textarea name="description" maxlength="360" rows="3" required>${escapeHTML(course.description)}</textarea></label>
          </div>
        </section>
        <section>
          <div class="editor-section-head"><span>02</span><div><h2>Imagen y recursos en Firestore</h2><p>Las imágenes, PDF y documentos se guardan dentro de Firestore; no se utiliza Firebase Storage.</p></div></div>
          ${isNew ? `<div class="admin-setup-warning"><strong>Primero guarda el curso.</strong> Después podrás cargar su imagen de portada y sus recursos.</div>` : `
          <div class="resource-upload-panel">
            <div class="resource-cover-preview">${cover ? `<img data-resource-image="${escapeAttr(cover.id)}" alt="Portada de ${escapeAttr(course.title)}" hidden>` : `<span>${escapeHTML(course.icon || '✦')}</span><small>Sin imagen de portada</small>`}</div>
            <div class="resource-upload-controls">
              <label>Archivo<input id="adminResourceFile" type="file" accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx"></label>
              <label>Uso<select id="adminResourceKind"><option value="resource">Recurso descargable</option><option value="cover">Imagen de portada</option></select></label>
              <button class="button button-primary" type="button" data-admin-action="upload-resource">Guardar archivo en Firestore</button>
              <small>Máximo 8 MB por archivo. Firestore lo divide internamente en fragmentos seguros.</small>
            </div>
          </div>
          <div class="resource-list">${resources.length ? resources.map(item => `<article><div><strong>${escapeHTML(item.name)}</strong><small>${item.kind === 'cover' ? 'Imagen de portada' : escapeHTML(item.mimeType || 'Recurso')} · ${Math.max(1, Math.round(Number(item.size || 0) / 1024))} KB</small></div><div><button class="button button-outline" type="button" data-admin-action="open-resource" data-resource-id="${escapeAttr(item.id)}">Abrir</button><button class="button button-outline danger" type="button" data-admin-action="delete-resource" data-resource-id="${escapeAttr(item.id)}">Eliminar</button></div></article>`).join('') : '<p class="resource-empty">Aún no has cargado recursos para este curso.</p>'}</div>`}
        </section>
        <section>
          <div class="editor-section-head"><span>03</span><div><h2>Video y controles de atención</h2><p>Configura el enlace de YouTube y los tres códigos que aparecerán durante el video.</p></div></div>
          <label for="adminVideoUrl">Enlace de YouTube</label><div class="url-field"><input id="adminVideoUrl" name="videoUrl" type="url" value="${escapeAttr(course.videoUrl)}" placeholder="https://www.youtube.com/watch?v=..." required><a href="${escapeAttr(course.videoUrl || 'https://www.youtube.com/')}" target="_blank" rel="noopener noreferrer" aria-label="Abrir enlace actual">↗</a></div>
          <div class="admin-code-grid">${codes.map((code, index) => `<label><span>Código ${index + 1}<small>Después de la pregunta ${index + 1}</small></span><input name="code${index}" value="${escapeAttr(code)}" maxlength="18" autocomplete="off" spellcheck="false" required></label>`).join('')}</div>
        </section>
        <section>
          <div class="editor-section-head"><span>04</span><div><h2>Objetivos de aprendizaje</h2><p>Escribe tres resultados claros que la persona obtendrá al completar el curso.</p></div></div>
          <div class="learning-editor">${learn.map((item, index) => `<label><span>0${index + 1}</span><input name="learn${index}" value="${escapeAttr(item)}" maxlength="180" required></label>`).join('')}</div>
        </section>
        <section>
          <div class="editor-section-head question-section-title"><span>05</span><div><h2>Preguntas de evaluación</h2><p>Puedes cambiar preguntas y respuestas o añadir nuevas. La evaluación debe conservar mínimo cuatro preguntas.</p></div><button class="button button-outline" type="button" data-admin-action="add-question">＋ Agregar pregunta</button></div>
          <div class="admin-question-list">${renderQuestionCards(questions)}</div>
        </section>
        <div class="admin-save-bar"><p id="adminSaveMessage" aria-live="polite">${isNew ? 'Completa todos los campos para publicar el nuevo curso.' : 'Los cambios se guardarán en la Firestore compartida y se verán en ambas páginas.'}</p><button class="button button-primary" type="submit">${isNew ? 'Crear y publicar curso' : 'Guardar todos los cambios'}</button></div>
      </form>
      <div class="admin-storage-note"><span>✓</span><p><strong>Administración centralizada:</strong> información, imágenes, recursos, códigos, objetivos y preguntas se guardan en Firestore. Los cambios se reflejan automáticamente en el catálogo público.</p></div>
    </div>
  </section>`;

  select('#courseConfigForm').addEventListener('submit', saveCourse);
  hydrateResourceImages(adminView);
}

function readFormDraft() {
  const form = select('#courseConfigForm');
  if (!form) return selectedCourse();
  const data = new FormData(form);
  const palette = palettes.find(item => item.theme === data.get('theme')) || palettes[0];
  return {
    ...selectedCourse(),
    title: String(data.get('title') || '').trim(),
    category: String(data.get('category') || '').trim(),
    duration: String(data.get('duration') || '').trim(),
    icon: String(data.get('icon') || '').trim(),
    theme: palette.theme,
    themeSoft: palette.soft,
    description: String(data.get('description') || '').trim(),
    videoUrl: String(data.get('videoUrl') || '').trim(),
    codes: [0, 1, 2].map(index => normalizeCode(data.get(`code${index}`))),
    learn: [0, 1, 2].map(index => String(data.get(`learn${index}`) || '').trim()),
    questions: selectAll('.admin-question-card', form).map(card => ({
      prompt: select('.question-prompt', card).value.trim(),
      options: selectAll('.question-option', card).map(input => input.value.trim()),
      correct: Number(select('.question-correct', card).value)
    }))
  };
}

function validationMessage(course) {
  if (course.title.length < 3 || course.category.length < 2 || !course.duration || course.description.length < 10) return 'Completa el nombre, la categoría, la duración y una descripción clara.';
  if (!/^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(course.videoUrl)) return 'Ingresa un enlace válido de YouTube.';
  if (course.codes.some(code => !code) || new Set(course.codes).size !== 3) return 'Los tres códigos son obligatorios y deben ser diferentes.';
  if (course.learn.some(item => !item)) return 'Completa los tres objetivos de aprendizaje.';
  if (course.questions.length < 4) return 'La evaluación debe tener al menos cuatro preguntas.';
  if (course.questions.some(question => !question.prompt || question.options.length !== 3 || question.options.some(option => !option))) return 'Completa el enunciado y las tres opciones de cada pregunta.';
  if (course.questions.some(question => !Number.isInteger(question.correct) || question.correct < 0 || question.correct > 2)) return 'Selecciona la respuesta correcta de todas las preguntas.';
  return '';
}

async function saveCourse(event) {
  event.preventDefault();
  const course = readFormDraft();
  const message = select('#adminSaveMessage');
  const validation = validationMessage(course);
  if (validation) {
    message.textContent = validation;
    message.className = 'error';
    return;
  }

  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = state.mode === 'new' ? 'Creando...' : 'Guardando...';
  try {
    const isNew = state.mode === 'new';
    const payload = { ...course, courseId: isNew ? undefined : state.courseId };
    const result = await api.saveAdminCourse(payload);
    if (!result.saved) throw new Error(result.error || 'save_failed');
    state.courseId = result.course.courseId;
    state.mode = 'edit';
    state.draft = null;
    await loadCourses();
    renderDashboard();
    showToast(isNew ? 'Curso creado y publicado' : `Cambios guardados en ${result.course.title}`);
  } catch (error) {
    const messages = {
      invalid_course_details: 'Revisa la información general del curso.',
      invalid_youtube_url: 'Ingresa un enlace válido de YouTube.',
      invalid_codes: 'Los tres códigos deben ser diferentes y tener máximo 18 caracteres.',
      invalid_learning_goals: 'Completa los tres objetivos de aprendizaje.',
      invalid_question_count: 'Incluye entre 4 y 20 preguntas.',
      invalid_questions: 'Revisa los enunciados, opciones y respuestas correctas.'
    };
    message.textContent = messages[error.message] || 'No pudimos guardar los cambios. Revisa tu conexión e inténtalo nuevamente.';
    message.className = 'error';
    submit.disabled = false;
    submit.textContent = state.mode === 'new' ? 'Crear y publicar curso' : 'Guardar todos los cambios';
  }
}


function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const block = 0x8000;
  for (let i = 0; i < bytes.length; i += block) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + block, bytes.length)));
  return btoa(binary);
}

async function uploadSelectedResource() {
  const course = selectedCourse();
  const input = select('#adminResourceFile');
  const kindInput = select('#adminResourceKind');
  const file = input?.files?.[0];
  if (!course?.courseId || state.mode === 'new') return showToast('Guarda primero el curso');
  if (!file) return showToast('Selecciona un archivo');
  if (file.size > 8 * 1024 * 1024) return showToast('El archivo supera el máximo de 8 MB');
  const button = select('[data-admin-action="upload-resource"]');
  button.disabled = true;
  button.textContent = 'Guardando en Firestore...';
  try {
    const dataBase64 = arrayBufferToBase64(await file.arrayBuffer());
    await api.uploadResource({ courseId: course.courseId, name: file.name, mimeType: file.type || 'application/octet-stream', kind: kindInput?.value === 'cover' ? 'cover' : 'resource', dataBase64 });
    await loadCourses();
    renderDashboard();
    showToast('Recurso guardado en Firestore');
  } catch (error) {
    const messages = { invalid_resource: 'Tipo de archivo no permitido.', resource_too_large: 'El archivo supera el máximo de 8 MB.', resource_limit_reached: 'Este curso alcanzó el máximo de 20 recursos.' };
    showToast(messages[error.message] || 'No fue posible guardar el recurso');
    button.disabled = false;
    button.textContent = 'Guardar archivo en Firestore';
  }
}

async function deleteSelectedResource(resourceId) {
  if (!resourceId) return;
  try {
    await api.deleteResource(resourceId);
    await loadCourses();
    renderDashboard();
    showToast('Recurso eliminado de Firestore');
  } catch {
    showToast('No fue posible eliminar el recurso');
  }
}

function handleAdminClick(event) {
  const courseButton = event.target.closest('[data-admin-course]');
  if (courseButton) {
    state.courseId = courseButton.dataset.adminCourse;
    state.mode = 'edit';
    state.draft = null;
    renderDashboard();
    return;
  }

  const actionButton = event.target.closest('[data-admin-action]');
  if (!actionButton) return;
  const action = actionButton.dataset.adminAction;
  if (action === 'open-resource') {
    api.openResource(actionButton.dataset.resourceId).catch(() => showToast('No fue posible abrir el recurso'));
  } else if (action === 'upload-resource') {
    uploadSelectedResource();
  } else if (action === 'delete-resource') {
    deleteSelectedResource(actionButton.dataset.resourceId);
  } else if (action === 'new-course') {
    state.mode = 'new';
    state.draft = blankCourse();
    renderDashboard();
  } else if (action === 'cancel-new') {
    state.mode = 'edit';
    state.draft = null;
    renderDashboard();
  } else if (action === 'add-question') {
    const draft = readFormDraft();
    if (draft.questions.length >= 20) {
      showToast('Puedes incluir máximo 20 preguntas');
      return;
    }
    draft.questions.push(blankQuestion(draft.questions.length));
    state.draft = draft;
    if (state.mode === 'edit') {
      const index = state.courses.findIndex(course => course.courseId === state.courseId);
      state.courses[index] = draft;
    }
    renderDashboard();
    requestAnimationFrame(() => selectAll('.admin-question-card').at(-1)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  } else if (action === 'remove-question') {
    const draft = readFormDraft();
    if (draft.questions.length <= 4) {
      showToast('La evaluación debe conservar mínimo cuatro preguntas');
      return;
    }
    draft.questions.splice(Number(actionButton.dataset.questionIndex), 1);
    state.draft = draft;
    if (state.mode === 'edit') {
      const index = state.courses.findIndex(course => course.courseId === state.courseId);
      state.courses[index] = draft;
    }
    renderDashboard();
  } else if (action === 'retry') {
    start();
  } else if (action === 'signout') {
    signOut().catch(() => {});
  }
}

async function handleAuthenticatedUser(user) {
  if (!user) {
    renderLogin();
    return;
  }
  try {
    const status = await api.getAdminSession();
    if (status.isAdmin) {
      await loadCourses();
      renderDashboard();
      return;
    }
    renderAccess(status);
  } catch (error) {
    if (error.message === 'authentication_required' || error.status === 401) renderLogin();
    else renderUnavailable();
  }
}

function start() {
  if (!firebaseConfigured || !backendReady) {
    renderSetupRequired();
    return;
  }
  watchAuth(user => { handleAuthenticatedUser(user); });
}

adminView.addEventListener('click', handleAdminClick);
start();
