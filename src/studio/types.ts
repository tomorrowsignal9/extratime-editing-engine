import type { ProjectData } from "../engine/schema";
export type Asset = {
  id: string;
  name: string;
  kind: "image" | "audio" | "srt";
  path: string;
  thumbnail?: string;
  bytes: number;
  duration?: number;
  width?: number;
  height?: number;
};
export type StudioProject = {
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  deletedAt?: string;
  assets: Asset[];
  captions: ProjectData["captions"];
  manifest: ProjectData | null;
};
export type Job = {
  id: string;
  projectId: string;
  title: string;
  revision: number;
  status:
    "queued" | "running" | "verifying" | "succeeded" | "failed" | "cancelled";
  progress: number;
  createdAt: string;
  finishedAt?: string;
  pid?: number;
  error?: string;
};
