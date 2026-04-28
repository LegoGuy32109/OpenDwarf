function initWorker() {
  const workerCode = `
    self.onmessage = (event) => {
      const start = performance.now();
      const { x, y, indexStart, indexEnd } = event.data;
      let count = 0;
      for (let index = indexStart; index < indexEnd; index++) {
        count += Math.sqrt(x * index) * Math.sin(y * index);
      }
      const end = performance.now();
      self.postMessage({ durationInMilliseconds: end - start, result: count });
    };
  `;

  const blob = new Blob([workerCode], {
    type: "text/javascript",
  });
  const url = URL.createObjectURL(blob);

  const worker = new Worker(url);

  worker.onmessage = (event) => {
    console.log("worker message:", event.data);
  };

  worker.onerror = (event) => {
    console.error("worker error:", event.message);
  };

  return {
    worker,
    terminate: () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    },
  };
}

function cpuTest(x: number, y: number) {
  let count = 0;
  const start = performance.now();
  for (let index = 0; index < 75_000_000; index++) {
    count += Math.sqrt(x * index) * Math.sin(y * index);
  }
  const end = performance.now();
  return { durationInMilliseconds: end - start, result: count };
}

function cpuTestSegmented(
  x: number,
  y: number,
  indexStart: number,
  indexEnd: number,
) {
  let count = 0;
  const start = performance.now();
  for (let index = indexStart; index < indexEnd; index++) {
    count += Math.sqrt(x * index) * Math.sin(y * index);
  }
  const end = performance.now();
  return { durationInMilliseconds: end - start, result: count };
}

function makeIndexSegments(numSegments: number) {
  const total = 75_000_000;

  const baseLength = Math.floor(total / numSegments);
  const remainder = total % numSegments;

  let start = 0;

  return Array.from({ length: numSegments }).map((_, index) => {
    const length = baseLength + (index < remainder ? 1 : 0);
    const end = start + length;

    const segment = [start, end];
    start = end;

    return segment;
  });
}

export async function askWorker(x: number, y: number) {
  console.log("== Starting Test ==");
  // const { durationInMilliseconds, result } = cpuTest(x, y);
  // console.log(result, durationInMilliseconds, "ms");
  //
  const indexSegments = makeIndexSegments(navigator.hardwareConcurrency);
  //
  // const totalStart = performance.now();
  // let total = 0;
  // indexSegments.forEach(([indexStart, indexEnd], index) => {
  //   const { durationInMilliseconds, result } = cpuTestSegmented(
  //     x,
  //     y,
  //     indexStart,
  //     indexEnd,
  //   );
  //   total += result;
  //   console.log(
  //     `${
  //       index + 1
  //     }/${indexSegments.length} ${result} ${durationInMilliseconds} ms`,
  //   );
  // });
  // const totalEnd = performance.now();
  // console.log(result, total, " - ", totalEnd - totalStart, "ms");

  const workerStart = performance.now();
  const workerPromises = indexSegments.map(([indexStart, indexEnd], index) =>
    new Promise<number>((res, rej) => {
      const { worker, terminate } = initWorker();
      worker.onmessageerror = (event) => {
        console.error("worker message error:", event.data);
        rej(0);
      };
      worker.onerror = (event) => {
        console.error("worker error:", event.message);
        rej(0);
      };
      worker.onmessage = (event) => {
        const { durationInMilliseconds, result } = event.data;
        console.log(
          `${
            index + 1
          }/${indexSegments.length} ${result} ${durationInMilliseconds} ms`,
        );
        terminate();
        res(result);
      };
      worker.postMessage({ x, y, indexStart, indexEnd });
    })
  );
  const workerResults = await Promise.all(workerPromises);
  const workerResult = workerResults.reduce((prev, curr) => prev + curr);
  const workerEnd = performance.now();
  console.log(workerResult, " - ", workerEnd - workerStart, "ms");
}
