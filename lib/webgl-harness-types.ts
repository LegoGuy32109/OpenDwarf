export type FlowDescriptor = {
  name: string;
  seed: string;
  camera?: { x: number; y: number; zoom?: number };
};

export type PerfWindow = {
  frames: number;
  cpuMs: { p50: number; p95: number; max: number };
  drawCalls: { p50: number; p95: number; max: number };
  uploadBytes: number;
};
