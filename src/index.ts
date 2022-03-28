import {MongoInternals} from 'meteor/mongo';
import {Promise} from 'meteor/promise';
import type {
    SessionOptions, 
    TransactionOptions,
    ClientSession, 
    MongoClient, 
    Collection as MongoDBCollection, 
    FilterQuery,
    MongoClientOptions,
} from 'mongodb';

/**
 * Ideas from:
 * https://forums.meteor.com/t/solved-transactions-with-mongodb-meteor-methods/48677
 *
 * Mongo native driver docs (Collection related):
 * https://mongodb.github.io/node-mongodb-native/3.6/api/Collection.html
 */

interface SessionContext {
    session: ClientSession;
    catchCallbackErrors: boolean;

    callbackCount: number;
    callbackErrors: unknown[];
    resolveCallbacks();
}

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

/**
 * With this function we wrap each callback function to keep track of all the async callbacks that were created for a session.
 * When callbacks number falls to 0, promise waiting for all callbacks to be done is resolved.
 */
function wrapCallback(callback: Function) {
    const context = sessionVariable.get();
    if (!context) {
        return callback;
    }

    context.callbackCount += 1;

    return Meteor.bindEnvironment(function (this: unknown, ...args: unknown[]) {
        const callbackRes = callback.call(this, ...args);

        // Note: Is this even necessary or we can just use context here?
        const ctx = sessionVariable.get();
        if (ctx) {
            ctx.callbackCount -= 1;
            if (ctx.callbackCount === 0) {
                ctx.resolveCallbacks();
            }
        }
        return callbackRes;
    });
}

/**
 * Function that adds session (if necessary) to options and callback method arguments.
 */
function getOptionsAndCallbackArgs(...args) {
    const context = sessionVariable.get();
    if (!context) {
        return args;
    }

    const {session} = context;

    // nothing is passed here
    if (args.length === 0) {
        return [{session}];
    }

    if (args.length === 1) {
        const [optionsOrCallback] = args;
        if (typeof optionsOrCallback === 'function') {
            return [{session}, wrapCallback(optionsOrCallback)];
        }
        // we have options in optionsOrCallback
        return [{
            ...optionsOrCallback,
            session,
        }];
    }

    const [options, callback] = args;
    return [{
        ...options,
        session,
    }, callback ? wrapCallback(callback) : undefined];
}

const RawCollection = MongoInternals.NpmModule.Collection;
/**
 * Most of the MongoDB's Collection methods belong in one of the three categories by the signature:
 * 1. (options, callback)
 * 2. (param1, options, callback)
 * 3. (param1, param2, options, callback)
 * 4. (param1, param2, param3, options, callback)
 *
 * Options and callback are always optional.
 * ParamN - they might be optional, too.
 *
 * To simplify the overriding process, these methods are grouped into these groups and then overridden.
 */
const METHODS_WITH_ZERO_PARAMS = [
    'drop',
    'dropIndexes',
    'indexes',
    'indexInformation',
    'initializeOrderedBulkOp',
    'isCapped',
    'options',
    'parallelCollectionScan',
    'reIndex',
];

/**
 * aggregate, count, countDocuments - optional first param
 */
const METHODS_WITH_ONE_PARAM = [
    'insert',
    'insertOne',
    'insertMany',
    'remove',
    'deleteOne',
    'deleteMany',
    'bulkWrite',
    'aggregate',
    'count',
    'countDocuments',
    'createIndex',
    'createIndexes',
    'dropIndex',
    'ensureIndex',
    'findOne',
    'findOneAndDelete',
    'indexExists',
    'rename',
    'save',
];

const METHODS_WITH_TWO_PARAMS = [
    'distinct', // 2nd param is optional
    'findAndRemove',
    'findOneAndReplace',
    'findOneAndUpdate',
    'geoHaystackSearch',
    'mapReduce',
    'replaceOne',
    'update',
    'updateOne',
    'updateMany',
];

const METHODS_WITH_THREE_PARAMS = [
    'findAndModify',
];

METHODS_WITH_ZERO_PARAMS.forEach(method => {
    const originalMethod = RawCollection.prototype[method];
    // some of listed methods could be deprecated
    if (typeof originalMethod === 'function') {
        RawCollection.prototype[method] = function (...args) {
            if (args.length > 2) {
                throw new Error(`Fatal error: expected maximum of 2 arguments for ${method} and got ${args.length}.`);
            }
            return originalMethod.call(this, ...getOptionsAndCallbackArgs(...args));
        };
    }
});

METHODS_WITH_ONE_PARAM.forEach(method => {
    const originalMethod = RawCollection.prototype[method];
    // some of listed methods could be deprecated
    if (typeof originalMethod === 'function') {
        RawCollection.prototype[method] = function (...args) {
            if (args.length > 3) {
                throw new Error(`Fatal error: expected maximum of 3 arguments for ${method} and got ${args.length}.`);
            }

            if (args.length === 0) {
                // case when the first argument is optional
                return originalMethod.call(this, undefined, getOptionsAndCallbackArgs([]));
            }
            const [first, ...other] = args;
            return originalMethod.call(this, first, ...getOptionsAndCallbackArgs(...other));
        };
    }
})

METHODS_WITH_TWO_PARAMS.forEach(method => {
    const originalMethod = RawCollection.prototype[method];
    // some of listed methods could be deprecated
    if (typeof originalMethod === 'function') {
        RawCollection.prototype[method] = function (...args) {
            if (args.length > 4) {
                throw new Error(`Fatal error: expected maximum of 4 arguments for ${method} and got ${args.length}.`);
            }

            if (args.length === 0) {
                // case when both arguments are optional
                return originalMethod.call(this, undefined, getOptionsAndCallbackArgs([]));
            }
            if (args.length === 1) {
                // case when second argument is optional
                const [first] = args;
                return originalMethod.call(this, first, undefined, getOptionsAndCallbackArgs([]));
            }
            const [first, second, ...other] = args;
            return originalMethod.call(this, first, second, ...getOptionsAndCallbackArgs(...other));
        };
    }
});

METHODS_WITH_THREE_PARAMS.forEach(method => {
    const originalMethod = RawCollection.prototype[method];
    // some of listed methods could be deprecated
    if (typeof originalMethod === 'function') {
        RawCollection.prototype[method] = function (...args) {
            if (args.length > 5) {
                throw new Error(`Fatal error: expected maximum of 5 arguments for ${method} and got ${args.length}.`);
            }

            const [first, second, third, ...other] = args;
            return originalMethod.call(this, first, second, third, ...getOptionsAndCallbackArgs(...other));
        };
    }
});

/**
 * Other:
 * find - no callback
 * initializeUnorderedBulkOp - no callback
 * listIndexes - no callback
 * watch - no callback
 * group - deprecated, 6 params + options + callback (8 at most)
 */

// special case for find
const originalFind = RawCollection.prototype.find;
RawCollection.prototype.find = function (query, options) {
    const context = sessionVariable.get();
    if (context) {
        return originalFind.call(this, query, {
            ...options,
            session: context.session,
        });
    }
    return originalFind.call(this, query, options);
};

function getClient(): MongoClient {
    const {client} = MongoInternals.defaultRemoteCollectionDriver().mongo;
    return client;
}

function createSession(options?: SessionOptions) {
    return getClient().startSession(options);
}

export interface RunInTransactionOptions {
    sessionOptions?: SessionOptions;
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
        Promise.await(session.withTransaction(() => {
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
            // withTransactionCallback must return promise, as per docs (3.6)
            return Promise.resolve(result);
        }, options.transactionOptions));
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
