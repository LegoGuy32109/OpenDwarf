/// <reference lib="dom" />

export type BlendMode = "off" | "alpha";

export type PassState = {
  blend?: BlendMode;
};

export type ProgramHandle = {
  name: string;
  handle: WebGLProgram;
  vao: WebGLVertexArrayObject;
  strideFloats: number;
  setGlobals: (
    camera: { x: number; y: number; zoom: number },
    zoom: number,
    canvasSize: { width: number; height: number },
    simTick: number,
  ) => void;
};

export type Programs = {
  floor: ProgramHandle;
  edgeShadow: ProgramHandle;
  ceilShadow: ProgramHandle;
};

export type Pass<TCtx> = {
  name: string;
  program: keyof Programs;
  state?: PassState;
  enabled?: (ctx: TCtx) => boolean;
  prepare?: (ctx: TCtx) => void;
  draw: (ctx: TCtx) => void;
};
