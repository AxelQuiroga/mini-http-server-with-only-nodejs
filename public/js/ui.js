const videoList = document.getElementById('video-list');
const videoPlayer = document.getElementById('video-player');

export function renderLoadingState() {
  videoList.innerHTML = `
    <div class="loading-state">
      <p>Cargando biblioteca de videos...</p>
    </div>
  `;
}

export function renderErrorState(message = 'Error al cargar los videos.') {
  videoList.innerHTML = `
    <div class="error-state">
      <p>⚠️ ${escapeHTML(message)}</p>
    </div>
  `;
}

export function renderVideos(videos, onSelectVideo) {
  videoList.innerHTML = '';

  if (!videos || videos.length === 0) {
    videoList.innerHTML = `
      <p class="empty-state">No hay videos disponibles en el servidor.</p>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const video of videos) {
    const videoElement = document.createElement('article');
    videoElement.className = 'video-item';

    videoElement.innerHTML = `
    <div class="video-thumb">
        ${video.thumbnailUrl
    ? `<img src="${video.thumbnailUrl}" alt="${escapeHTML(video.title)}" loading="lazy" onerror="this.style.display='none'"/>`
    : ''}
    </div>
      <div class="video-info">
        <h3>${escapeHTML(video.title)}</h3>
        <p class="meta">${video.extension.toUpperCase()} • ${formatFileSize(video.size)}</p>
      </div>
      <button type="button" class="btn-play">Reproducir</button>
    `;

    const button = videoElement.querySelector('.btn-play');
    button.addEventListener('click', () => {
      onSelectVideo(video, videoElement);
    });

    fragment.appendChild(videoElement);
  }

  videoList.appendChild(fragment);
}

export function playVideo(streamUrl) {
  videoPlayer.src = streamUrl;
  
  // Forzamos la carga de la metadata del nuevo stream
  videoPlayer.load();

  videoPlayer.play()
    .then(() => {
        console.log('Reproducción iniciada');
    })
    .catch((error) => {
        console.error('No se pudo reproducir:', error);
    });
}

export function highlightActiveVideo(activeElement) {
  document.querySelectorAll('.video-item').forEach((el) => {
    el.classList.remove('active');
  });
  if (activeElement) {
    activeElement.classList.add('active');
  }
}

/**
 * Renderiza la sección de detalles del video mediante un título destacado y chips de metadata.
 * @param {Object} video - Objeto del video con su metadata y mediaInfo opcional.
 */
export function renderVideoDetails(video) {
  const detailsContainer = document.getElementById('video-details');
  if (!detailsContainer) return;

  // Guard clause: Si no existe mediaInfo o video, ocultamos y salimos
  if (!video || !video.mediaInfo) {
    detailsContainer.hidden = true;
    detailsContainer.innerHTML = '';
    return;
  }

  const { duration, width, height, videoCodec, audioCodec, fps } = video.mediaInfo;

  // Hacemos visible el contenedor
  detailsContainer.hidden = false;

  // Renderizados condicionales: si no hay dato, la píldora directamente NO se renderiza
  const audioChip = audioCodec
    ? `<span class="detail-chip">🔊 ${audioCodec.toUpperCase()}</span>`
    : '';

  const fpsChip = fps
    ? `<span class="detail-chip">⚡ ${fps} fps</span>`
    : '';

  const resolution = (width && height) ? `${width}×${height}` : '—';

  detailsContainer.innerHTML = `
    <h3 class="video-details-title">${escapeHTML(video.title ?? video.name ?? 'Sin título')}</h3>
    <div class="video-details-chips">
      <span class="detail-chip">⏱ ${formatDuration(duration)}</span>
      <span class="detail-chip">📐 ${resolution}</span>
      <span class="detail-chip">🎞 ${videoCodec ? videoCodec.toUpperCase() : '—'}</span>
      ${audioChip}
      ${fpsChip}
      <span class="detail-chip">💾 ${formatFileSize(video.size)}</span>
    </div>
  `;
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes.toFixed(2)} MB`;
}

function escapeHTML(str) {
    return String(str).replace(/[&<>'"]/g, (tag) =>
        ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        })[tag] || tag
    );
}

export function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';

  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  const paddedMinutes = String(minutes).padStart(2, '0');
  const paddedSeconds = String(remainingSeconds).padStart(2, '0');

  return `${paddedMinutes}:${paddedSeconds}`;
}


// ============================================================
// UPLOAD DE VIDEO — funciones de representación visual
// ============================================================
// ui.js conoce DOM, clases, atributos y representación de estados.
// No conoce XMLHttpRequest, endpoints, status codes ni reglas de negocio.

