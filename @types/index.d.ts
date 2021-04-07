import {SessionOptions, ClientSession, TransactionOptions} from 'mongodb';

declare module 'meteor/bhunjadi:mongo-transactions' {
    interface RunInTransactionOptions {
        sessionOptions?: SessionOptions;
        transactionOptions?: TransactionOptions;
        retry?: boolean;
    }

    type TransactionCallback<R> = (session: ClientSession) => R;

    const sessionVariable: Meteor.EnvironmentVariable<ClientSession | undefined>;
    function runInTransaction<R>(fn: TransactionCallback<R>, options?: RunInTransactionOptions): R;
    function isInTransaction(): boolean;
}
