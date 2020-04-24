import {runInTransaction, isInTransaction} from 'meteor/bhunjadi:mongo-transactions';
import {expect} from 'chai';
import {Invoice, InvoiceItem} from '../collections';

describe('Server side testing', function () {
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

    describe('nested transactions', function () {
        it('throws on nested transactions', function () {
            expect(() => {
                runInTransaction(() => {
                    runInTransaction(() => {});
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

    describe.only('using rawCollection()', function () {
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

            // console.log('promise', promiseId);
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
});
