import { MongoInternals } from 'meteor/mongo';

export type MongoClient = MongoInternals.MongoConnection['client'];
export type ClientSession = ReturnType<MongoClient['startSession']>;
export type ClientSessionOptions = Parameters<MongoClient['startSession']>[0];
export type TransactionOptions = Exclude<Parameters<ClientSession['withTransaction']>[1], undefined>;

export interface SessionContext {
    session: ClientSession;
    catchCallbackErrors: boolean;

    callbackCount: number;
    callbackErrors: unknown[];
    resolveCallbacks();
}
