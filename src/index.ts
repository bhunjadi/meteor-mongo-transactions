import {MongoInternals} from 'meteor/mongo';
import {Promise} from 'meteor/promise';
import type {
    ClientSessionOptions, 
    TransactionOptions,
    ClientSession, 
    MongoClient, 
} from 'mongodb';
import patchCollectionMethods from './patchCollectionMethods';
import { SessionContext } from './types';

/**
 * Ideas from:
 * https://forums.meteor.com/t/solved-transactions-with-mongodb-meteor-methods/48677
 *
 * Mongo native driver docs (Collection related):
 * https://mongodb.github.io/node-mongodb-native/3.6/api/Collection.html
 */

export class CallbackError extends Error {
    constructor(message: string, private callbackErrors: unknown[]) {
        super(message);
    }
}

function createCallbackError(errors: unknown[]) {
    const first = errors[0];
    
    const message = typeof first === 'string' 
        ? first 
        : (first instanceof Error) ? first.message : 'Unknown callback error.';

    return new CallbackError(message, errors);
}

/**
 * Storing context here for each transaction.
 */
export const sessionVariable = new Meteor.EnvironmentVariable<SessionContext | undefined>();
patchCollectionMethods(sessionVariable);

/**
 * This function uses onException parameter to log all exceptions that have happened in bindEnvironment and 
 * stores them in SessionContext.
 * That way we can know which errors did happen in async functions.
 */
function patchBindEnvironment() {
    const originalBindEnvironment = Meteor.bindEnvironment as any;
    Meteor.bindEnvironment = function (fn, onException, _this) {
        const context = sessionVariable.get();

        if (context?.catchCallbackErrors) {
            // Same constraints as in original method
            // @ts-ignore
            Meteor._nodeCodeMustBeInFiber();

            // Had to copy this from bindEnvironment since we're overriding onException callback and we must
            // keep validation here.
            if (!onException || typeof(onException) === 'string') {
                var description = onException || "callback of async function";
                onException = function (error) {
                Meteor._debug(
                    "Exception in " + description + ":",
                    error
                );
                };
            } else if (typeof(onException) !== 'function') {
                throw new Error('onException argument must be a function, string or undefined for Meteor.bindEnvironment().');
            }

            // Wrapper function which keeps track of all 
            const wrappedOnException = function (error) {
                const ctx = sessionVariable.get();
                if (ctx?.catchCallbackErrors) {
                    context.callbackErrors.push(error);
                }
                // do the default
                onException(error);
            };

            return originalBindEnvironment(fn, wrappedOnException, _this);
        }

        return originalBindEnvironment(fn, onException, _this);
    } as any;
}
patchBindEnvironment();

function getClient(): MongoClient {
    const {client} = MongoInternals.defaultRemoteCollectionDriver().mongo;
    return client;
}

function createSession(options: ClientSessionOptions = {}) {
    return getClient().startSession(options);
}

export interface RunInTransactionOptions {
    sessionOptions?: ClientSessionOptions;
    transactionOptions?: TransactionOptions;
    // when true, using session.withTransaction which retries transaction callback or commit operation (whichever failed)
    // see: https://mongodb.github.io/node-mongodb-native/3.6/api/ClientSession.html#withTransaction
    retry?: boolean;

    // Should the runInTransaction wait for all async callbacks, for example Meteor.insert({}, callback);
    // Might be useful if cache is used.
    waitForCallbacks?: boolean;
    // Whether runInTransaction should catch async functions errors. 
    // True value only makes sense if waitForCallbacks is true.
    // If there are any errors, runInTransaction will throw an error.
    catchCallbackErrors?: boolean;
}

export type TransactionCallback<R> = (session: ClientSession) => R;

type RunOptions = RunInTransactionOptions & {
    waitForCallbacksPromise?: Promise<void>;
}

function runWithoutRetry<R>(context: SessionContext, fn: TransactionCallback<R>, options: RunOptions): R {
    const {session} = context;

    let result;
    session.startTransaction(options.transactionOptions);
    try {
        try {
            result = fn(session);
        }
        finally {
            if (options.waitForCallbacksPromise && context.callbackCount > 0) {
                Promise.await(options.waitForCallbacksPromise);
                if (context.callbackErrors[0]) {
                    throw createCallbackError(context.callbackErrors);
                }
            }
        }

        Promise.await(session.commitTransaction());
    }
    catch (e) {
        Promise.await(session.abortTransaction());
        throw e;
    }
    finally {
        session.endSession();
    }
    return result;
}

function runWithRetry<R>(context: SessionContext, fn: TransactionCallback<R>, options: RunOptions): R {
    const {session} = context;
    let result;
    try {
        Promise.await(session.withTransaction((clientSession) => {
            try {
                result = fn(clientSession);
            }
            finally {
                if (options.waitForCallbacksPromise && context.callbackCount > 0) {
                    Promise.await(options.waitForCallbacksPromise);
                    if (context.callbackErrors[0]) {
                        throw createCallbackError(context.callbackErrors);
                    }
                }
            }
            // withTransactionCallback must return promise, as per docs (3.6)
            return Promise.resolve(result);
        }, {
            ...options.transactionOptions,
            retryWrites: true,
        }));
    }
    catch (e) {
        throw e;
    }
    finally {
        session.endSession();
    }
    return result;
}

let defaultOptions: RunInTransactionOptions = {};

export function setDefaultOptions(options: RunInTransactionOptions) {
    defaultOptions = options;
}

export function getDefaultOptions(): RunInTransactionOptions {
    return defaultOptions;
}

export function runInTransaction<R>(fn: TransactionCallback<R>, options: RunInTransactionOptions = defaultOptions): R {
    if (sessionVariable.get()) {
        throw new Error('Nested transactions are not supported');
    }

    const session = createSession(options.sessionOptions);

    let resolver: () => void = () => {};
    const callbackPromise = options.waitForCallbacks ? new Promise<void>((resolve) => {
        resolver = resolve;
    }) : undefined;

    return sessionVariable.withValue({
        session,
        callbackCount: 0,
        catchCallbackErrors: !!options.waitForCallbacks && !!options.catchCallbackErrors,
        resolveCallbacks: resolver,
        callbackErrors: [],
    }, function () {
        const context = sessionVariable.get()!;
        if (options.retry) {
            return runWithRetry(context, fn, {
                ...options,
                waitForCallbacksPromise: callbackPromise,
            });
        }
        return runWithoutRetry(context, fn, {
            ...options,
            waitForCallbacksPromise: callbackPromise,
        });
    });
}

export function isInTransaction(): boolean {
    const context = sessionVariable.get();
    return context?.session.inTransaction() ?? false;
}
