import type { VideoMediaInfo } from '../types/media.types.js';

export interface Video {
    id: string;
    title: string;
    fileName: string;
    size: number;
    extension: string;
    streamUrl: string;
    mediaInfo?: VideoMediaInfo;
}