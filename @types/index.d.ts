import {SessionOptions, ClientSession, TransactionOptions} from 'mongodb';

declare module 'meteor/bhunjadi:mongo-transactions' {
    class EnvironmentVariable<T> {
        constructor();

        slot: number;

        withValue<R>(value: T, fn: () => R): R;
        get(): T | undefined;
        getOrNullIfOutsideFiber(): T | null | undefined;
    }

    interface RunInTransactionOptions {
        sessionOptions?: SessionOptions;
        transactionOptions?: TransactionOptions;
        retry?: boolean;
    }

    type TransactionCallback<R> = (session: ClientSession) => R;

    const sessionVariable: EnvironmentVariable<ClientSession | undefined>;
    function runInTransaction<R>(fn: TransactionCallback<R>, options?: RunInTransactionOptions): R;
    function isInTransaction(): boolean;
}
