import WorkerButtons from "../islands/test/workerTest.tsx";

export default function Greet() {
  return (
    <div class="px-4 mx-auto fresh-gradient bg-[#1B1C1F] min-h-screen flex flex-col">
      <h1 class="text-4xl font-extrabold uppercase tracking-[0.12em] my-4 text-[#D4B27A] drop-shadow-[0_3px_0_rgba(0,0,0,0.4)] [text-shadow:0_0_12px_rgba(120,78,32,0.35)]">
        Hello
      </h1>

      <WorkerButtons />
    </div>
  );
}
