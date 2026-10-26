const express = require('express');
const multer = require('multer');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const BUCKET_NAME = process.env.GCS_BUCKET || 'proyecto-interaccion';
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_DATASET_ROWS = 5000;
const MAX_PREVIEW_ROWS = 500;
const MAX_PREVIEW_CHARS = 200000;

const { Storage } = require('@google-cloud/storage');
const bucket = new Storage().bucket(BUCKET_NAME);

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.get(['/', '/interfaz.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'interfaz.html'));
});
app.get(['/script.js', '/diseno.css'], (req, res) => {
  res.sendFile(path.join(__dirname, req.path.slice(1)));
});

/* ------------------------------- conexión ------------------------------- */

let cloudState = { ok: false, checkedAt: 0, reason: 'Sin comprobar' };

function friendlyCloudError(error) {
  const message = String(error && error.message ? error.message : error);
  if (/could not load the default credentials|Unable to detect a Project Id/i.test(message)) {
    return 'No se encontraron credenciales de Google Cloud';
  }
  if (/ENOENT|does not exist, or it is not a file/i.test(message)) {
    return 'No se encontró el archivo de credenciales';
  }
  if (/403|forbidden|permission/i.test(message)) {
    return 'La cuenta no tiene permisos sobre el bucket';
  }
  if (/404|not found|bucket does not exist/i.test(message)) {
    return 'El bucket no existe o no es visible';
  }
  return message.split('\n')[0].slice(0, 160);
}

async function cloudReady(force = false) {
  if (!force && Date.now() - cloudState.checkedAt < 20000) {
    return cloudState;
  }
  try {
    await bucket.getFiles({ maxResults: 1, autoPaginate: false });
    cloudState = { ok: true, checkedAt: Date.now(), reason: '' };
  } catch (error) {
    cloudState = { ok: false, checkedAt: Date.now(), reason: friendlyCloudError(error) };
  }
  return cloudState;
}

async function requireCloud() {
  const mode = await cloudReady();
  if (mode.ok) return;
  const error = new Error(mode.reason || 'Sin conexión con Google Cloud Storage');
  error.status = 503;
  error.publicMessage = 'No se pudo conectar con Google Cloud Storage.';
  throw error;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.publicMessage = message;
  return error;
}

/* ------------------------------- objetos -------------------------------- */

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif']);
const TEXT_EXTENSIONS = new Set([
  '.csv', '.tsv', '.txt', '.md', '.json', '.html', '.css', '.js', '.xml', '.yaml', '.yml',
  '.log', '.ini', '.sql', '.sh', '.bat', '.ps1', '.py', '.java', '.c', '.cpp', '.h',
]);

