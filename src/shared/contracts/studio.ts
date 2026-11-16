export interface StudioFile { path: string; size: number }
export interface StudioProject { name: string; size: number; files: StudioFile[] }
export type StudioResult<T> = { ok: true; value: T } | { ok: false; message: string };
export interface StudioAPI {
 list(): Promise<StudioResult<StudioProject[]>>;
 read(input: { project: string; path: string }): Promise<StudioResult<{ content: Uint8Array; format: string }>>;
 photos(input: { project: string; path: string }): Promise<StudioResult<{ name: string; url: string }[]>>;
}
