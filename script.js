const KIND_LABELS = {
  csv: 'CSV',
  image: 'Imagen',
  pdf: 'PDF',
  text: 'Texto',
  binary: 'Binario',
};

const KIND_ICONS = {
  csv: 'i-csv',
  image: 'i-image',
  pdf: 'i-pdf',
  text: 'i-file-text',
  binary: 'i-files',
};

const state = {
  server: false,
  connected: false,
  reason: '',
  bucket: '',
  maxUploadMB: 20,
  files: [],
  filter: 'all',
  searchFiles: '',
  searchRows: '',
  activeFile: null,
  dataset: null,
  uploading: false,
  confirmHandler: null,
  dateFormatter: new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }),
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

/* ----------------------------- utilidades ------------------------------- */

function escapeHTML(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function icon(id, className = 'icon') {
  return `<svg class="${className}"><use href="#${id}"></use></svg>`;
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const unidades = ['KB', 'MB', 'GB', 'TB'];
  let valor = n / 1024;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i++;
  }
  return `${valor.toFixed(valor >= 10 ? 0 : 1)} ${unidades[i]}`;
}

function formatFecha(fecha) {
  const valor = new Date(fecha);
  return Number.isNaN(valor.getTime()) ? '—' : state.dateFormatter.format(valor);
}

function kindLabel(kind) {
  return KIND_LABELS[kind] || KIND_LABELS.binary;
}

function kindIcon(kind) {
  return KIND_ICONS[kind] || KIND_ICONS.binary;
}

function matchesFilter(file, filter) {
  if (filter === 'all') return true;
  if (filter === 'csv') return file.kind === 'csv';
  if (filter === 'image') return file.kind === 'image';
  if (filter === 'document') return file.kind === 'pdf' || file.kind === 'text';
  return file.kind === 'binary';
}

function spinnerRows(colspan, texto) {
  return `<tr><td colspan="${colspan}" class="table-empty">${icon('i-refresh', 'icon spin')}${escapeHTML(texto)}</td></tr>`;
}

function emptyRows(colspan, icono, texto) {
  return `<tr><td colspan="${colspan}" class="table-empty">${icon(icono)}${escapeHTML(texto)}</td></tr>`;
}

/* -------------------------------- API ----------------------------------- */

async function api(ruta, opciones = {}) {
  const config = { ...opciones };
  if (config.body && !(config.body instanceof FormData)) {
    config.headers = { 'Content-Type': 'application/json', ...(config.headers || {}) };
  }
  const respuesta = await fetch(ruta, config);
  let datos = null;
  try {
    datos = await respuesta.json();
  } catch {
    datos = null;
  }
  if (!respuesta.ok) {
    const mensaje = datos && datos.error ? datos.error : `Error ${respuesta.status}`;
    const detalle = datos && datos.detail ? ` · ${datos.detail}` : '';
    throw new Error(mensaje + detalle);
  }
  return datos;
}

async function obtenerEstado() {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 6000);
  try {
    const respuesta = await fetch('/api/status', {
      signal: controlador.signal,
      cache: 'no-store',
    });
    if (!respuesta.ok) throw new Error('Estado no disponible');
    return await respuesta.json();
  } finally {
    clearTimeout(temporizador);
  }
}

async function detectarConexion() {
  try {
    const estado = await obtenerEstado();
    state.server = true;
    state.connected = Boolean(estado.connected);
    state.reason = estado.reason || '';
    state.bucket = estado.bucket || '';
    state.maxUploadMB = estado.maxUploadMB || 20;
  } catch {
    state.server = false;
    state.connected = false;
    state.reason = '';
  }
  $('#dropzone-limit').textContent = `Máximo ${state.maxUploadMB} MB`;
  updateConnection();
}

/* ----------------------------- renderizado ------------------------------ */

