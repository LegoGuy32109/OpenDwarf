import type { Signal } from "@preact/signals";
import { Button } from "../components/Button.tsx";
import { add } from "../lib/rs_lib.js";

interface CounterProps {
  count: Signal<number>;
}

export default function Counter(props: CounterProps) {
  // useEffect(() => {
  //   const getWasm = async () => {
  //     const module = await WebAssembly.compileStreaming(
  //       fetch("../lib/rs_lib.wasm"),
  //     );
  //     const instance = await WebAssembly.instantiate(module);
  //     console.log(instance.exports);
  //   };
  //   getWasm();
  // }, []);
  console.log(add(3, 5));
  return (
    <div class="flex gap-8 py-6">
      <Button onClick={() => props.count.value -= 1}>-1</Button>
      <p class="text-3xl tabular-nums">{props.count}</p>
      <Button onClick={() => props.count.value += 1}>+1</Button>
      <p class="text-3xl tabular-nums">
        {add(props.count.value, props.count.value)}
      </p>
    </div>
  );
}
