export function createFakeCache() {
  const store = new Map<string, Blob | string>();
  return {
    store,
    match(url: string) {
      const kept = this.store.get(url);
      return Promise.resolve(
        kept === undefined ? undefined : new Response(kept),
      );
    },
    put(url: string, response: Response) {
      return response.blob().then((blob) => void this.store.set(url, blob));
    },
    delete(url: string) {
      return Promise.resolve(this.store.delete(url));
    },
    keys() {
      return Promise.resolve([...this.store.keys()].map((url) => ({ url })));
    },
  };
}