function updateConnection() {
  const dot = $('#mode-dot');
  const title = $('#mode-title');
  const detail = $('#mode-detail');
  const bucketName = $('#bucket-name');

  dot.className = 'dot';

  if (!state.server) {
    dot.classList.add('is-offline');
    title.textContent = 'Sin servidor';
    detail.textContent = 'Ejecuta npm start';
    bucketName.textContent = '—';
  } else if (!state.connected) {
    dot.classList.add('is-offline');
    title.textContent = 'Sin conexión';
    detail.textContent = state.reason || 'Google Cloud no responde';
    bucketName.textContent = state.bucket || '—';
  } else {
    dot.classList.add('is-cloud');
    title.textContent = 'Cloud Storage';
    detail.textContent = `bucket ${state.bucket}`;
    bucketName.textContent = state.bucket || '—';
  }

  const desconectado = !state.connected;
  $('#btn-primary').disabled = desconectado;
  $('#dropzone').classList.toggle('is-disabled', desconectado);
  $('#dropzone').setAttribute('aria-disabled', String(desconectado));
  $('#btn-file-download').disabled = desconectado || !state.activeFile;
  $('#btn-file-delete').disabled = desconectado || !state.activeFile;
  $('#btn-binary-download').disabled = desconectado || !state.activeFile;
  $('#btn-add-row').disabled = desconectado || !state.dataset || !state.dataset.editable;
}

function updateStats() {
  const archivos = state.files;
  const totalSize = archivos.reduce((suma, archivo) => suma + Number(archivo.size || 0), 0);
  const csv = archivos.filter((archivo) => archivo.kind === 'csv').length;
  const counts = {
    all: archivos.length,
    csv,
    image: archivos.filter((archivo) => archivo.kind === 'image').length,
    document: archivos.filter((archivo) => archivo.kind === 'pdf' || archivo.kind === 'text').length,
    other: archivos.filter((archivo) => archivo.kind === 'binary').length,
  };

  $('#stat-objetos').textContent = state.connected ? String(archivos.length) : '—';
  $('#stat-tamano').textContent = state.connected ? formatBytes(totalSize) : '—';
  $('#stat-csv').textContent = state.connected ? String(csv) : '—';
  $('#count-objetos').textContent = String(archivos.length);
  $('#count-all').textContent = String(counts.all);
  $('#count-csv').textContent = String(counts.csv);
  $('#count-image').textContent = String(counts.image);
  $('#count-document').textContent = String(counts.document);
  $('#count-other').textContent = String(counts.other);
}

function renderFiles() {
  const tbody = $('#tabla-objetos');
  const consulta = state.searchFiles.trim().toLowerCase();
  const archivos = state.files.filter((archivo) => {
    if (!matchesFilter(archivo, state.filter)) return false;
    return !consulta || archivo.name.toLowerCase().includes(consulta);
  });

  if (!state.connected) {
    tbody.innerHTML = emptyRows(5, 'i-warn', 'Sin conexión con Google Cloud Storage.');
    updateStats();
    return;
  }

  if (!archivos.length) {
    tbody.innerHTML = state.files.length
      ? emptyRows(5, 'i-search', 'Sin resultados para este filtro.')
      : emptyRows(5, 'i-files', 'El bucket está vacío. Sube tu primer archivo.');
    updateStats();
    return;
  }

  tbody.innerHTML = archivos
    .map(
      (archivo) => `
      <tr class="is-clickable" data-name="${escapeHTML(archivo.name)}">
        <td>
          <div class="cell-file">
            ${icon(kindIcon(archivo.kind))}
            <code title="${escapeHTML(archivo.name)}">${escapeHTML(archivo.name)}</code>
          </div>
        </td>
        <td><span class="type-pill type-${escapeHTML(archivo.kind)}">${escapeHTML(kindLabel(archivo.kind))}</span></td>
        <td class="cell-size">${formatBytes(archivo.size)}</td>
        <td class="cell-date">${formatFecha(archivo.updated)}</td>
        <td>
          <div class="row-actions">
            <button class="btn-icon" type="button" data-action="open" data-name="${escapeHTML(archivo.name)}" title="Abrir" aria-label="Abrir ${escapeHTML(archivo.name)}">
              ${icon('i-eye')}
            </button>
            <button class="btn-icon" type="button" data-action="download" data-name="${escapeHTML(archivo.name)}" title="Descargar" aria-label="Descargar ${escapeHTML(archivo.name)}">
              ${icon('i-download')}
            </button>
            <button class="btn-icon" type="button" data-action="delete" data-name="${escapeHTML(archivo.name)}" title="Eliminar" aria-label="Eliminar ${escapeHTML(archivo.name)}">
              ${icon('i-trash')}
            </button>
          </div>
        </td>
      </tr>`
    )
    .join('');

  updateStats();
}

