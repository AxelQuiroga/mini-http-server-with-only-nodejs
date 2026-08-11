export interface VideoMediaInfo {
  duration: number;
  width: number;   
  height: number;  
  videoCodec: string;  
  audioCodec?: string| undefined; 
  fps?: number| undefined; 
}