/* tslint:disable */
/* eslint-disable */

export function main(): void;

export function runtime_worker_main(): void;

export function set_runtime_worker_script_url(worker_script_url: string): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly main: () => void;
    readonly runtime_worker_main: () => void;
    readonly set_runtime_worker_script_url: (a: number, b: number) => void;
    readonly __wasm_bindgen_func_elem_571: (a: number, b: number) => void;
    readonly __wasm_bindgen_func_elem_95959: (a: number, b: number) => void;
    readonly __wasm_bindgen_func_elem_91707: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_572: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_100655: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_95960: (a: number, b: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
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