/* ------------------------------- cargas --------------------------------- */

async function loadFiles() {
  if (!state.connected) {
    state.files = [];
    if (state.activeFile) cerrarArchivo(false);
    renderFiles();
    updateStats();
    return;
  }

  $('#tabla-objetos').innerHTML = spinnerRows(5, 'Cargando objetos…');
  try {
    const datos = await api('/api/objects');
    state.files = Array.isArray(datos.objects) ? datos.objects : [];
  } catch (error) {
    state.files = [];
    $('#tabla-objetos').innerHTML = emptyRows(5, 'i-warn', 'No se pudieron listar los objetos.');
    toast(`No se pudieron listar los objetos: ${error.message}`, 'error');
    updateStats();
    return;
  }

  if (state.activeFile) {
    const actualizado = state.files.find((archivo) => archivo.name === state.activeFile.name);
    if (actualizado) {
      state.activeFile = actualizado;
      renderFileHeader();
    } else {
      cerrarArchivo(false);
      toast('El archivo que estabas viendo ya no existe.', 'error');
    }
  }

  renderFiles();
}

/* -------------------------------- vistas -------------------------------- */

function actualizarURL(file, replace = false) {
  const url = new URL(window.location.href);
  if (file) url.searchParams.set('file', file.name);
  else url.searchParams.delete('file');
  const metodo = replace ? 'replaceState' : 'pushState';
  try {
    history[metodo]({ file: file ? file.name : null }, '', url.toString());
  } catch {
    /* algunos navegadores bloquean el historial en file:// */
  }
}

function renderFileHeader() {
  const file = state.activeFile;
  if (!file) return;
  $('#file-name').textContent = file.name;
  $('#file-meta').textContent = `${kindLabel(file.kind)} · ${formatBytes(file.size)} · ${formatFecha(file.updated)}`;
  $('#file-icon').innerHTML = icon(kindIcon(file.kind), 'icon icon-lg');
  $('#file-icon').dataset.kind = file.kind;
}

function hideFilePanels() {
  ['file-loading', 'file-csv', 'file-image', 'file-pdf', 'file-text', 'file-binary'].forEach((id) => {
    const panel = document.getElementById(id);
    if (panel) panel.hidden = true;
  });
}

function showFilePanel(id) {
  hideFilePanels();
  const panel = document.getElementById(id);
  if (panel) panel.hidden = false;
}

function showFileBinary(mensaje) {
  showFilePanel('file-binary');
  const texto = $('#file-binary .binary-empty span');
  if (texto) {
    texto.textContent = mensaje || 'Descarga el archivo para abrirlo con su aplicación.';
  }
  updateConnection();
}

function previewURL(file) {
  return `/api/objects/preview?name=${encodeURIComponent(file.name)}&v=${encodeURIComponent(file.updated || '')}`;
}

async function openFile(file, push = true) {
  state.activeFile = file;
  state.dataset = null;
  state.searchRows = '';
  $('#search-filas').value = '';

  $('#view-explorer').hidden = true;
  $('#view-file').hidden = false;
  $('#view-title').textContent = 'Archivo';
  $('#btn-back').hidden = false;

  if (push) actualizarURL(file, false);
  renderFileHeader();
  hideFilePanels();

  if (file.kind === 'csv') {
    showFilePanel('file-loading');
    await loadDataset();
  } else if (file.kind === 'image') {
    const nombreActivo = file.name;
    const imagen = $('#preview-image');
    imagen.onload = () => {
      if (state.activeFile && state.activeFile.name === nombreActivo) showFilePanel('file-image');
    };
    imagen.onerror = () => {
      if (state.activeFile && state.activeFile.name === nombreActivo) {
        showFileBinary('No se pudo previsualizar la imagen.');
      }
    };
    imagen.src = previewURL(file);
    showFilePanel('file-image');
  } else if (file.kind === 'pdf') {
    $('#preview-pdf').src = previewURL(file);
    showFilePanel('file-pdf');
  } else if (file.kind === 'text') {
    showFilePanel('file-loading');
    await loadText();
  } else {
    showFileBinary();
  }

  updateConnection();
}

