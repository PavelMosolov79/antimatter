import { ArrayBufferTarget, Muxer } from 'mp4-muxer';

/** Frames in, an mp4 (H.264) out, encoded by the browser itself. */
export class Mp4Writer {
  private constructor(
    private enc: VideoEncoder,
    private muxer: Muxer<ArrayBufferTarget>,
    private target: ArrayBufferTarget,
    private fps: number,
  ) {}

  static async create(width: number, height: number, fps: number): Promise<Mp4Writer> {
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: 'avc', width, height }, audio: { codec: 'aac', numberOfChannels: 2, sampleRate: 48000 }, fastStart: 'in-memory' });
    const enc = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => console.log('encoder error', String(e)),
    });
    enc.configure({ codec: 'avc1.640028', width, height, bitrate: 9_000_000, framerate: fps, latencyMode: 'quality' });
    return new Mp4Writer(enc, muxer, target, fps);
  }

  async add(canvas: HTMLCanvasElement, index: number): Promise<void> {
    const frame = new VideoFrame(canvas, { timestamp: Math.round((index * 1e6) / this.fps), duration: Math.round(1e6 / this.fps) });
    this.enc.encode(frame, { keyFrame: index % 30 === 0 });
    frame.close();
    while (this.enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
  }

  /** The soundtrack, as AAC. */
  async addAudio(buf: AudioBuffer): Promise<void> {
    const enc = new AudioEncoder({
      output: (chunk, meta) => this.muxer.addAudioChunk(chunk, meta),
      error: (e) => console.log('audio encoder error', String(e)),
    });
    enc.configure({ codec: 'mp4a.40.2', sampleRate: buf.sampleRate, numberOfChannels: 2, bitrate: 192_000 });
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const N = 1024;
    for (let i = 0; i < L.length; i += N) {
      const n = Math.min(N, L.length - i);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(i, i + n), 0);
      data.set(R.subarray(i, i + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: buf.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / buf.sampleRate) * 1e6), data });
      enc.encode(ad);
      ad.close();
      if (enc.encodeQueueSize > 40) await new Promise((r) => setTimeout(r, 1));
    }
    await enc.flush();
  }

  async finish(): Promise<ArrayBuffer> {
    await this.enc.flush();
    this.muxer.finalize();
    return this.target.buffer;
  }
}
