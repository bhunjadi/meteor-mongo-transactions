import {MongoInternals} from 'meteor/mongo';
import { SessionContext } from './types';

const RawCollection = MongoInternals.NpmModules.mongodb.module.Collection;
const Connection = MongoInternals.Connection;

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
    'options',
    'isCapped',
    'dropIndexes',
    'listIndexes',
    'indexInformation',
    'estimatedDocumentCount',
    'indexes',
    'stats',
    'initializeUnorderedBulkOp',
    'initializeOrderedBulkOp',
];

/**
 * aggregate, count, countDocuments - optional first param
 */
const METHODS_WITH_ONE_PARAM = [
    'insertOne',
    'insertMany',
    'bulkWrite',
    'deleteOne',
    'deleteMany',
    'rename',
    'findOne',
    'createIndex',
    'createIndexes',
    'dropIndex',
    'indexExists',
    'countDocuments',
    'findOneAndDelete',
    'aggregate',
    'watch',
    'insert',
    'remove',
    'count',
];

const METHODS_WITH_TWO_PARAMS = [
    'updateOne',
    'replaceOne',
    'updateMany',
    'distinct',
    'findOneAndReplace',
    'findOneAndUpdate',
    'mapReduce',
    'update',
];

const METHODS_WITH_THREE_PARAMS = [
    
];

/**
 * Other:
 * find - no callback
 * initializeUnorderedBulkOp - no callback
 * listIndexes - no callback
 * watch - no callback
 * group - deprecated, 6 params + options + callback (8 at most)
 */

export default function patchCollectionMethods(sessionVariable: Meteor.EnvironmentVariable<SessionContext | undefined>) {
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

    // special case for find since it receives not callbacks
    const originalFind = RawCollection.prototype.find;
    // @ts-ignore
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

    // METHODS_WITH_THREE_PARAMS.forEach(method => {
    //     const originalMethod = RawCollection.prototype[method];
    //     // some of listed methods could be deprecated
    //     if (typeof originalMethod === 'function') {
    //         RawCollection.prototype[method] = function (...args) {
    //             if (args.length > 5) {
    //                 throw new Error(`Fatal error: expected maximum of 5 arguments for ${method} and got ${args.length}.`);
    //             }

    //             const [first, second, third, ...other] = args;
    //             return originalMethod.call(this, first, second, third, ...getOptionsAndCallbackArgs(...other));
    //         };
    //     }
    // });


    // Callbacks on Meteor methods are handled differently after 2.6. They're not passed to the mongodb driver, but 
    // handled in mongo_driver.js directly because they are using promises now to wait for command to finish.
    ['_insert', '_remove'].forEach((method) => {
        const originalMethod = Connection.prototype[method];
        Connection.prototype[method] = function (...args) {
            if (typeof args[2] === 'function') {
                return originalMethod.call(this, args[0], args[1], wrapCallback(args[2]));
            }
            return originalMethod.call(this, ...args);
        };
    });
}

