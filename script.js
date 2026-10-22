const URL_CSV = 'https://storage.googleapis.com/proyecto-interaccion/alumnos%20(1).csv';

let cabecera = 'id,nombre,edad,carrera';

// Convierte una línea del CSV en columnas (respeta comillas)
function parsearLinea(linea) {
  const cols = [];
  let actual = '';
  let enComillas = false;

  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (enComillas && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else {
        enComillas = !enComillas;
      }
    } else if (c === ',' && !enComillas) {
      cols.push(actual);
      actual = '';
    } else {
      actual += c;
    }
  }
  cols.push(actual);
  return cols;
}

// Prepara un valor para escribirlo en el CSV
function escaparCSV(valor) {
  const v = String(valor ?? '').trim();
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

// Evita que un valor rompa el atributo value="..."
function escaparHTML(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

// Genera el HTML de una fila
function crearFilaHTML(alumno) {
  return `
    <tr>
      <td><input type="text" class="input-id-bloqueado" value="${escaparHTML(alumno.id)}" readonly></td>
      <td><input type="text" class="input-tabla input-nombre" value="${escaparHTML(alumno.nombre)}"></td>
      <td><input type="text" class="input-tabla input-edad" value="${escaparHTML(alumno.edad)}"></td>
      <td><input type="text" class="input-tabla input-carrera" value="${escaparHTML(alumno.carrera)}"></td>
      <td><button onclick="eliminarFila(this)" class="btn-eliminar">Eliminar</button></td>
    </tr>`;
}

async function obtenerDatosDeGoogleCloud() {
  const tabla = document.getElementById('tabla-cuerpo');
  tabla.innerHTML =
    '<tr><td colspan="5" style="text-align:center;color:#777;">Cargando...</td></tr>';

  try {
    // El parámetro ?t= evita que el navegador use una copia vieja
    const respuesta = await fetch(URL_CSV + '?t=' + Date.now(), { cache: 'no-store' });
    if (!respuesta.ok) throw new Error('Error ' + respuesta.status + ' al conectar con la nube.');

    const textoCSV = await respuesta.text();
    const lineas = textoCSV.trim().split(/\r?\n/);
    cabecera = lineas[0];

    const alumnos = [];
    for (let i = 1; i < lineas.length; i++) {
      const linea = lineas[i].trim();
      if (!linea) continue;
      const [id, nombre, edad, carrera] = parsearLinea(linea);
      alumnos.push({ id, nombre, edad, carrera });
    }

    renderizarTabla(alumnos);

  } catch (error) {
    tabla.innerHTML =
      '<tr><td colspan="5" style="text-align:center;color:red;">No se pudieron cargar los datos.</td></tr>';
    alert('Ocurrió un error al cargar el archivo CSV desde Google Cloud.');
    console.error(error);
  }
}

function renderizarTabla(alumnos) {
  const tabla = document.getElementById('tabla-cuerpo');
  tabla.innerHTML = alumnos.map(crearFilaHTML).join('');

  document.getElementById('btn-guardar').style.display = 'inline-block';
  document.getElementById('btn-agregar').style.display = 'inline-block';
}

function agregarFila() {
  const tabla = document.getElementById('tabla-cuerpo');
  const inputsId = tabla.querySelectorAll('.input-id-bloqueado');

  let maximo = 0;
  inputsId.forEach(input => {
    const n = parseInt(input.value) || 0;
    if (n > maximo) maximo = n;
  });

  // insertAdjacentHTML no borra lo que ya escribiste en las otras filas
  tabla.insertAdjacentHTML('beforeend', crearFilaHTML({
    id: maximo + 1,
    nombre: '',
    edad: '',
    carrera: ''
  }));
}

function eliminarFila(boton) {
  boton.closest('tr').remove();
}

async function guardarCambios() {
  const filas = document.querySelectorAll('#tabla-cuerpo tr');
  const lineas = [cabecera];
  let omitidas = 0;

  filas.forEach(fila => {
    const id = fila.querySelector('.input-id-bloqueado')?.value;
    const nombre = fila.querySelector('.input-nombre')?.value;
    const edad = fila.querySelector('.input-edad')?.value;
    const carrera = fila.querySelector('.input-carrera')?.value;

    if (!id) return;
    if (!nombre || !nombre.trim()) {
      omitidas++;
      return;
    }
    lineas.push([id, nombre, edad, carrera].map(escaparCSV).join(','));
  });

  const nuevoCSV = lineas.join('\n');
  const total = lineas.length - 1;

  try {
    const respuesta = await fetch(URL_CSV, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/csv',
        'Cache-Control': 'no-cache'
      },
      body: nuevoCSV
    });
    if (!respuesta.ok) throw new Error('Error ' + respuesta.status + ' al guardar.');

    let mensaje = 'Se guardaron ' + total + ' registros en Google Cloud Storage.';
    if (omitidas > 0) {
      mensaje += '\n(' + omitidas + ' fila(s) sin nombre no se guardaron.)';
    }
    alert(mensaje);

  } catch (error) {
    alert('No se pudo guardar en la nube. Revisa los permisos y el CORS del bucket.');
    console.error(error);
  }
}