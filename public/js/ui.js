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