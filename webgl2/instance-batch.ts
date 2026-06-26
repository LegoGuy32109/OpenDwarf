/// <reference lib="dom" />

export type InstanceBatchStats = {
  drawCalls: number;
  instances: number;
};

export function flushInstanceBatch(
  gl: WebGL2RenderingContext,
  instanceBuffer: WebGLBuffer,
  scratch: Float32Array,
  instanceCount: number,
  strideFloats: number,
  stats: InstanceBatchStats,
) {
  if (instanceCount === 0) {
    return;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.bufferSubData(
    gl.ARRAY_BUFFER,
    0,
    scratch.subarray(0, instanceCount * strideFloats),
  );
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instanceCount);
  stats.drawCalls++;
  stats.instances += instanceCount;
}