function cerrarArchivo(updateUrl = true) {
  state.activeFile = null;
  state.dataset = null;
  state.searchRows = '';
  $('#search-filas').value = '';
  $('#view-file').hidden = true;
  $('#view-explorer').hidden = false;
  $('#view-title').textContent = 'Explorador';
  $('#btn-back').hidden = true;
  $('#preview-image').removeAttribute('src');
  $('#preview-pdf').removeAttribute('src');
  $('#preview-text').textContent = '';
  hideFilePanels();
  if (updateUrl) actualizarURL(null, true);
  updateConnection();
}

async function openFileByName(name, push = true) {
  const file = state.files.find((archivo) => archivo.name === name);
  if (!file) {
    toast('El archivo ya no existe en el bucket.', 'error');
    return;
  }
  await openFile(file, push);
}

/* -------------------------------- CSV ----------------------------------- */

async function loadDataset() {
  const file = state.activeFile;
  if (!file) return;

  showFilePanel('file-loading');
  try {
    const datos = await api(`/api/dataset?name=${encodeURIComponent(file.name)}`);
    if (!state.activeFile || state.activeFile.name !== file.name) return;
    state.dataset = datos;
    showFilePanel('file-csv');
    renderDataset();
  } catch (error) {
    if (!state.activeFile || state.activeFile.name !== file.name) return;
    state.dataset = {
      columns: [],
      rows: [],
      total: 0,
      editable: false,
      truncated: false,
      error: error.message,
    };
    showFilePanel('file-csv');
    renderDataset();
    toast(`No se pudo abrir el CSV: ${error.message}`, 'error');
  }
}

function renderDataset() {
  const dataset = state.dataset;
  if (!dataset) return;

  const columns = Array.isArray(dataset.columns) ? dataset.columns : [];
  const rows = Array.isArray(dataset.rows) ? dataset.rows : [];
  const editable = Boolean(dataset.editable);
  const consulta = state.searchRows.trim().toLowerCase();

  $('#count-filas').textContent = String(dataset.total || 0);
  $('#btn-add-row').disabled = !state.connected || !editable || columns.length === 0;

  const notice = $('#dataset-notice');
  if (dataset.error) {
    notice.hidden = true;
  } else if (dataset.truncated) {
    notice.textContent = `Vista previa de las primeras ${rows.length} de ${dataset.total} filas. Descarga el CSV para verlo completo.`;
    notice.hidden = false;
  } else if (!editable) {
    notice.textContent = 'Este CSV es de solo lectura.';
    notice.hidden = false;
  } else {
    notice.hidden = true;
  }

  if (dataset.error) {
    $('#dataset-head').innerHTML = '';
    $('#tabla-dataset').innerHTML = emptyRows(2, 'i-warn', dataset.error);
    return;
  }

  if (!columns.length) {
    $('#dataset-head').innerHTML = '<tr><th class="col-row">#</th><th>Contenido</th><th class="col-actions">Acciones</th></tr>';
    $('#tabla-dataset').innerHTML = emptyRows(3, 'i-table', 'Este CSV no tiene encabezados.');
    return;
  }

  $('#dataset-head').innerHTML = `
    <tr>
      <th class="col-row">#</th>
      ${columns.map((column) => `<th>${escapeHTML(column)}</th>`).join('')}
      <th class="col-actions">Acciones</th>
    </tr>`;

  const visibles = rows.filter((row) => {
    if (!consulta) return true;
    return [row.index + 1, ...row.values].join(' ').toLowerCase().includes(consulta);
  });

  if (!visibles.length) {
    $('#tabla-dataset').innerHTML = emptyRows(
      columns.length + 2,
      'i-search',
      rows.length ? 'Sin resultados.' : 'Este CSV no tiene filas.'
    );
    return;
  }

  $('#tabla-dataset').innerHTML = visibles
    .map(
      (row) => `
      <tr data-row="${row.index}">
        <td class="cell-id">${row.index + 1}</td>
        ${columns
          .map(
            (_, index) =>
              `<td class="cell-value" title="${escapeHTML(row.values[index] ?? '')}">${escapeHTML(row.values[index] ?? '')}</td>`
          )
          .join('')}
        <td>
          <div class="row-actions">
            ${
              editable
                ? `<button class="btn-icon" type="button" data-action="edit-row" data-row="${row.index}" title="Editar fila" aria-label="Editar fila ${row.index + 1}">
                    ${icon('i-edit')}
                  </button>
                  <button class="btn-icon" type="button" data-action="delete-row" data-row="${row.index}" title="Eliminar fila" aria-label="Eliminar fila ${row.index + 1}">
                    ${icon('i-trash')}
                  </button>`
                : ''
            }
          </div>
        </td>
      </tr>`
    )
    .join('');
}

