import { askWorker } from "../../test/spawnWorker.ts";

export default function WorkerButtons() {
  return (
    <button
      type="button"
      class="text-white bg-slate-700 max-w-lg rounded-sm"
      onClick={() => {
        askWorker(20, 4.2);
      }}
    >
      click
    </button>
  );
}
