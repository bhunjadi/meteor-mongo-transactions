import {_} from 'meteor/underscore';
import {expect} from 'chai';
import {DDP} from 'meteor/ddp-client';

const USER_COUNT = 25;

function createConnection() {
    return DDP.connect(Meteor.connection._stream.rawUrl, Meteor.connection.options);
}

function callPromise(methodName, ...args) {
    return new Promise((resolve) => {
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
    })

    /**
     * Creating 'count' DDPConnections towards the server and execute them immediately.
     * Some clients fail and should not have their own invoices and invoice items.
     */
    async function insertWithDifferentClients(count) {
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
            const connection = createConnection();
            promises.push(callWithConnectionPromise(connection, 'insertInvoice', ...params).then(result => {
                return {
                    result,
                    clientId,
                };
            }).then(res => {
                connection.close(); 
                return res;
            }));
        });

        return Promise.all(promises);
    }

    it('inserts correctly', async function () {
        await insertWithDifferentClients(USER_COUNT);
        
        const invoices = await callPromise('findInvoices', {});
        const items = await callPromise('findInvoiceItems', {});

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
                expect(clientItems.length).to.be.gte(2);
            }
        }
    }).timeout(10000);
});