// Referencias a elementos del upload (se resuelven una vez al cargar el módulo)
const uploadZone       = document.getElementById('upload-zone');
const uploadFilename   = document.getElementById('upload-filename');
const uploadStatus     = document.getElementById('upload-status');
const uploadTrack      = document.getElementById('upload-progress-track');
const uploadFill       = document.getElementById('upload-progress-fill');
const uploadPercentage = document.getElementById('upload-percentage');
const uploadBytes      = document.getElementById('upload-bytes');

/**
 * Resetea la zona de upload al estado idle.
 * Llamar ANTES de arrancar un upload nuevo (limpia estado anterior).
 *
 * Qué hace:
 *   - data-state → "idle"
 *   - #upload-filename → ""
 *   - #upload-status → ""
 *   - #upload-progress-fill → width: 0%
 *   - #upload-progress-track → aria-valuenow: 0
 *   - #upload-percentage → ""
 *   - #upload-bytes → ""
 */
export function resetUploadZone() {
  uploadZone.dataset.state = 'idle';
  uploadFilename.textContent = '';
  uploadStatus.textContent = '';
  uploadFill.style.width = '0%';
  uploadTrack.setAttribute('aria-valuenow', '0');
  uploadPercentage.textContent = '';
  uploadBytes.textContent = '';
}

/**
 * Establece el nombre del archivo en la zona de upload.
 * Se llama DESPUÉS de resetUploadZone y ANTES de showUploadZone.
 *
 * @param {string} fileName — nombre original del archivo seleccionado
 */
export function setUploadFilename(fileName) {
  uploadFilename.textContent = fileName;
}

/**
 * Muestra la zona de upload.
 * Remueve el atributo hidden de #upload-zone.
 */
export function showUploadZone() {
  uploadZone.removeAttribute('hidden');
}

/**
 * Oculta la zona de upload.
 * Agrega el atributo hidden a #upload-zone.
 */
export function hideUploadZone() {
  uploadZone.setAttribute('hidden', '');
}

/**
 * Actualiza la representación visual del progreso de transmisión.
 * Se invoca MÚLTIPLES veces durante el upload.
 *
 * IMPORTANTE: 100% significa que el 100% de los bytes fueron transmitidos
 * por XHR, NO que el upload completo terminó. Después de este evento
 * seguimos en processing hasta recibir la respuesta HTTP del backend.
 *
 * @param {{ loaded: number, total: number, percent: number }} progress
 */
export function renderUploadProgress(progress) {
  uploadZone.dataset.state = 'uploading';
  uploadFill.style.width = `${progress.percent}%`;
  uploadTrack.setAttribute('aria-valuenow', String(progress.percent));
  uploadPercentage.textContent = `${progress.percent}%`;
  uploadBytes.textContent = `${formatFileSize(progress.loaded)} / ${formatFileSize(progress.total)}`;
  uploadStatus.textContent = 'Subiendo...';
}

/**
 * Transiciona al estado de procesamiento (backend trabajando).
 * Se llama UNA VEZ cuando la transmisión llega al 100%.
 *
 * La barra se queda al 100% con animación pulsante (definida en CSS).
 * El aria-label se actualiza para que lectores de pantalla distingan
 * esta fase de la transmisión de bytes.
 */
export function renderUploadProcessing() {
  uploadZone.dataset.state = 'processing';
  uploadStatus.textContent = 'Procesando...';
  uploadTrack.setAttribute('aria-valuenow', '100');
  uploadTrack.setAttribute('aria-label', 'Procesando video');
}

/**
 * Transiciona al estado de éxito.
 * Se llama UNA VEZ cuando el backend responde con success.
 *
 * La barra se vuelve verde (CSS) y el status muestra confirmación.
 */
export function renderUploadSuccess() {
  uploadZone.dataset.state = 'success';
  uploadStatus.textContent = '✓ Video subido correctamente';
  uploadTrack.setAttribute('aria-label', 'Video subido correctamente');
}

/**
 * Transiciona al estado de error.
 * Se llama UNA VEZ cuando el upload falla.
 * El error permanece visible hasta que el usuario seleccione un archivo nuevo.
 *
 * @param {string} message — mensaje ya formateado por el caller.
 *                           ui.js NO traduce códigos de error.
 */
export function renderUploadError(message) {
  uploadZone.dataset.state = 'error';
  uploadStatus.textContent = message;
  uploadTrack.setAttribute('aria-label', 'Error en la subida');
}