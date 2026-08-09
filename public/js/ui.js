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

  const playPromise = videoPlayer.play();
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