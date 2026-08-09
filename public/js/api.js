export async function fetchVideos() {
    const response = await fetch('/api/videos');

    if(!response.ok){
        throw new Error(`HTTP Error: ${response.status}`);
    }

    const data = await response.json();

    return data.videos ??  [];
}