async function loadText() {
  const file = state.activeFile;
  if (!file) return;

  try {
    const datos = await api(`/api/objects/text?name=${encodeURIComponent(file.name)}`);
    if (!state.activeFile || state.activeFile.name !== file.name) return;
    $('#preview-text').textContent = datos.text || '';
    $('#text-note').hidden = !datos.truncated;
    showFilePanel('file-text');
  } catch (error) {
    if (!state.activeFile || state.activeFile.name !== file.name) return;
    showFileBinary('No se pudo previsualizar este archivo de texto.');
    toast(`No se pudo previsualizar: ${error.message}`, 'error');
  }
}

/* ------------------------------- toasts --------------------------------- */

function toast(mensaje, tipo = 'info') {
  const contenedor = $('#toasts');
  while (contenedor.children.length >= 3) {
    contenedor.firstElementChild.remove();
  }
  const elemento = document.createElement('div');
  const icono = tipo === 'success' ? 'i-check' : tipo === 'error' ? 'i-warn' : 'i-cloud';
  elemento.className = `toast ${tipo}`;
  elemento.innerHTML = `${icon(icono)}<span>${escapeHTML(mensaje)}</span>`;
  contenedor.appendChild(elemento);

  setTimeout(() => {
    elemento.classList.add('is-leaving');
    setTimeout(() => elemento.remove(), 200);
  }, tipo === 'error' ? 6000 : 3800);
}

/* --------------------------- diálogo de fila ---------------------------- */

function abrirFila(row = null) {
  const dataset = state.dataset;
  if (!state.connected) {
    toast('Sin conexión con Google Cloud Storage.', 'error');
    return;
  }
  if (!dataset || !dataset.editable) {
    toast('Este CSV no se puede editar desde la app.', 'error');
    return;
  }
  if (!dataset.columns.length) {
    toast('El CSV no tiene columnas para editar.', 'error');
    return;
  }

  const esEdicion = Boolean(row);
  $('#row-dialog-title').textContent = esEdicion ? 'Editar fila' : 'Agregar fila';
  $('#row-dialog-subtitle').textContent = esEdicion
    ? `Fila ${row.index + 1} de ${dataset.total}.`
    : `Se agregará al final de ${dataset.total} fila${dataset.total === 1 ? '' : 's'}.`;
  $('#row-submit').textContent = esEdicion ? 'Guardar cambios' : 'Agregar fila';
  $('#row-index').value = esEdicion ? String(row.index) : '';

  $('#row-fields').innerHTML = dataset.columns
    .map(
      (column, index) => `
      <div class="field">
        <label for="row-field-${index}">${escapeHTML(column)}</label>
        <input type="text" id="row-field-${index}" data-column="${index}" value="${escapeHTML(row ? row.values[index] : '')}" maxlength="5000">
      </div>`
    )
    .join('');

  $('#row-dialog').showModal();
  const primero = $('#row-fields input');
  if (primero) primero.focus();
}

