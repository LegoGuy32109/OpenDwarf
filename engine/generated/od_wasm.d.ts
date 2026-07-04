/* tslint:disable */
/* eslint-disable */

export class UiEngine {
    free(): void;
    [Symbol.dispose](): void;
    abi_drawcmd_stride(): number;
    abi_glyph_stride(): number;
    abi_glyph_stride_floats(): number;
    abi_program_rect(): number;
    abi_program_text(): number;
    abi_rect_stride(): number;
    abi_rect_stride_floats(): number;
    drawlist_capacity(): number;
    drawlist_ptr(): number;
    dropped_draw_cmds(): number;
    dropped_glyphs(): number;
    dropped_rects(): number;
    frame(): number;
    glyph_capacity(): number;
    glyph_ptr(): number;
    input_capacity(): number;
    input_ptr(): number;
    constructor();
    rect_capacity(): number;
    rect_ptr(): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_uiengine_free: (a: number, b: number) => void;
    readonly uiengine_abi_drawcmd_stride: (a: number) => number;
    readonly uiengine_abi_glyph_stride: (a: number) => number;
    readonly uiengine_abi_glyph_stride_floats: (a: number) => number;
    readonly uiengine_abi_program_rect: (a: number) => number;
    readonly uiengine_abi_program_text: (a: number) => number;
    readonly uiengine_abi_rect_stride_floats: (a: number) => number;
    readonly uiengine_drawlist_capacity: (a: number) => number;
    readonly uiengine_drawlist_ptr: (a: number) => number;
    readonly uiengine_dropped_draw_cmds: (a: number) => number;
    readonly uiengine_dropped_glyphs: (a: number) => number;
    readonly uiengine_dropped_rects: (a: number) => number;
    readonly uiengine_frame: (a: number) => number;
    readonly uiengine_glyph_capacity: (a: number) => number;
    readonly uiengine_glyph_ptr: (a: number) => number;
    readonly uiengine_input_capacity: (a: number) => number;
    readonly uiengine_input_ptr: (a: number) => number;
    readonly uiengine_new: () => number;
    readonly uiengine_rect_capacity: (a: number) => number;
    readonly uiengine_rect_ptr: (a: number) => number;
    readonly uiengine_abi_rect_stride: (a: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
