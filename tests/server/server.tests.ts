import {runInTransaction as _runInTransaction, isInTransaction} from 'meteor/bhunjadi:mongo-transactions';
import {expect} from 'chai';
import EventEmitter from 'events';
import {Invoice, InvoiceItem, InvoiceLog} from '../collections';

[true, false].forEach(retry => {
    const runInTransactionOptions = {
        retry,
    };

    function runInTransaction(fn, options = {}) {
        return _runInTransaction(fn, {
            ...options,
            ...runInTransactionOptions,
        });
    }

    describe(`Server side testing. Transactions${retry ? ' with retry' : ' without retry'}`, function () {
        beforeEach(() => {
            Invoice.remove({});
            InvoiceItem.remove({});
        });
    
        function insert() {
            const invoiceId = Invoice.insert({
                total: 100,
            });
    
            const itemId = InvoiceItem.insert({
                total: 50,
                invoiceId,
            });
            return {invoiceId, itemId};
        }
    
        describe('insert', function () {
            it('inserts data in the DB', function () {
                let expectedId = null;
                let itemId = null;
                const result = runInTransaction(() => {
                    const {invoiceId, itemId: passedInItemId} = insert();
                    expectedId = invoiceId;
                    itemId = passedInItemId;
                    return invoiceId;
                });
    
                expect(result).to.be.equal(expectedId);
    
                const invoices = Invoice.find().fetch();
                const items = InvoiceItem.find().fetch();
                expect(invoices).to.be.eql([{
                    _id: expectedId,
                    total: 100,
                }]);
                expect(items).to.be.eql([{
                    _id: itemId,
                    invoiceId: expectedId,
                    total: 50,
                }]);
            });
    
            it('does not insert anything when error is thrown from within the transaction', function () {
                expect(() => {
                    runInTransaction(() => {
                        insert();
                        throw new Error('insert error');
                    });
                }).to.throw(/insert error/);
    
                expect(Invoice.find().count()).to.be.equal(0);
                expect(InvoiceItem.find().count()).to.be.equal(0);
            });
        });
    
        describe('update', function () {
            let invoiceId;
            let itemId;
    
            beforeEach(() => {
                invoiceId = Invoice.insert({
                    total: 100,
                });
    
                itemId = InvoiceItem.insert({
                    total: 50,
                    invoiceId,
                });
            });
    
            function update() {
                Invoice.update(invoiceId, {
                    $set: {
                        total: 150,
                    },
                });
                InvoiceItem.update(itemId, {
                    $set: {
                        total: 100,
                        quantity: 2,
                    },
                });
            }
    
            it('updates and commits', function () {
                runInTransaction(() => {
                    update();
                });
    
                const invoices = Invoice.find().fetch();
                const items = InvoiceItem.find().fetch();
                expect(invoices).to.be.eql([{
                    _id: invoiceId,
                    total: 150,
                }]);
                expect(items).to.be.eql([{
                    _id: itemId,
                    invoiceId,
                    total: 100,
                    quantity: 2,
                }]);
            });
    
            it('rollbacks update on error', function () {
                expect(() => {
                    runInTransaction(() => {
                        update();
                        throw new Error('update error');
                    });
                }).to.throw(/update error/);
    
                const invoices = Invoice.find().fetch();
                const items = InvoiceItem.find().fetch();
                expect(invoices).to.be.eql([{
                    _id: invoiceId,
                    total: 100,
                }]);
                expect(items).to.be.eql([{
                    _id: itemId,
                    invoiceId,
                    total: 50,
                }]);
            });
        });
    
        describe('remove', function () {
            beforeEach(() => {
                insert();
            });
    
            function remove() {
                Invoice.remove({});
                InvoiceItem.remove({});
            }
    
            it('commits remove', function () {
                runInTransaction(() => {
                    remove();
                });
    
                expect(Invoice.find().count()).to.be.equal(0);
                expect(InvoiceItem.find().count()).to.be.equal(0);
            });
    
            it('rollbacks remove', function () {
                expect(() => {
                    runInTransaction(() => {
                        remove();
                        throw new Error('remove error');
                    });
                }).to.throw(/remove error/);
    
                expect(Invoice.find().count()).to.be.equal(1);
                expect(InvoiceItem.find().count()).to.be.equal(1);
            });
        });
    
        describe('using rawCollection()', function () {
            let insertWriteResult;
            let invoiceId;
    
            function insert() {
                insertWriteResult = Promise.await(Invoice.rawCollection().insert({raw: true}));
                invoiceId = Invoice.insert({raw: false});
            }
    
            it('inserts correctly', function () {
                runInTransaction(() => {
                    insert();
                });
    
                expect(insertWriteResult.insertedCount).to.be.equal(1);
    
                const first = Invoice.findOne({raw: true});
                const snd = Invoice.findOne({raw: false});
    
                expect(first).to.be.an('object');
                expect(snd).to.be.an('object');
            });
    
            it('rollbacks both values', function () {
                expect(() => {
                    runInTransaction(() => {
                        insert();
    
                        throw new Error('fail');
                    });
                }).to.throw();
    
                expect(Invoice.find().count()).to.be.equal(0);
            });
        });
    
        /**
         * Whether this should work and if this is in the scope of this package to solve is up for debate.
         */
        describe('using async callbacks', function () {
            it('callback is executed within transaction - insert', function () {
                expect(() => {
                    runInTransaction(() => {
                        Invoice.insert({}, () => {
                            InvoiceItem.insert({});
                        });
                        throw new Error('fail');
                    }, {
                        waitForCallbacks: true,
                    });
                }).to.throw(/fail/);
    
                expect(Invoice.find().count()).to.be.equal(0);
                expect(InvoiceItem.find().count()).to.be.equal(0);
            });

            it('callback is executed within transaction - update', function () {
                Invoice.insert({_id: '1'});

                expect(() => {
                    runInTransaction(() => {
                        Invoice.update('1', {
                            $set: {
                                amount: 500,
                            },
                        }, {}, () => {
                            InvoiceItem.insert({});
                        });
                        throw new Error('fail');
                    }, {
                        waitForCallbacks: true,
                    });
                }).to.throw(/fail/);
    
                const invoices = Invoice.find().fetch();
                expect(invoices.length).to.be.equal(1);
                expect(invoices[0].amount).to.be.undefined;
                expect(InvoiceItem.find().count()).to.be.equal(0);
            });

            it('callback is executed within transaction and transaction succeeds', function () {
                runInTransaction(() => {
                    Invoice.insert({}, () => {
                        // Using some timeout so there is no chance for callback to be called before
                        // runInTransaction would finish without waiting for it.
                        Meteor._sleepForMs(100);
                        InvoiceItem.insert({});
                    });
                }, {
                    // Using false here would fail on InvoiceItem.find().count() test since runInTransaction would just 
                    // return after Invoice.insert().
                    waitForCallbacks: true,
                });
    
                expect(Invoice.find().count()).to.be.equal(1);
                expect(InvoiceItem.find().count()).to.be.equal(1);
            });
    
            /**
             * Another callbacks use case, but this time we throw an error in async callback.
             * This time, we are guaranteed to have incorrect results; both Invoice and InvoiceItem
             * will be written to DB.
             */
            it('callback error should cause abort', function () {
                expect(() => {
                    runInTransaction(() => {
                        Invoice.insert({}, (err, res) => {
                            InvoiceItem.insert({});
                            throw new Error('fail');
                        });
                    }, {
                        waitForCallbacks: true,
                        catchCallbackErrors: true,
                    });
                }).to.throw(/fail/);
    
                expect(Invoice.find().count()).to.be.equal(0);
                expect(InvoiceItem.find().count()).to.be.equal(0);
            });
        });
    
        describe('Event emitter', function () {
            it('is executed in transaction', function () {
                const emitter = new EventEmitter();
                emitter.on('event', () => {
                    Invoice.insert({});
                });
    
                expect(() => {
                    runInTransaction(() => {
                        emitter.emit('event');
                        throw new Error('fail');
                    });
                }).to.throw();
    
                expect(Invoice.find().count()).to.be.equal(0);
            });
    
            it('error in the event can abort transaction', function () {
                const emitter = new EventEmitter();
                emitter.on('event', () => {
                    Invoice.insert({});
                    throw new Error('fail');
                });
    
                expect(() => {
                    runInTransaction(() => {
                        emitter.emit('event');
                    });
                }).to.throw();
    
                expect(Invoice.find().count()).to.be.equal(0);
            });
        });
    
        describe('nested transactions', function () {
            it('throws on nested transactions', function () {
                expect(() => {
                    runInTransaction(() => {
                        runInTransaction(() => {
                        });
                    });
                }).to.throw(/Nested transactions are not supported/);
            });
        });
    
        describe('isInTransaction', function () {
            it('returns false by default', function () {
                expect(isInTransaction()).to.be.false;
            });
    
            it('returns true when inside the transaction', function () {
                runInTransaction(() => {
                    expect(isInTransaction()).to.be.true;
                });
            });
        });
    });
});
