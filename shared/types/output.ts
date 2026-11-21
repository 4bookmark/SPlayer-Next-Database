import type { PlayerState, Track } from "./player";

export type OutputProtocol = "local" | "upnp" | "sonos" | "chromecast" | "airplay";

export interface OutputTarget {
  id: string;
  name: string;
  protocol: OutputProtocol;
  address?: string;
  port?: number;
  controlUrl?: string;
  renderingUrl?: string;
  group?: string;
}

export interface OutputPlaybackStatus {
  state: PlayerState;
  positionMs: number;
  durationMs: number;
  volume: number;
  external: boolean;
  finished?: boolean;
}

export interface OutputState {
  targets: OutputTarget[];
  activeId: string;
  scanning: boolean;
  connecting: boolean;
  error?: string;
}

export interface OutputApi {
  scan(): Promise<OutputState>;
  getState(): Promise<OutputState>;
  selectTarget(id: string): Promise<OutputState>;
  disconnect(): Promise<OutputState>;
  onState(callback: (state: OutputState) => void): () => void;
}

export interface RemoteOutputBackend {
  load(url: string, track: Track | undefined, positionMs: number, autoPlay: boolean): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  close(): Promise<void>;
}

export type OutputStatusListener = (status: OutputPlaybackStatus) => void;
