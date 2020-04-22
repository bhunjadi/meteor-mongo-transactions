import {MongoInternals} from 'meteor/mongo';

/**
 * Ideas from:
 * https://forums.meteor.com/t/solved-transactions-with-mongodb-meteor-methods/48677
 *
 * Mongo native driver docs (Collection related):
 * https://mongodb.github.io/node-mongodb-native/3.6/api/Collection.html
 */

export const sessionVariable = new Meteor.EnvironmentVariable();

/**
 * Function that adds session (if necessary) to options and callback method arguments.
 */
function getOptionsAndCallbackArgs(...args) {
    const session = sessionVariable.get();
    if (!session) {
        return args;
    }

    // nothing is passed here
    if (args.length === 0) {
        return [{session}];
    }

    if (args.length === 1) {
        const [optionsOrCallback] = args;
        if (typeof optionsOrCallback === 'function') {
            return [{session}, optionsOrCallback];
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
    }, callback];
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
    const session = sessionVariable.get();
    if (session) {
        return originalFind.call(this, query, {
            ...options,
            session,
        });
    }
    return originalFind.call(this, query, options);
};

function createSession(options) {
    const {client} = MongoInternals.defaultRemoteCollectionDriver().mongo;
    return Promise.await(client.startSession(options));
}

export function runInTransaction<R>(fn: () => R, options?: any): R {
    if (sessionVariable.get()) {
        throw new Error('Nested transactions are not supported');
    }

    const session = createSession(options);
    let result;
    sessionVariable.withValue(session, function () {
        const session = sessionVariable.get();
        Promise.await(session.startTransaction());
        try {
            result = fn();
            Promise.await(session.commitTransaction());
        }
        catch (e) {
            Promise.await(session.abortTransaction());
            throw e;
        }
        finally {
            session.endSession();
        }
    });

    return result;
}

export function isInTransaction(): boolean {
    const session = sessionVariable.get();
    return session?.inTransaction() ?? false;
}
