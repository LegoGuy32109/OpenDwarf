/* tslint:disable */
/* eslint-disable */

export function main(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly main: () => void;
    readonly wasm_bindgen__closure__destroy__h409dbfd498be2084: (a: number, b: number) => void;
    readonly wasm_bindgen__closure__destroy__hf20232c891986066: (a: number, b: number) => void;
    readonly wasm_bindgen__closure__destroy__h14e7debd4e61acb9: (a: number, b: number) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h89b72b34d1725e4c: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h5c48ac1ebbe0956a: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__he8d793be9f6e4af9: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__hae2e9820e8df2e6c: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h0335c940c9bc5f4f: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__hc3a037b5c52cfb54: (a: number, b: number) => number;
    readonly wasm_bindgen__convert__closures_____invoke__h3222091a8bca946e: (a: number, b: number) => void;
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
