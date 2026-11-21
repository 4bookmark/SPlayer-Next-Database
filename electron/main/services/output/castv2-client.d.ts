declare module "castv2-client" {
  import { EventEmitter } from "node:events";
  export interface MediaStatus {
    mediaSessionId?: number;
    playerState?: string;
    idleReason?: string;
    currentTime?: number;
    media?: { contentId?: string; duration?: number };
    volume?: { level?: number };
  }
  export type Callback<T = MediaStatus> = (error: Error | null, result: T) => void;
  export class DefaultMediaReceiver extends EventEmitter {
    static APP_ID: string;
    media: { currentSession: MediaStatus | null; stop: () => void };
    load(
      media: Record<string, unknown>,
      options: { autoplay: boolean; currentTime: number },
      callback: Callback,
    ): void;
    getStatus(callback: Callback): void;
    play(callback: Callback): void;
    pause(callback: Callback): void;
    stop(callback: Callback): void;
    seek(seconds: number, callback: Callback): void;
  }
  export class Client extends EventEmitter {
    client: EventEmitter | null;
    connect(options: { host: string; port: number }, callback: () => void): void;
    launch(receiver: typeof DefaultMediaReceiver, callback: Callback<DefaultMediaReceiver>): void;
    setVolume(volume: { level: number }, callback: Callback<unknown>): void;
    close(): void;
  }
}