function contentTypeFor(name) {
  const ext = path.extname(name).toLowerCase();
  const types = {
    '.csv': 'text/csv; charset=utf-8',
    '.tsv': 'text/tab-separated-values; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.avif': 'image/avif',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return types[ext] || 'application/octet-stream';
}

function isTextObject(name, contentType = '') {
  const ext = path.extname(name).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  return /^text\//i.test(contentType) || /json|xml|javascript/i.test(contentType);
}

function objectKind(name, contentType = '') {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.csv') return 'csv';
  if (IMAGE_EXTENSIONS.has(ext) || /^image\//i.test(contentType)) return 'image';
  if (ext === '.pdf' || contentType === 'application/pdf') return 'pdf';
  if (isTextObject(name, contentType)) return 'text';
  return 'binary';
}

function cleanObjectName(raw) {
  const name = String(raw || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .trim();
  if (!name || name === '.' || name === '..' || name.length > 160) return null;
  if (/[\u0000-\u001f<>:"|?*]/.test(name)) return null;
  return name;
}

function decodeUploadName(name) {
  const original = String(name || '');
  if (!/[^\x00-\x7F]/.test(original)) return original;
  const decoded = Buffer.from(original, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? original : decoded;
}

function isValidObjectName(raw) {
  const name = String(raw || '').trim();
  if (!name || name.length > 1024) return false;
  if (name.startsWith('/') || name.endsWith('/')) return false;
  if (name.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return false;
  return !/[\u0000-\u001f]/.test(name);
}

function requestedObjectName(req) {
  const name = String(req.query.name || '');
  if (!isValidObjectName(name)) throw httpError(400, 'Nombre de objeto inválido.');
  return name;
}

function isNotFound(error) {
  return Number(error && error.code) === 404 || /not.?found|no such object/i.test(String(error && error.message));
}

async function readObject(name) {
  await requireCloud();
  const [buffer] = await bucket.file(name).download();
  return buffer;
}

async function writeObject(name, buffer, contentType) {
  await requireCloud();
  await bucket.file(name).save(buffer, {
    resumable: false,
    contentType: contentType || contentTypeFor(name),
  });
}

async function deleteObject(name) {
  await requireCloud();
  await bucket.file(name).delete({ ignoreNotFound: true });
}

async function listObjects() {
  await requireCloud();
  const [files] = await bucket.getFiles();
  return files.map((file) => {
    const contentType = file.metadata.contentType || contentTypeFor(file.name);
    return {
      name: file.name,
      size: Number(file.metadata.size || 0),
      updated: file.metadata.updated || new Date().toISOString(),
      contentType,
      kind: objectKind(file.name, contentType),
    };
  });
}

/* --------------------------------- CSV ---------------------------------- */

function detectDelimiter(texto) {
  const contenido = String(texto || '').replace(/^\uFEFF/, '');
  const candidatos = [',', ';', '\t', '|'];
  let mejor = ',';
  let mejorConteo = 0;

  for (const linea of contenido.split(/\r?\n/).slice(0, 10)) {
    if (!linea.trim()) continue;
    const conteos = new Map(candidatos.map((delimiter) => [delimiter, 0]));
    let entreComillas = false;

    for (let i = 0; i < linea.length; i++) {
      const c = linea[i];
      if (c === '"') {
        if (entreComillas && linea[i + 1] === '"') {
          i++;
        } else {
          entreComillas = !entreComillas;
        }
      } else if (!entreComillas && conteos.has(c)) {
        conteos.set(c, conteos.get(c) + 1);
      }
    }

    for (const [delimiter, conteo] of conteos) {
      if (conteo > mejorConteo) {
        mejor = delimiter;
        mejorConteo = conteo;
      }
    }
    if (mejorConteo > 0) break;
  }

  return mejor;
}

function parsearCSV(texto, delimiter = ',') {
  const contenido = String(texto || '').replace(/^\uFEFF/, '');
  const filas = [];
  let fila = [];
  let campo = '';
  let entreComillas = false;

  for (let i = 0; i < contenido.length; i++) {
    const c = contenido[i];

    if (entreComillas) {
      if (c === '"') {
        if (contenido[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === delimiter) {
      fila.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && contenido[i + 1] === '\n') i++;
      fila.push(campo);
      campo = '';
      if (fila.some((valor) => String(valor).trim() !== '')) filas.push(fila);
      fila = [];
    } else {
      campo += c;
    }
  }

  fila.push(campo);
  if (fila.some((valor) => String(valor).trim() !== '')) filas.push(fila);
  return filas;
}

function escaparCSV(valor, delimiter = ',') {
  const texto = String(valor ?? '');
  if (texto.includes(delimiter) || /["\r\n]/.test(texto)) {
    return '"' + texto.replace(/"/g, '""') + '"';
  }
  return texto;
}

function serializarCSV(columns, rows, delimiter = ',') {
  const lineas = [columns.map((column) => escaparCSV(column, delimiter)).join(delimiter)];
  for (const row of rows) {
    lineas.push(columns.map((_, index) => escaparCSV(row.values[index], delimiter)).join(delimiter));
  }
  return lineas.join('\n') + '\n';
}

function normalizarDataset(texto) {
  const delimiter = detectDelimiter(texto);
  const filas = parsearCSV(texto, delimiter);
  if (!filas.length) {
    return { columns: [], rows: [], total: 0, delimiter };
  }

  const header = filas[0];
  const ancho = filas.slice(1).reduce((maximo, fila) => Math.max(maximo, fila.length), header.length);
  const columns = [];
  const usados = new Set();

  for (let i = 0; i < ancho; i++) {
    const base = String(header[i] ?? '').trim() || `Columna ${i + 1}`;
    let nombre = base;
    let sufijo = 2;
    while (usados.has(nombre.toLowerCase())) {
      nombre = `${base} (${sufijo++})`;
    }
    usados.add(nombre.toLowerCase());
    columns.push(nombre);
  }

  const rows = filas.slice(1).map((values, index) => ({
    index,
    values: columns.map((_, columnIndex) => String(values[columnIndex] ?? '')),
  }));

  return { columns, rows, total: rows.length, delimiter };
}

async function leerDataset(name) {
  const buffer = await readObject(name);
  return normalizarDataset(buffer.toString('utf8'));
}

async function guardarDataset(name, dataset) {
  const texto = serializarCSV(dataset.columns, dataset.rows, dataset.delimiter || ',');
  await writeObject(name, Buffer.from(texto, 'utf8'), 'text/csv; charset=utf-8');
}

let colaLecturaEscritura = Promise.resolve();
function enCola(tarea) {
  const resultado = colaLecturaEscritura.then(tarea, tarea);
  colaLecturaEscritura = resultado.catch(() => {});
  return resultado;
}

function valuesFromBody(body, columns) {
  const values = body && body.values;
  if (Array.isArray(values)) {
    return columns.map((_, index) => String(values[index] ?? ''));
  }
  if (values && typeof values === 'object') {
    return columns.map((column) => String(values[column] ?? ''));
  }
  return null;
}

/* --------------------------------- API ---------------------------------- */

app.get('/api/status', async (req, res) => {
  const mode = await cloudReady();
  res.json({
    connected: mode.ok,
    reason: mode.reason || null,
    bucket: BUCKET_NAME,
    maxUploadMB: MAX_UPLOAD_BYTES / (1024 * 1024),
    maxDatasetRows: MAX_DATASET_ROWS,
    now: new Date().toISOString(),
  });
});

app.get('/api/objects', async (req, res, next) => {
  try {
    const objects = await listObjects();
    objects.sort((a, b) => new Date(b.updated) - new Date(a.updated));
    res.json({ objects });
  } catch (error) {
    next(error);
  }
});

app.post('/api/objects', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Selecciona un archivo para subir.' });
    const name = cleanObjectName(decodeUploadName(req.file.originalname));
    if (!name) return res.status(400).json({ error: 'Nombre de archivo no permitido.' });

    await requireCloud();
    const [exists] = await bucket.file(name).exists();
    await writeObject(name, req.file.buffer, req.file.mimetype);
    const contentType = req.file.mimetype || contentTypeFor(name);

    res.status(exists ? 200 : 201).json({
      replaced: exists,
      object: {
        name,
        size: req.file.size,
        contentType,
        updated: new Date().toISOString(),
        kind: objectKind(name, contentType),
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/objects/download', async (req, res, next) => {
  try {
    const name = requestedObjectName(req);
    await requireCloud();

    const file = bucket.file(name);
    const [exists] = await file.exists();
    if (!exists) return res.status(404).json({ error: 'El archivo no existe.' });

    const [metadata] = await file.getMetadata();
    res.setHeader('Content-Type', metadata.contentType || contentTypeFor(name));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(name)}`
    );
    file.createReadStream().on('error', next).pipe(res);
  } catch (error) {
    next(error);
  }
});

app.get('/api/objects/preview', async (req, res, next) => {
  try {
    const name = requestedObjectName(req);
    await requireCloud();

    const file = bucket.file(name);
    const [exists] = await file.exists();
    if (!exists) return res.status(404).json({ error: 'El archivo no existe.' });

    const [metadata] = await file.getMetadata();
    const contentType = metadata.contentType || contentTypeFor(name);
    const kind = objectKind(name, contentType);
    if (!['image', 'pdf'].includes(kind)) {
      return res.status(415).json({ error: 'Este tipo de archivo no tiene vista previa.' });
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    if (path.extname(name).toLowerCase() === '.svg') {
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    }
    file.createReadStream().on('error', next).pipe(res);
  } catch (error) {
    next(error);
  }
});

app.get('/api/objects/text', async (req, res, next) => {
  try {
    const name = requestedObjectName(req);
    await requireCloud();
    const [metadata] = await bucket.file(name).getMetadata();
    const contentType = metadata.contentType || contentTypeFor(name);
    if (!isTextObject(name, contentType)) {
      return res.status(415).json({ error: 'Este archivo no es de texto.' });
    }

    const [buffer] = await bucket.file(name).download();
    const fullText = buffer.toString('utf8');
    const truncated = fullText.length > MAX_PREVIEW_CHARS;
    res.json({
      name,
      text: truncated ? fullText.slice(0, MAX_PREVIEW_CHARS) : fullText,
      truncated,
    });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/objects', async (req, res, next) => {
  try {
    const name = requestedObjectName(req);
    await deleteObject(name);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/dataset', async (req, res, next) => {
  try {
    const name = requestedObjectName(req);
    if (path.extname(name).toLowerCase() !== '.csv') {
      return res.status(415).json({ error: 'Solo los archivos .csv se pueden abrir como tabla.' });
    }

    const dataset = await leerDataset(name);
    const truncated = dataset.total > MAX_DATASET_ROWS;
    res.json({
      name,
      columns: dataset.columns,
      rows: truncated ? dataset.rows.slice(0, MAX_PREVIEW_ROWS) : dataset.rows,
      total: dataset.total,
      editable: !truncated,
      truncated,
    });
  } catch (error) {
    if (isNotFound(error)) return res.status(404).json({ error: 'El archivo CSV no existe.' });
    next(error);
  }
});

app.post('/api/dataset/rows', async (req, res, next) => {
  try {
    const name = requestedObjectName(req);
    if (path.extname(name).toLowerCase() !== '.csv') {
      return res.status(415).json({ error: 'Solo los archivos .csv se pueden editar como tabla.' });
    }

    const result = await enCola(async () => {
      const dataset = await leerDataset(name);
      if (dataset.columns.length === 0) {
        throw httpError(400, 'El CSV no tiene encabezados para crear columnas.');
      }
      if (dataset.total >= MAX_DATASET_ROWS) {
        throw httpError(413, `El CSV supera el límite de ${MAX_DATASET_ROWS} filas para editarse desde la app.`);
      }

      const values = valuesFromBody(req.body || {}, dataset.columns);
      if (!values) throw httpError(400, 'Faltan los valores de la fila.');
      dataset.rows.push({ index: dataset.rows.length, values });
      await guardarDataset(name, dataset);
      return { total: dataset.rows.length };
    });

    res.status(201).json({ ok: true, total: result.total });
  } catch (error) {
    next(error);
  }
});

app.put('/api/dataset/rows', async (req, res, next) => {
  try {
    const name = requestedObjectName(req);
    if (path.extname(name).toLowerCase() !== '.csv') {
      return res.status(415).json({ error: 'Solo los archivos .csv se pueden editar como tabla.' });
    }

    const rowIndex = Number.parseInt(req.query.row, 10);
    if (!Number.isInteger(rowIndex) || rowIndex < 0) {
      return res.status(400).json({ error: 'Fila inválida.' });
    }

    await enCola(async () => {
      const dataset = await leerDataset(name);
      if (rowIndex >= dataset.rows.length) throw httpError(404, 'La fila no existe.');
      const values = valuesFromBody(req.body || {}, dataset.columns);
      if (!values) throw httpError(400, 'Faltan los valores de la fila.');
      dataset.rows[rowIndex] = { index: rowIndex, values };
      await guardarDataset(name, dataset);
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/dataset/rows', async (req, res, next) => {
  try {
    const name = requestedObjectName(req);
    if (path.extname(name).toLowerCase() !== '.csv') {
      return res.status(415).json({ error: 'Solo los archivos .csv se pueden editar como tabla.' });
    }

    const rowIndex = Number.parseInt(req.query.row, 10);
    if (!Number.isInteger(rowIndex) || rowIndex < 0) {
      return res.status(400).json({ error: 'Fila inválida.' });
    }

    await enCola(async () => {
      const dataset = await leerDataset(name);
      if (rowIndex >= dataset.rows.length) throw httpError(404, 'La fila no existe.');
      dataset.rows.splice(rowIndex, 1);
      dataset.rows = dataset.rows.map((row, index) => ({ index, values: row.values }));
      await guardarDataset(name, dataset);
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

app.use((error, req, res, next) => {
  console.error('[error]', error.message);
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `El archivo supera el límite de ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.` });
  }
  if (isNotFound(error)) {
    return res.status(404).json({ error: 'El objeto no existe en el bucket.' });
  }
  const status = Number(error.status || error.code) || 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: error.publicMessage || 'Ocurrió un error en el servidor.',
    detail: process.env.NODE_ENV === 'production' ? undefined : friendlyCloudError(error),
  });
});

/* ------------------------------- arranque ------------------------------- */

(async () => {
  const mode = await cloudReady(true);
  app.listen(PORT, () => {
    console.log('');
    console.log('  Cloud Lab - Google Cloud Storage');
    console.log(`  http://localhost:${PORT}`);
    console.log(
      mode.ok
        ? `  Bucket: ${BUCKET_NAME}`
        : `  Sin conexión: ${mode.reason}`
    );
    console.log('');
  });
})().catch((error) => {
  console.error('No se pudo iniciar el servidor:', error);
  process.exit(1);
});
