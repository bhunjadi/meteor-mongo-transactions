import {_} from 'meteor/underscore';
import {expect} from 'chai';
import {DDP} from 'meteor/ddp-client';
import {InsertInvoiceResult} from "../types";

const USER_COUNT = 20;

function createConnection() {
    return DDP.connect(Meteor.connection._stream.rawUrl, Meteor.connection.options);
}

function callPromise<T = any>(methodName, ...args) {
    return new Promise<T>((resolve) => {
        Meteor.call(methodName, ...args, (err, res) => {
            if (err) {
                resolve(err);
            }
            else {
                resolve(res);
            }
        });
    });
}

function callWithConnectionPromise(connection, methodName, ...args) {
    return new Promise((resolve) => {
        connection.call(methodName, ...args, (err, res) => {
            if (err) {
                resolve(err);
            }
            else {
                resolve(res);
            }
        });
    });
}

function isFailingClient(clientId) {
    return clientId % 2 === 0;
}

describe('Client side testing', function () {
    beforeEach(async () => {
        await callPromise('resetDatabase');
    });

    /**
     * Creating 'count' DDPConnections towards the server and execute them immediately.
     * Some clients fail and should not have their own invoices and invoice items.
     */
    async function insertWithDifferentClients(count): Promise<{
        clientId: number;
        result: InsertInvoiceResult | Error
    }[]> {
        const connectionPool = _.times(count, () => createConnection());
        // connectionPool.forEach(connection => console.log(connection.status()));

        const promises = [];
        _.times(count, function (index) {
            const clientId = index + 1;
            const params = [{
                clientId,
            }, [{
                clientId,
            }, {
                clientId,
            }], {
                fails: isFailingClient(clientId),
            }];

            // each client gets its own connection
            const connection = connectionPool[index];
            promises.push(callWithConnectionPromise(connection, 'insertInvoice', ...params).then(result => {
                return {
                    result,
                    clientId,
                };
            }));
        });

        return Promise.all(promises).then(result => {
            connectionPool.forEach(connection => connection.close());
            return result;
        });
    }

    it('inserts correctly', async function () {
        const results = await insertWithDifferentClients(USER_COUNT);

        const invoices = await callPromise<any[]>('findInvoices', {});
        const items = await callPromise<any[]>('findInvoiceItems', {});

        for (var i = 0; i < USER_COUNT; ++i) {
            const clientId = i + 1;
            const clientInvoices = invoices.filter(inv => inv.clientId === clientId);
            const clientItems = items.filter(item => item.clientId === clientId);
            if (isFailingClient(clientId)) {
                // fail
                expect(clientInvoices).to.have.length(0);
                expect(clientItems).to.have.length(0);
            }
            else {
                expect(clientInvoices).to.have.length(1);
                expect(clientItems).to.have.length(2);

                const {result: {id, itemIds}} = results.find(r => r.clientId === clientId) as {result: InsertInvoiceResult};
                expect(_.pluck(clientInvoices, '_id')).to.be.eql([id]);
                expect(_.pluck(clientItems, '_id')).to.be.eql(itemIds);
            }
        }
    }).timeout(10000);

    async function runConcurrentTransactions(invoiceId) {
        const conn1 = createConnection();
        const conn2 = createConnection();

        /**
         * Creating scenario where first transaction updates the document, but does not finish.
         * Second transaction then tries to update the same doc (1st is still inside the transaction).
         * 
         * Steps:
         * 1. Transaction 1 starts
         * 2. Transaction 1 updates
         * 3. Transaction 2 starts
         * 4. Transaction 2 updates (this fails if using raw transactions)
         * 5. Transaction 2 ends
         * 6. Transaction 1 ends
         * 
         */
        return Promise.all([
            callWithConnectionPromise(conn1, 'updateInvoiceInTransaction', {
                invoiceId,
                timeoutBefore: 200,
                timeoutAfter: 2000,
                debug: false,
                id: 1,
            }),
            callWithConnectionPromise(conn2, 'updateInvoiceInTransaction', {
                invoiceId,
                timeoutBefore: 2000,
                timeoutAfter: 100,
                debug: false,
                id: 2,
            }),
        ]);
    }

    /**
     * If using startTransaction, commitTransaction and abortTransaction this should trigger WriteConflict error.
     */
    it('works concurrently', async function () {
        const invoiceId = await callPromise('insertInvoiceNoTransaction', {total: 50});
        const [res1, res2] = await runConcurrentTransactions(invoiceId);

        expect(res1).to.be.undefined;
        expect(res2).to.be.undefined;

        const invoices = await callPromise('findInvoices', {});
        expect(invoices).to.have.length(1);

        const [invoice] = invoices;
        expect(invoice.total).to.be.equal(150);
    }).timeout(10000);
});
