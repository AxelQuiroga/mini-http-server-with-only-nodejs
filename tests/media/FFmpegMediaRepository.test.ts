import { FFmpegMediaRepository } from '../../src/infraestructure/media/FFmpegMediaRepository.js';

const mediaRepository = new FFmpegMediaRepository();

const videoPath =
    '/home/electro-pc/node-streams/public/videos/Camera Roll/WIN_20260601_18_14_21_Pro.mp4';

async function main() {

    console.log('Analizando video...');

    const metadata = await mediaRepository.getVideoInfo(videoPath);

    console.log('\nMetadata obtenida:');
    console.dir(metadata, { depth: null });
}

main().catch((error) => {
    console.error('\nFalló el test:', error);
    process.exit(1);
});