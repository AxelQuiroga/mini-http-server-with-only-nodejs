import { FileSystemRepository } from '../filesystem/FileSystemRepository.js';
import { FFmpegMediaRepository } from '../media/FFmpegMediaRepository.js';

import { VideoService } from '../../application/services/VideoService.js';
import { UploadService } from '../../application/services/UploadService.js';

import { StaticFileController } from '../../presentation/controllers/StaticFileController.js';
import { VideoController } from '../../presentation/controllers/VideoController.js';
import { UploadController } from '../../presentation/controllers/UploadController.js';

export const fileRepository =
    new FileSystemRepository();

const mediaRepository =
    new FFmpegMediaRepository();

const videoService = new VideoService(
    fileRepository,
    mediaRepository
);

const uploadService = new UploadService(
    fileRepository,
    mediaRepository
);

export const staticFileController =
    new StaticFileController(fileRepository);

export const videoController =
    new VideoController(videoService);

export const uploadController =
    new UploadController(uploadService);
    