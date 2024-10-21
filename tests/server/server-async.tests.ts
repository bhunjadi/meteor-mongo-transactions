import {
  runInTransactionAsync as _runInTransactionAsync,
  isInTransaction,
} from 'meteor/bhunjadi:mongo-transactions';
import { expect } from 'chai';
// import EventEmitter from 'events';
import EventEmitter from 'eventemitter2';
import { Invoice, InvoiceItem, InvoiceLog } from '../collections';
import { waitFor } from '../test.utils';

[true, false].forEach((retry) => {
  const runInTransactionOptions = {
    retry,
  };

  async function runInTransaction(fn, options = {}) {
    return _runInTransactionAsync(fn, {
      ...options,
      ...runInTransactionOptions,
    });
  }

  describe(`[ASYNC] Server side testing. Transactions${retry ? ' with retry' : ' without retry'}`, function () {
    beforeEach(async () => {
      await Invoice.removeAsync({});
      await InvoiceItem.removeAsync({});
    });

    async function insert() {
      const invoiceId = await Invoice.insertAsync({
        total: 100,
      });

      const itemId = await InvoiceItem.insertAsync({
        total: 50,
        invoiceId,
      });
      return { invoiceId, itemId };
    }

    describe('insert', function () {
      it('inserts data in the DB', async function () {
        let expectedId = null;
        let itemId = null;
        const result = await runInTransaction(async () => {
          const { invoiceId, itemId: passedInItemId } = await insert();
          expectedId = invoiceId;
          itemId = passedInItemId;
          return invoiceId;
        });

        expect(result).to.be.equal(expectedId);

        const invoices = Invoice.find().fetch();
        const items = InvoiceItem.find().fetch();
        expect(invoices).to.be.eql([
          {
            _id: expectedId,
            total: 100,
          },
        ]);
        expect(items).to.be.eql([
          {
            _id: itemId,
            invoiceId: expectedId,
            total: 50,
          },
        ]);
      });

      it('does not insert anything when error is thrown from within the transaction', async function () {
        try {
          await runInTransaction(async () => {
            await insert();
            throw new Error('insert error');
          });
          expect.fail('Didnt fail with error');
        } catch (e) {
          expect(e.message).to.equal('insert error');
        }

        expect(await Invoice.find().countAsync()).to.be.equal(0);
        expect(await InvoiceItem.find().countAsync()).to.be.equal(0);
      });
    });

    describe('update', function () {
      let invoiceId;
      let itemId;

      beforeEach(async () => {
        invoiceId = await Invoice.insertAsync({
          total: 100,
        });

        itemId = await InvoiceItem.insertAsync({
          total: 50,
          invoiceId,
        });
      });

      async function update() {
        await Invoice.updateAsync(invoiceId, {
          $set: {
            total: 150,
          },
        });
        await InvoiceItem.updateAsync(itemId, {
          $set: {
            total: 100,
            quantity: 2,
          },
        });
      }

      it('updates and commits', async function () {
        await runInTransaction(async () => {
          await update();
        });

        const invoices = await Invoice.find().fetchAsync();
        const items = await InvoiceItem.find().fetchAsync();
        expect(invoices).to.be.eql([
          {
            _id: invoiceId,
            total: 150,
          },
        ]);
        expect(items).to.be.eql([
          {
            _id: itemId,
            invoiceId,
            total: 100,
            quantity: 2,
          },
        ]);
      });

      it('rollbacks update on error', async function () {
        try {
          await runInTransaction(async () => {
            await update();
            throw new Error('update error');
          });
          expect.fail('Should fail');
        } catch (e) {
          expect(e.message).to.equal('update error');
        }

        const invoices = Invoice.find().fetch();
        const items = InvoiceItem.find().fetch();
        expect(invoices).to.be.eql([
          {
            _id: invoiceId,
            total: 100,
          },
        ]);
        expect(items).to.be.eql([
          {
            _id: itemId,
            invoiceId,
            total: 50,
          },
        ]);
      });
    });

    describe('remove', async function () {
      beforeEach(async () => {
        await insert();
      });

      async function remove() {
        await Invoice.removeAsync({});
        await InvoiceItem.removeAsync({});
      }

      it('commits remove', async function () {
        await runInTransaction(async () => {
          await remove();
        });

        expect(await Invoice.find().countAsync()).to.be.equal(0);
        expect(await InvoiceItem.find().countAsync()).to.be.equal(0);
      });

      it('rollbacks remove', async function () {
        try {
          await runInTransaction(async () => {
            await remove();
            throw new Error('remove error');
          });
          expect.fail('should fail');
        } catch (e) {
          expect(e.message).to.equal('remove error');
        }

        expect(await Invoice.find().countAsync()).to.be.equal(1);
        expect(await InvoiceItem.find().countAsync()).to.be.equal(1);
      });
    });

    describe('using rawCollection()', function () {
      let insertWriteResult;
      let invoiceId;

      async function insert() {
        // TODO: insert() not working, see server.tests.ts for details
        insertWriteResult = await Invoice.rawCollection().insertOne({
          raw: true,
        });
        invoiceId = await Invoice.insertAsync({ raw: false });
      }

      it('inserts correctly', async function () {
        await runInTransaction(async () => {
          await insert();
        });

        expect(insertWriteResult.insertedId).to.be.an('object');

        const first = await Invoice.findOneAsync({ raw: true });
        const snd = await Invoice.findOneAsync({ raw: false });

        expect(first).to.be.an('object');
        expect(snd).to.be.an('object');
      });

      it('rollbacks both values', async function () {
        try {
          await runInTransaction(async () => {
            await insert();

            throw new Error('fail');
          });
          expect.fail('Rollback expected');
        } catch (e) {
          expect(e.message).to.equal('fail');
        }

        expect(await Invoice.find().countAsync()).to.be.equal(0);
      });
    });

    /**
     * Whether this should work and if this is in the scope of this package to solve is up for debate.
     */
    describe('using async callbacks', function () {
      it('callback is executed within transaction - insert', async function () {
        try {
          await runInTransaction(
            async () => {
              await Invoice.insertAsync({}, async () => {
                await InvoiceItem.insertAsync({});
              });
              throw new Error('fail');
            },
            {
              waitForCallbacks: true,
            },
          );

          expect.fail('Should fail');
        } catch (e) {
          expect(e.message).to.be.equal('fail');
        }

        expect(await Invoice.find().countAsync()).to.be.equal(0);
        expect(await InvoiceItem.find().countAsync()).to.be.equal(0);
      });

      it('callback is executed within transaction - update', async function () {
        await Invoice.insertAsync({ _id: '1' });

        try {
          await runInTransaction(
            async () => {
              await Invoice.updateAsync(
                '1',
                {
                  $set: {
                    amount: 500,
                  },
                },
                {},
                async () => {
                  await InvoiceItem.insertAsync({});
                },
              );
              throw new Error('fail');
            },
            {
              waitForCallbacks: true,
            },
          );
          expect.fail('Should fail');
        } catch (e) {
          expect(e.message).to.be.equal('fail');
        }

        const invoices = await Invoice.find().fetchAsync();
        expect(invoices.length).to.be.equal(1);
        expect(invoices[0].amount).to.be.undefined;
        expect(await InvoiceItem.find().countAsync()).to.be.equal(0);
      });

      it.skip('callback is executed within transaction and transaction succeeds', async function () {
        await runInTransaction(
          async () => {
            debugger;
            // TODO: Async callbacks are generally not supported in Meteor, i.e. cannot wait for
            // promise in runInTransaction because Promise is not returned.
            await Invoice.insertAsync({}, async () => {
              // Using some timeout so there is no chance for callback to be called before
              // runInTransaction would finish without waiting for it.
              await waitFor(100);
              await InvoiceItem.insertAsync({});
            });
          },
          {
            // Using false here would fail on InvoiceItem.find().count() test since runInTransaction would just
            // return after Invoice.insert().
            waitForCallbacks: true,
          },
        );

        expect(await Invoice.find().countAsync()).to.be.equal(1);
        expect(await InvoiceItem.find().countAsync()).to.be.equal(1);
      });

      /**
       * Another callbacks use case, but this time we throw an error in async callback.
       * This time, we are guaranteed to have incorrect results; both Invoice and InvoiceItem
       * will be written to DB.
       */
      // TODO: async callbacks
      it.skip('callback error should cause abort', function () {
        expect(() => {
          runInTransaction(
            () => {
              Invoice.insert({}, (err, res) => {
                InvoiceItem.insert({});
                throw new Error('fail');
              });
            },
            {
              waitForCallbacks: true,
              catchCallbackErrors: true,
            },
          );
        }).to.throw(/fail/);

        expect(Invoice.find().count()).to.be.equal(0);
        expect(InvoiceItem.find().count()).to.be.equal(0);
      });
    });

    describe('Event emitter', function () {
      it('is executed in transaction', async function () {
        const emitter = new EventEmitter();
        emitter.on('event', async () => {
          await Invoice.insertAsync({});
        });

        try {
          await runInTransaction(async () => {
            await emitter.emitAsync('event');
            throw new Error('fail');
          });
          expect.fail('Should fail');
        } catch (e) {
          expect(e.message).to.be.equal('fail');
        }

        expect(await Invoice.find().countAsync()).to.be.equal(0);
      });

      it('error in the event can abort transaction', async function () {
        const emitter = new EventEmitter();
        emitter.on('event', async () => {
          await Invoice.insertAsync({});
          throw new Error('fail');
        });

        try {
          await runInTransaction(async () => {
            await emitter.emitAsync('event');
          });
          expect.fail('Should fail');
        } catch (e) {
          expect(e.message).to.be.equal('fail');
        }

        expect(await Invoice.find().countAsync()).to.be.equal(0);
      });
    });

    describe('nested transactions', function () {
      it('throws on nested transactions', async function () {
        try {
          await runInTransaction(async () => {
            await runInTransaction(async () => {});
          });
          expect.fail('Should fail on nested transaction');
        } catch (e) {
          expect(e.message).to.match(/Nested transactions are not supported/);
        }
      });
    });

    describe('isInTransaction', function () {
      it('returns false by default', function () {
        expect(isInTransaction()).to.be.false;
      });

      it('returns true when inside the transaction', async function () {
        await runInTransaction(async () => {
          expect(isInTransaction()).to.be.true;
        });
      });
    });
  });
});
