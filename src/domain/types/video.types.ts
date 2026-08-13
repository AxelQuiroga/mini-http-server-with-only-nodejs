import type{ VideoMediaInfo } from './media.types.js';

export interface ByteRange {
  start: number;
  end: number;
}

export interface VideoStreamMetadata {
  stream: import('node:fs').ReadStream;
  start: number;
  end: number;
  totalSize: number;
  contentLength: number;
}

export interface VideoMetadata {
  id: string;          
  title: string;     
  fileName: string;    
  size: number;        
  extension: string;   
  streamUrl: string;
  mediaInfo?: VideoMediaInfo;
  thumbnailUrl?: string
}