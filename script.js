
const URL_CSV = 'https://storage.googleapis.com/proyecto-interaccion/alumnos%20(1).csv';

const URL_PROXY = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(URL_CSV);

async function obtenerDatosDeGoogleCloud() {
  try {
    const respuesta = await fetch(URL_PROXY);
    if (!respuesta.ok) throw new Error('Error al conectar con la nube.');
    
    const textoCSV = await respuesta.text();

    const lineas = textoCSV.trim().split('\n');
    const tabla = document.getElementById('tabla-cuerpo');
    tabla.innerHTML = ''; // Limpiar la tabla

    // Empezamos desde i = 1 para saltarnos la cabecera del CSV
    for (let i = 1; i < lineas.length; i++) {
      const linea = lineas[i].trim();
      if (linea) {
        const columnas = linea.split(',');
        
        const id = columnas[0];
        const nombre = columnas[1];
        const edad = columnas[2];
        const carrera = columnas[3];

        // Insertamos cajas de texto (input) para que los datos sean editables
        const fila = `
          <tr>
            <td><input type="text" class="input-tabla input-id" value="${id}"></td>
            <td><input type="text" class="input-tabla input-nombre" value="${nombre}"></td>
            <td><input type="text" class="input-tabla input-edad" value="${edad}"></td>
            <td><input type="text" class="input-tabla input-carrera" value="${carrera}"></td>
          </tr>
        `;
        tabla.innerHTML += fila;
      }
    }

    // Mostrar el botón de guardar cambios al cargar los datos
    document.getElementById('btn-guardar').style.display = 'inline-block';

  } catch (error) {
    alert('Ocurrió un error al cargar el archivo CSV desde Google Cloud.');
    console.error(error);
  }
}


function guardarCambios() {
  const filas = document.querySelectorAll('#tabla-cuerpo tr');
  const datosActualizados = [];

  filas.forEach(fila => {
    const id = fila.querySelector('.input-id')?.value;
    const nombre = fila.querySelector('.input-nombre')?.value;
    const edad = fila.querySelector('.input-edad')?.value;
    const carrera = fila.querySelector('.input-carrera')?.value;

    if (id && nombre) {
      datosActualizados.push({ id, nombre, edad, carrera });
    }
  });

  console.log('Datos actualizados:', datosActualizados);
  alert('✨ ¡Los cambios han sido guardados correctamente!');
}