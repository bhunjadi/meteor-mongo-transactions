## Implementation of server side transactions for Meteor

Implementation uses `Meteor.EnvironmentVariable` to store the MongoDB session and
`MongoInternals.NpmModule.Collection` for which it overrides each method that supports sessions and passes the session stored in `Meteor.EnvironmentVariable`.

This implementation is relying on **fibers** and expects Meteor server side sync code.

## Usage

If function passed to `runInTransaction` does not throw an error, the package will try to commit the transaction. Note that the commit itself might throw an error.

If an error is thrown inside the function passed to `runInTransaction`, transaction will be aborted and error thrown.

#### Simple example

```
// server-side
import {runInTransaction} from 'meteor/bhunjadi:mongo-transactions';

const Invoice = new Mongo.Collection('invoice');
const LineItems = new Mongo.Collection('lineItems');
const Payments = new Mongo.Collection('payments');

function (invoice, lineItems) {
    const paymentId = runInTransaction(() => {
        // sync code which uses fibers
        Invoice.insert(invoice);
        LineItems.insert(lineItems);

        const payment = createPaymentDoc(); 
        // You can return anything from this function
        return Payments.insert(payment);
    });
}
```

#### Handling errors

```
import {runInTransaction} from 'meteor/bhunjadi:mongo-transactions';

try {
    runInTransaction(() => {
        // do something within this transaction
        performDBWork();

        throw new Error('My error');
    });
}
catch (e) {
    // "e" is the same error thrown above
    // transaction is already aborted

    handleError(e);
}
```

## Caveats

### Using async callbacks might not work as expected

Consider this example:

```
runInTransaction(() => {
    Invoice.insert({}, () => {
        InvoiceItem.insert({});
    })
    throw new Error('fail');
});
```

Since the function threw the error at the end, we might expect that both `Invoice` and `InvoiceItem` will **not** be inserted into the database.

However, this code usually fails in with exception outside the main execution context (because we're using async functions):
- Exception in callback of async function: MongoError: Use of expired sessions is not permitted
- MongoError: Transaction N has been aborted.

Both of these mean the same, transaction has already been aborted and session is expired.


Consequently, throwing an error from the async function will not throw a "sync" error and won't abort transaction:

```
runInTransaction(() => {
    Invoice.insert({}, (err, res) => {
        InvoiceItem.insert({});
        throw new Error('fail');
    });

    // with or without it, transaction won't be aborted
    Meteor._sleepForMs(1000);
});
```

Setting any value in `Meteor._sleepForMs()` function won't work, either.

#### Explanation

There are some questions that might arise here:

1. Why does async function even get a session when we know it is executed after `runInTransaction` has exited?

    Behind the scenes, Meteor wraps the callback method with `Meteor.wrapAsync`, see [here](https://github.com/meteor/meteor/blob/42c5422ca42bd3b8a7156192448dc605daf5aa9d/packages/mongo/mongo_driver.js#L787).

    `Meteor.wrapAsync` uses `Meteor.bindEnvironment` to wrap the callback and use fibers.

    See the [comment](https://github.com/meteor/meteor/blob/42c5422ca42bd3b8a7156192448dc605daf5aa9d/packages/meteor/dynamics_nodejs.js#L84) for `bindEnvironment` function:

    > Meteor application code is always supposed to be run inside a 
     fiber. bindEnvironment ensures that the function it wraps is run from 
     inside a fiber and ensures it sees the values of Meteor **environment 
     variables that are set at the time bindEnvironment is called**.

     This means that our `sessionVariable` (which is instance of `Meteor.EnvironmentVariable`) returns the session that was part of `runInTransaction` function.

2. Why are you not checking if session has ended and depending on this send `session` object to mongo function?

    While this might work, it might yield unexpected results. If we'd do it like that, in the example above `InvoiceItem` document would be inserted and `Invoice` wouldn't, which might not be the desired outcome.

    Right now, I envisage we add a parameter to `runInTransaction` to define behaviour for async function and whether this packages should just ignore expired sessions.

#### Consequences

This won't work out of the box with async code or any other package that uses async code, for example `matb33:collection-hooks`.

#### Workarounds

For now it looks like you could try to delay the execution of `runInTransaction` with `Meteor._sleepForMs(n)`. `n` is a number in milliseconds that you expect for all async functions to take.

There is no workaround if you need an Error in async callback to abort the transaction.


### Exported methods/variables
```
runInTransaction<R>(fn: () => R, options?: RunInTransactionOptions): R;
```

fn - **sync** method to be run in transaction, promises are not supported (yet)

options - optional SessionOptions, https://mongodb.github.io/node-mongodb-native/3.6/api/global.html#SessionOptions


```
isInTransaction(): boolean;
```

Whether we already are in the transaction.

```
sessionVariable: Meteor.EnvironmentVariable
```
This is the actual `Meteor.EnvironmentVariable` instance used by the package.
You could get MongoDB's [ClientSession](https://mongodb.github.io/node-mongodb-native/3.6/api/ClientSession.html) instance with `sessionVariable.get()`.

It will return `undefined` if there is no session.

### Testing

```
cd test-app
meteor npm i
# using browser driver
TEST_BROWSER_DRIVER=puppeteer MONGO_URL= ROOT_URL=  meteor test-packages --port=3000 --driver-package meteortesting:mocha ../
```

### TODO

- Support promises in combination with fibers