async function guardarFila(evento) {
  evento.preventDefault();
  const dataset = state.dataset;
  const file = state.activeFile;
  if (!dataset || !file) return;

  const values = dataset.columns.map((_, index) => {
    const input = document.getElementById(`row-field-${index}`);
    return input ? input.value : '';
  });
  const indice = Number.parseInt($('#row-index').value, 10);
  const esEdicion = Number.isInteger(indice);

  const boton = $('#row-submit');
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = 'Guardando…';

  try {
    if (esEdicion) {
      await api(`/api/dataset/rows?name=${encodeURIComponent(file.name)}&row=${indice}`, {
        method: 'PUT',
        body: JSON.stringify({ values }),
      });
    } else {
      await api(`/api/dataset/rows?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        body: JSON.stringify({ values }),
      });
    }

    $('#row-dialog').close();
    toast(esEdicion ? 'Fila actualizada.' : 'Fila agregada.', 'success');
    await loadFiles();
    if (state.activeFile) await loadDataset();
  } catch (error) {
    toast(`No se pudo guardar la fila: ${error.message}`, 'error');
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

function eliminarFila(row) {
  const file = state.activeFile;
  if (!file || !state.dataset) return;

  abrirConfirmacion({
    titulo: 'Eliminar fila',
    mensaje: `Se eliminará la fila ${row.index + 1}. Esta acción no se puede deshacer.`,
    handler: async () => {
      try {
        await api(`/api/dataset/rows?name=${encodeURIComponent(file.name)}&row=${row.index}`, {
          method: 'DELETE',
        });
        toast('Fila eliminada.', 'success');
        await loadFiles();
        if (state.activeFile) await loadDataset();
      } catch (error) {
        toast(`No se pudo eliminar la fila: ${error.message}`, 'error');
      }
    },
  });
}

/* --------------------------- confirmaciones ----------------------------- */

function abrirConfirmacion({ titulo, mensaje, accion = 'Eliminar', handler }) {
  $('#confirm-title').textContent = titulo;
  $('#confirm-message').textContent = mensaje;
  $('#confirm-accept').textContent = accion;
  state.confirmHandler = handler;
  $('#confirm-dialog').showModal();
  $('#confirm-accept').focus();
}

async function confirmarAccion() {
  if (!state.confirmHandler) return;
  const boton = $('#confirm-accept');
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = 'Procesando…';
  try {
    await state.confirmHandler();
    $('#confirm-dialog').close();
  } catch (error) {
    toast(`No se pudo completar la acción: ${error.message}`, 'error');
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
    state.confirmHandler = null;
  }
}

/* ------------------------------- archivos -------------------------------- */

function elegirArchivo() {
  if (!state.connected) {
    toast('Sin conexión con Google Cloud Storage.', 'error');
    return;
  }
  $('#file-input').click();
}

function subirArchivo(archivo) {
  if (!archivo) return;
  if (!state.connected) {
    toast('Sin conexión con Google Cloud Storage.', 'error');
    return;
  }
  if (state.uploading) {
    toast('Espera a que termine la subida actual.', 'info');
    return;
  }
  const limite = state.maxUploadMB * 1024 * 1024;
  if (archivo.size > limite) {
    toast(`El archivo supera el límite de ${state.maxUploadMB} MB.`, 'error');
    return;
  }

  state.uploading = true;
  const progreso = $('#upload-progress');
  const barra = $('#upload-bar');
  const porcentaje = $('#upload-pct');
  $('#upload-name').textContent = `Subiendo ${archivo.name}`;
  barra.style.width = '0%';
  porcentaje.textContent = '0%';
  progreso.hidden = false;

  const datos = new FormData();
  datos.append('file', archivo);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/objects');

  xhr.upload.addEventListener('progress', (evento) => {
    if (!evento.lengthComputable) return;
    const pct = Math.round((evento.loaded / evento.total) * 100);
    barra.style.width = `${pct}%`;
    porcentaje.textContent = `${pct}%`;
  });

  xhr.addEventListener('load', async () => {
    state.uploading = false;
    let respuesta = null;
    try {
      respuesta = JSON.parse(xhr.responseText);
    } catch {
      respuesta = null;
    }

    if (xhr.status >= 200 && xhr.status < 300) {
      barra.style.width = '100%';
      porcentaje.textContent = '100%';
      const object = respuesta && respuesta.object;
      const nombre = object ? object.name : archivo.name;
      toast(`“${nombre}” ${respuesta && respuesta.replaced ? 'reemplazado' : 'subido'}.`, 'success');
      await loadFiles();
      if (state.activeFile && state.activeFile.name === nombre) {
        const actualizado = state.files.find((item) => item.name === nombre);
        if (actualizado) await openFile(actualizado, false);
      }
      setTimeout(() => {
        progreso.hidden = true;
      }, 600);
    } else {
      progreso.hidden = true;
      const mensaje = respuesta && respuesta.error ? respuesta.error : `Error ${xhr.status}`;
      toast(`No se pudo subir: ${mensaje}`, 'error');
    }
    $('#file-input').value = '';
  });

  xhr.addEventListener('error', () => {
    state.uploading = false;
    progreso.hidden = true;
    toast('Error de red al subir el archivo.', 'error');
    $('#file-input').value = '';
  });

  xhr.send(datos);
}

function descargarArchivo(nombre) {
  window.location.assign(`/api/objects/download?name=${encodeURIComponent(nombre)}`);
}

function descargarActivo() {
  if (state.activeFile) descargarArchivo(state.activeFile.name);
}

function eliminarActivo() {
  const file = state.activeFile;
  if (!file) return;

  abrirConfirmacion({
    titulo: 'Eliminar objeto',
    mensaje: `Se eliminará “${file.name}”. Esta acción no se puede deshacer.`,
    handler: async () => {
      try {
        await api(`/api/objects?name=${encodeURIComponent(file.name)}`, { method: 'DELETE' });
        state.files = state.files.filter((item) => item.name !== file.name);
        cerrarArchivo(true);
        await loadFiles();
        toast('Objeto eliminado.', 'success');
      } catch (error) {
        toast(`No se pudo eliminar: ${error.message}`, 'error');
      }
    },
  });
}

function eliminarObjeto(file) {
  abrirConfirmacion({
    titulo: 'Eliminar objeto',
    mensaje: `Se eliminará “${file.name}”. Esta acción no se puede deshacer.`,
    handler: async () => {
      try {
        await api(`/api/objects?name=${encodeURIComponent(file.name)}`, { method: 'DELETE' });
        const eraActivo = state.activeFile && state.activeFile.name === file.name;
        state.files = state.files.filter((item) => item.name !== file.name);
        if (eraActivo) cerrarArchivo(true);
        await loadFiles();
        toast('Objeto eliminado.', 'success');
      } catch (error) {
        toast(`No se pudo eliminar: ${error.message}`, 'error');
      }
    },
  });
}

/* -------------------------------- eventos -------------------------------- */

function setFilter(filter) {
  state.filter = filter;
  $$('.nav-item[data-filter]').forEach((boton) => {
    boton.classList.toggle('is-active', boton.dataset.filter === filter);
  });
  if (state.activeFile) cerrarArchivo(true);
  renderFiles();
}

async function refrescarVista() {
  const boton = $('#btn-refresh');
  boton.disabled = true;
  try {
    await detectarConexion();
    const nombreActivo = state.activeFile ? state.activeFile.name : null;
    await loadFiles();
    if (nombreActivo) {
      const actualizado = state.files.find((archivo) => archivo.name === nombreActivo);
      if (actualizado) await openFile(actualizado, false);
    }
    if (state.connected) toast('Datos actualizados.', 'success');
  } finally {
    boton.disabled = false;
  }
}

function conectarEventos() {
  $$('.nav-item[data-filter]').forEach((boton) => {
    boton.addEventListener('click', () => setFilter(boton.dataset.filter));
  });

  $('#btn-refresh').addEventListener('click', refrescarVista);
  $('#btn-primary').addEventListener('click', elegirArchivo);
  $('#btn-back').addEventListener('click', () => cerrarArchivo(true));
  $('#btn-file-download').addEventListener('click', descargarActivo);
  $('#btn-binary-download').addEventListener('click', descargarActivo);
  $('#btn-file-delete').addEventListener('click', eliminarActivo);
  $('#btn-add-row').addEventListener('click', () => abrirFila());

  $('#search-objetos').addEventListener('input', (evento) => {
    state.searchFiles = evento.target.value;
    renderFiles();
  });

  $('#search-filas').addEventListener('input', (evento) => {
    state.searchRows = evento.target.value;
    renderDataset();
  });

  $('#tabla-objetos').addEventListener('click', (evento) => {
    const boton = evento.target.closest('button[data-action]');
    if (boton) {
      const nombre = boton.dataset.name;
      if (boton.dataset.action === 'open') openFileByName(nombre);
      if (boton.dataset.action === 'download') descargarArchivo(nombre);
      if (boton.dataset.action === 'delete') {
        const archivo = state.files.find((item) => item.name === nombre);
        if (archivo) eliminarObjeto(archivo);
      }
      return;
    }

    const fila = evento.target.closest('tr[data-name]');
    if (fila) openFileByName(fila.dataset.name);
  });

  $('#tabla-dataset').addEventListener('click', (evento) => {
    const boton = evento.target.closest('button[data-action]');
    if (!boton || !state.dataset) return;
    const row = state.dataset.rows.find((item) => item.index === Number(boton.dataset.row));
    if (!row) return;
    if (boton.dataset.action === 'edit-row') abrirFila(row);
    if (boton.dataset.action === 'delete-row') eliminarFila(row);
  });

  $('#row-form').addEventListener('submit', guardarFila);
  $('#confirm-accept').addEventListener('click', confirmarAccion);

  $$('.dialog').forEach((dialogo) => {
    dialogo.addEventListener('click', (evento) => {
      if (evento.target !== dialogo) return;
      const caja = dialogo.getBoundingClientRect();
      const fuera =
        evento.clientX < caja.left ||
        evento.clientX > caja.right ||
        evento.clientY < caja.top ||
        evento.clientY > caja.bottom;
      if (fuera) dialogo.close();
    });
    dialogo.querySelectorAll('[data-close]').forEach((boton) => {
      boton.addEventListener('click', () => dialogo.close());
    });
  });

  const dropzone = $('#dropzone');
  dropzone.addEventListener('click', elegirArchivo);
  dropzone.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter' || evento.key === ' ') {
      evento.preventDefault();
      elegirArchivo();
    }
  });

  ['dragenter', 'dragover'].forEach((tipo) => {
    dropzone.addEventListener(tipo, (evento) => {
      evento.preventDefault();
      dropzone.classList.add('is-dragging');
    });
  });
  ['dragleave', 'drop'].forEach((tipo) => {
    dropzone.addEventListener(tipo, (evento) => {
      evento.preventDefault();
      dropzone.classList.remove('is-dragging');
    });
  });
  dropzone.addEventListener('drop', (evento) => {
    const archivo = evento.dataTransfer.files && evento.dataTransfer.files[0];
    if (archivo) subirArchivo(archivo);
  });

  window.addEventListener('dragover', (evento) => evento.preventDefault());
  window.addEventListener('drop', (evento) => evento.preventDefault());

  window.addEventListener('popstate', () => {
    const nombre = new URLSearchParams(window.location.search).get('file');
    if (!nombre) {
      cerrarArchivo(false);
      return;
    }
    const archivo = state.files.find((item) => item.name === nombre);
    if (archivo) openFile(archivo, false);
    else {
      cerrarArchivo(false);
      toast('El archivo ya no existe.', 'error');
    }
  });

  $('#file-input').addEventListener('change', (evento) => {
    const archivo = evento.target.files && evento.target.files[0];
    if (archivo) subirArchivo(archivo);
  });
}

/* --------------------------------- boot ---------------------------------- */

async function iniciar() {
  conectarEventos();
  await detectarConexion();
  await loadFiles();

  const nombre = new URLSearchParams(window.location.search).get('file');
  if (nombre) {
    const archivo = state.files.find((item) => item.name === nombre);
    if (archivo) await openFile(archivo, false);
    else {
      toast('El archivo indicado no existe en el bucket.', 'error');
      actualizarURL(null, true);
    }
  }

  updateStats();
}

iniciar();
