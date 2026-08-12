import type { VideoMediaInfo } from '../types/media.types.js';

export interface MediaRepository {

    getVideoInfo(
        absoluteFilePath: string
    ): Promise<VideoMediaInfo>;

}