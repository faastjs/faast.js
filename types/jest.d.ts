declare namespace jest {
    interface Each {
        <T extends any[]>(cases: T[]): (name: string, fn: (...args: T) => any) => void;
    }
    interface Describe {
        each: Each;
    }
}
