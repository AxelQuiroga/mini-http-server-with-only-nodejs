import { fetchVideos } from './api.js';
import {
  renderLoadingState,
  renderErrorState,
  renderVideos,
  playVideo,
  highlightActiveVideo
} from './ui.js';

async function init() {
  renderLoadingState();

  try {
    const videos = await fetchVideos();

    renderVideos(videos, (selectedVideo, element) => {
      highlightActiveVideo(element);
      playVideo(selectedVideo.streamUrl);
    });

  } catch (error) {
    console.error('Error inicializando la aplicación:', error);
    renderErrorState('No se pudo conectar con el servidor multimedia.');
  }
}

// Evento de inicio cuando el DOM está listo
document.addEventListener('DOMContentLoaded', init);