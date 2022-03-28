import {SessionOptions, ClientSession, TransactionOptions} from 'mongodb';

declare module 'meteor/bhunjadi:mongo-transactions' {
    interface RunInTransactionOptions {
        sessionOptions?: SessionOptions;
        transactionOptions?: TransactionOptions;
        // when true, using session.withTransaction which retries transaction callback or commit operation (whichever failed)
        // see: https://mongodb.github.io/node-mongodb-native/3.6/api/ClientSession.html#withTransaction
        retry?: boolean;

        // Should runInTransaction function wait for all async callbacks, for example Meteor.insert({}, callback);
        // Might be useful if cache is used.
        waitForCallbacks?: boolean;
        // Whether runInTransaction should catch async functions errors. 
        // True value only makes sense if waitForCallbacks is true.
        // If there are any errors, runInTransaction will throw an error.
        catchCallbackErrors?: boolean;
    }

    type TransactionCallback<R> = (session: ClientSession) => R;

    interface SessionContext {
        session: ClientSession;
        // waitForCallbacks: boolean;
        catchCallbackErrors: boolean;
    
        callbackCount: number;
        callbackErrors: unknown[];
        resolveCallbacks();
    }

    const sessionVariable: Meteor.EnvironmentVariable<SessionContext | undefined>;
    function runInTransaction<R>(fn: TransactionCallback<R>, options?: RunInTransactionOptions): R;
    function isInTransaction(): boolean;

    class CallbackError extends Error {
        callbackErrors: unknown[];
    }

    function setDefaultOptions(options: RunInTransactionOptions): void;
    function getDefaultOptions(): RunInTransactionOptions;
}
