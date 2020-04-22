### PoC implementation of server side transactions

Implementation is based on using Meteor.EnvironmentVariable to store the MongoDB session and overrides in 
`MongoInternals.NpmModule.Collection` for each method that supports sessions.

### Usage

```
// server-side
import {runInTransaction} from 'meteor/bhunjadi:mongo-transactions';

const Invoice = new Mongo.Collection('invoice');
const LineItems = new Mongo.Collection('lineItems');
const Payments = new Mongo.Collection('payments');

function (invoice, lineItems) {
    runInTransaction(() => {
        Invoice.insert(invoice);
        LineItems.insert(lineItems);

        const payment = createPaymentDoc(); 
        Payments.insert(payment);
    });
}
```

### Exported methods/variables
```
runInTransaction<R>(fn: () => R, options?: any): R;
```

fn - method to be run in transaction  

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
