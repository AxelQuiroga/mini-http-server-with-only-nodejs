import type { Video } from '../entities/Video.js';

export interface VideoRepository {

    findAll(): Promise<Video[]>;

    findById(id: string): Promise<Video | null>;
}