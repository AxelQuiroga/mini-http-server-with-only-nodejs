import type { ByteRange } from './video.types.js';

export type RangeParseResult =
  | { type: 'none' }
  | { type: 'valid'; range: ByteRange }
  | { type: 'invalid' };