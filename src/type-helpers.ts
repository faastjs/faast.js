export type NonFunctionPropertyNames<T> = {
    [K in keyof T]: T[K] extends Function ? never : K
}[keyof T];

export type NonFunctionProperties<T> = Pick<T, NonFunctionPropertyNames<T>>;

export type Omit<T, K> = Pick<T, Exclude<keyof T, K>>;

export type PartialRequire<T, K extends keyof T> = Partial<T> & Pick<T, K>;

export type Mutable<T> = { -readonly [key in keyof T]: T[key] };

export type AnyFunction = (...args: any[]) => any;

export type Unpacked<T> = T extends Promise<infer D> ? D : T;
