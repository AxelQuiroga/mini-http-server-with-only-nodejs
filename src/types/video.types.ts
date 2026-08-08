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