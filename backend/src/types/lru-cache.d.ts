declare module 'lru-cache' {
  interface Options<K, V> {
    max?: number;
    maxAge?: number;
    length?: (value: V, key?: K) => number;
    dispose?: (key: K, value: V) => void;
    stale?: boolean;
    maxSize?: number;
    sizeCalculation?: (value: V, key?: K) => number;
  }

  class LRU<K, V> {
    constructor(options?: Options<K, V>);
    set(key: K, value: V, maxAge?: number): boolean;
    get(key: K): V | undefined;
    peek(key: K): V | undefined;
    has(key: K): boolean;
    delete(key: K): void;
    clear(): void;
    reset(): void;
    readonly size: number;
    readonly max: number;
  }

  export = LRU;
}
