import { IS_BROWSER } from "fresh/runtime";
import { JSX } from "preact";

export function Button(props: JSX.IntrinsicElements["button"]) {
  return (
    <button
      {...props}
      disabled={!IS_BROWSER || props.disabled}
      class="px-2 py-1 border-gray-500 border-2 rounded bg-white text-gray-800 hover:bg-gray-200 transition-colors"
    />
  );
}
