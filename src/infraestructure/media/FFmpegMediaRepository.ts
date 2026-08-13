import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
    VideoMediaInfo
} from '../../domain/types/media.types.js';

import type {
    MediaRepository
} from '../../domain/repositories/MediaRepository.js';

const execFileAsync = promisify(execFile);

export class FFmpegMediaRepository
    implements MediaRepository {

    async getVideoInfo(
        absoluteFilePath: string
    ): Promise<VideoMediaInfo> {

        const args = [
            '-v',
            'quiet',
            '-print_format',
            'json',
            '-show_format',
            '-show_streams',
            absoluteFilePath
        ];

        try {

            const { stdout } =
                await execFileAsync(
                    'ffprobe',
                    args
                );

            const parsedData =
                JSON.parse(stdout);

            const videoStream =
                parsedData.streams?.find(
                    (stream: {
                        codec_type: string
                    }) =>
                        stream.codec_type === 'video'
                );

            const audioStream =
                parsedData.streams?.find(
                    (stream: {
                        codec_type: string
                    }) =>
                        stream.codec_type === 'audio'
                );

            const duration =
                parseFloat(
                    parsedData.format?.duration ??
                    videoStream?.duration ??
                    '0'
                );

            const width =
                videoStream?.width ?? 0;

            const height =
                videoStream?.height ?? 0;

            const videoCodec =
                videoStream?.codec_name ??
                'unknown';

            const audioCodec =
                audioStream?.codec_name;

            let fps: number | undefined;

            if (videoStream?.r_frame_rate) {

                const [
                    num,
                    den
                ] = videoStream.r_frame_rate
                    .split('/')
                    .map(Number);

                if (num && den) {
                    fps =
                        Math.round(
                            (num / den) * 100
                        ) / 100;
                }
            }

            return {
                duration,
                width,
                height,
                videoCodec,
                audioCodec,
                fps
            };

        } catch (error: unknown) {

            console.error(
                `[FFmpegMediaRepository] No se pudo obtener metadata de: ${absoluteFilePath}`,
                error
            );

            throw new Error(
                'MEDIA_METADATA_EXTRACTION_FAILED',
                {
                    cause: error
                }
            );
        }
    }

    async getVideoThumbnail (
        absoluteVideoPath: string,
        thumbnailPath: string
    ): Promise<void> {
        if(existsSync(thumbnailPath)) {
            return;
        }


        try {
            
            mkdirSync(dirname(thumbnailPath), { recursive: true })

        const args = [
            '-i',
            absoluteVideoPath,
            '-ss',
            '1',
            '-frames:v',
            '1',
            '-vf',
            'scale=320:-1',
            '-y',
            thumbnailPath
        ];
        

            await execFileAsync(
                    'ffmpeg',
                    args
                );


        } catch (error) {
            console.error(error);
            throw new Error('THUMBNAIL_GENERATION_FAILED', { cause: error });
        }
    }
    

}