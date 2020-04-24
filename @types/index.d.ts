import {SessionOptions, ClientSession} from 'mongodb';

declare module 'meteor/bhunjadi:mongo-transactions' {
    class EnvironmentVariable<T> {
        constructor();

        slot: number;

        withValue<R>(value: T, fn: () => R): R;
        get(): T | undefined;
        getOrNullIfOutsideFiber(): T | null | undefined;
    }

    const sessionVariable: EnvironmentVariable<ClientSession>;
    function runInTransaction<R>(fn: () => R, options?: SessionOptions): R;
    function isInTransaction(): boolean;
}
