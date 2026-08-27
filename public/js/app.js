import {
  fetchVideos,
  uploadVideo,
  UploadRequestError,
} from './api.js';
import {
  renderLoadingState,
  renderErrorState,
  renderVideos,
  playVideo,
  highlightActiveVideo,
  renderVideoDetails,
  resetUploadZone,
  setUploadFilename,
  showUploadZone,
  hideUploadZone,
  renderUploadProgress,
  renderUploadProcessing,
  renderUploadSuccess,
  renderUploadError,
} from './ui.js';

// ============================================================
// ESTADO GLOBAL
// ============================================================

// isUploading representa TODO el ciclo: upload → feedback → refresh.
// Mientras sea true, el beforeunload advierte y el botón está deshabilitado.
let isUploading = false;

// ============================================================
// REFERENCIAS A DOM (control, no representación visual)
// ============================================================

const btnUpload = document.getElementById('btn-upload');
const fileInput = document.getElementById('file-input');

// ============================================================
// MAPEO DE ERRORES → MENSAJES DE USUARIO
// ============================================================

// app.js es quien traduce códigos de error a mensajes amigables.
// ui.js solo recibe el string ya formateado.
const ERROR_MESSAGES = {
  INVALID_FILENAME:    'Nombre de archivo inválido',
  FILE_ALREADY_EXISTS: 'Ya existe un video con ese nombre',
  PAYLOAD_TOO_LARGE:   'El archivo excede el límite de 500 MB',
  UNSUPPORTED_MEDIA:   'Tipo de archivo no soportado',
  SERVER_ERROR:        'Error interno del servidor',
  NETWORK_ERROR:       'Error de conexión. Verificá tu red.',
};

// ============================================================
// UTILIDADES
// ============================================================

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// BIBLIOTECA
// ============================================================

async function refreshLibrary() {
  try {
    const videos = await fetchVideos();
    renderVideos(videos, (selectedVideo, element) => {
      highlightActiveVideo(element);
      playVideo(selectedVideo.streamUrl);
      renderVideoDetails(selectedVideo);
    });
  } catch (error) {
    console.error('Error refrescando biblioteca:', error);
  }
}

// ============================================================
// FLUJO DE UPLOAD
// ============================================================

function handleUploadClick() {
  if (isUploading) return;
  fileInput.click();
}

async function handleFileSelected() {
  // Si el usuario canceló el picker, files está vacío
  if (fileInput.files.length === 0) return;

  const file = fileInput.files[0];

  // --- Iniciar ciclo ---
  isUploading = true;
  btnUpload.disabled = true;
  resetUploadZone();
  setUploadFilename(file.name);
  showUploadZone();

  // processingShown: protege contra múltiples invocaciones de
  // renderUploadProcessing(). xhr.upload.onprogress puede disparar
  // más de una vez con percent === 100 (depende del browser).
  // 100% = bytes transmitidos, NO = upload terminado.
  let processingShown = false;

  try {
    await uploadVideo(file, (progress) => {
      renderUploadProgress(progress);

      // Transición explícita a processing: solo una vez
      if (progress.percent === 100 && !processingShown) {
        processingShown = true;
        renderUploadProcessing();
      }
    });

    // --- Éxito ---
    renderUploadSuccess();

    // Feedback visible durante1500ms, independiente del refresh
    await delay(1500);

    hideUploadZone();

    // Refresh no crítico: si falla, se loguea y la biblioteca
    // queda desactualizada hasta la próxima oportunidad
    await refreshLibrary();

  } catch (error) {
    // --- Error de upload ---
    if (error instanceof UploadRequestError) {
      renderUploadError(ERROR_MESSAGES[error.code] ?? 'Error al subir el video');
    } else {
      console.error('Error inesperado durante upload:', error);
      renderUploadError('Error inesperado. Intentá de nuevo.');
    }

  } finally {
    // --- Finalizar ciclo ---
    // Ejecuta después del try completo (incluido el delay de 1500ms)
    // o después del catch. En ambos casos, el ciclo terminó.
    isUploading = false;
    btnUpload.disabled = false;
    fileInput.value = '';
  }
}

// ============================================================
// BEFOREUNLOAD
// ============================================================

// Registrado una vez. Chequea isUploading internamente.
// Si no hay upload activo, no hace nada.
function handleBeforeUnload(event) {
  if (!isUploading) return;
  event.preventDefault();
  event.returnValue = '';
}

// ============================================================
// INICIALIZACIÓN
// ============================================================

async function init() {
  renderLoadingState();

  try {
    const videos = await fetchVideos();

    renderVideos(videos, (selectedVideo, element) => {
      highlightActiveVideo(element);
      playVideo(selectedVideo.streamUrl);
      renderVideoDetails(selectedVideo);
    });

  } catch (error) {
    console.error('Error inicializando la aplicación:', error);
    renderErrorState('No se pudo conectar con el servidor multimedia.');
  }

  // Event listeners de upload
  btnUpload.addEventListener('click', handleUploadClick);
  fileInput.addEventListener('change', handleFileSelected);

  // beforeunload: registrado una vez, siempre activo
  window.addEventListener('beforeunload', handleBeforeUnload);
}

document.addEventListener('DOMContentLoaded', init);
