# Cloud Lab · Explorador de Google Cloud Storage

Aplicación web para explorar un bucket de Google Cloud Storage, previsualizar archivos y editar cualquier CSV como una tabla dinámica.

## Funcionalidades

- Explorador de objetos con búsqueda y filtros por tipo.
- Vista previa de imágenes, PDF y archivos de texto.
- Apertura de cualquier `.csv` como tabla, sin columnas fijas.
- Alta, edición y eliminación de filas leyendo los encabezados reales del CSV.
- Subida con arrastrar y soltar, barra de progreso y límite de 20 MB.
- Descarga y eliminación de objetos del bucket.
- Interfaz adaptable a móvil.

## Requisitos

- Node.js 18 o superior.
- Credenciales de Google Cloud con acceso al bucket.

## Inicio rápido

```powershell
npm install
npm start
```

Abre `http://localhost:3000`.

Si PowerShell bloquea `npm.ps1` por la política de ejecución, usa `npm.cmd start` o directamente
`node server.js`.

## Credenciales de Google Cloud

Opción A, con una cuenta autorizada:

```powershell
gcloud auth application-default login
npm start
```

Opción B, con una cuenta de servicio:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\ruta\clave.json"
$env:GCS_BUCKET="proyecto-interaccion"
npm start
```

La cuenta necesita permisos para listar, leer, crear, actualizar y eliminar objetos.
Para una demo, el rol **Storage Object Admin** sobre el bucket es suficiente.

> No subas el archivo de la clave al repositorio.

## Variables de entorno

| Variable | Predeterminado | Descripción |
| --- | --- | --- |
| `PORT` | `3000` | Puerto del servidor |
| `GCS_BUCKET` | `proyecto-interaccion` | Nombre del bucket |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Ruta a la clave de la cuenta de servicio |

## API

| Método | Ruta | Acción |
| --- | --- | --- |
| `GET` | `/api/status` | Estado de la conexión y configuración |
| `GET` | `/api/objects` | Lista los objetos del bucket |
| `POST` | `/api/objects` | Sube un archivo (`multipart/form-data`, campo `file`) |
| `GET` | `/api/objects/download?name=...` | Descarga un objeto |
| `GET` | `/api/objects/preview?name=...` | Vista previa inline de imagen o PDF |
| `GET` | `/api/objects/text?name=...` | Texto de un archivo para previsualizar |
| `DELETE` | `/api/objects?name=...` | Elimina un objeto |
| `GET` | `/api/dataset?name=...` | Lee un CSV y devuelve columnas y filas |
| `POST` | `/api/dataset/rows?name=...` | Agrega una fila al CSV |
| `PUT` | `/api/dataset/rows?name=...&row=...` | Actualiza una fila del CSV |
| `DELETE` | `/api/dataset/rows?name=...&row=...` | Elimina una fila del CSV |

## Estructura

```
server.js       API Express + acceso a Google Cloud Storage
interfaz.html   Estructura de la interfaz
diseno.css      Estilos (tema oscuro)
script.js       Lógica del frontend
```

## Notas

- No hay un CSV principal ni columnas obligatorias: la tabla se construye con el encabezado del archivo que abras.
- Los archivos que no son `.csv` se previsualizan si son imágenes, PDF o texto; el resto se descarga.
- Para editar un CSV desde la app debe tener encabezados y menos de 5000 filas. Los archivos más grandes se muestran en modo de solo lectura.
- Los archivos se cargan en memoria antes de escribirse en el bucket; el límite está en
  `MAX_UPLOAD_BYTES` dentro de `server.js`.

## Guion corto para la presentación

1. Mostrar el estado de conexión y el bucket en la barra lateral.
2. Subir un CSV distinto y abrirlo desde el explorador; mostrar que las columnas se generan solas.
3. Editar, agregar y eliminar una fila; volver al explorador y verificar el objeto actualizado.
4. Abrir una imagen o PDF para mostrar la vista previa y descargar un archivo binario.
5. Enseñar en la consola de Google Cloud el objeto creado dentro del bucket.
