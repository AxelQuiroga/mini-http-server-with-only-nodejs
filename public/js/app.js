const videoList = document.getElementById('video-list');
const videoPlayer = document.getElementById('video-player');

async function loadVideos() {

    try {

        const response = await fetch('/api/videos');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        renderVideos(data.videos);

    } catch (error) {

        console.error('Error cargando videos:', error);

        videoList.innerHTML = `
            <p>Error al cargar los videos.</p>
        `;
    }
}

function renderVideos(videos) {

    videoList.innerHTML = '';

    if (videos.length === 0) {

        videoList.innerHTML = `
            <p>No hay videos disponibles.</p>
        `;

        return;
    }

    for (const video of videos) {

        const videoElement = document.createElement('div');

        videoElement.innerHTML = `
            <h3>${video.title}</h3>
            <p>${video.extension}</p>
            <p>${formatFileSize(video.size)}</p>
            <button>Reproducir</button>
        `;

        const button = videoElement.querySelector('button');

        button.addEventListener('click', () => {
            playVideo(video.streamUrl);
        });

        videoList.appendChild(videoElement);
    }
}

function playVideo(streamUrl) {

    videoPlayer.src = streamUrl;
    videoPlayer.play();
}

function formatFileSize(bytes) {

    const megabytes = bytes / (1024 * 1024);

    return `${megabytes.toFixed(2)} MB`;
}

loadVideos();