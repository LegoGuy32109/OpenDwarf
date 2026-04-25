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
    readonly wasm_bindgen__closure__destroy__h409dbfd498be2084: (a: number, b: number) => void;
    readonly wasm_bindgen__closure__destroy__h22346e737654a942: (a: number, b: number) => void;
    readonly wasm_bindgen__closure__destroy__h075bff8f539f1ba3: (a: number, b: number) => void;
    readonly wasm_bindgen__closure__destroy__h60618e950b0d5a0a: (a: number, b: number) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h37e6c02d3db6e060: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h5c48ac1ebbe0956a: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__he8d793be9f6e4af9: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h4fb371da419a6f2c: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h12d50404f4aa91fb: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__hd0084e71271bd5a9: (a: number, b: number, c: number) => void;
    readonly wasm_bindgen__convert__closures_____invoke__hc3a037b5c52cfb54: (a: number, b: number) => number;
    readonly wasm_bindgen__convert__closures_____invoke__h23e751368b289ae3: (a: number, b: number) => void;
    readonly wasm_bindgen__convert__closures_____invoke__hf02e18396f1a6592: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
