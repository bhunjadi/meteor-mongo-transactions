import { Invoice, InvoiceItem } from '../collections';
import { runInTransactionAsync } from 'meteor/bhunjadi:mongo-transactions';

function throwError() {
  throw new Meteor.Error('failed');
}

function shouldFail(chance) {
  return Math.random() < chance;
}

Meteor.methods({
  async resetDatabase() {
    await Invoice.removeAsync({});
    await InvoiceItem.removeAsync({});
  },
  insertInvoice(invoice, items, { fails }) {
    this.unblock();
    /**
     * If it should fail, failure can happen:
     * - after invoice insert
     * - after each item insert
     *
     * This is to cover wider range of possibilities of errors
     */
    const numberOfInserts = 1 + items.length;
    const chance = 1 / numberOfInserts;

    async function insert() {
      const id = await Invoice.insertAsync(invoice);

      if (fails && shouldFail(chance)) {
        // console.log('fail immediately');
        throwError();
      }

      const itemIds: string[] = [];
      for (const item of items) {
        if (fails && shouldFail(chance)) {
          // console.log('fail on item');
          throwError();
        }

        const itemId = await InvoiceItem.insertAsync({
          ...item,
          invoiceId: id,
        });
        itemIds.push(itemId);
      }

      // last chance to fail
      if (fails) {
        // console.log('fail the end');
        throwError();
      }

      return {
        id,
        itemIds,
      };
    }

    return runInTransactionAsync(() => {
      return insert();
    });
  },
  findInvoices(filters) {
    return Invoice.find(filters).fetchAsync();
  },
  findInvoiceItems(filters) {
    return InvoiceItem.find(filters).fetchAsync();
  },

  // utility method for concurrency testing
  insertInvoiceNoTransaction(data) {
    return Invoice.insertAsync(data);
  },
  async updateInvoiceInTransaction({
    invoiceId,
    timeoutBefore,
    timeoutAfter,
    debug,
    id,
  }) {
    await runInTransactionAsync(
      async () => {
        debug &&
          console.log(
            `Transaction ${id} waiting before update ${timeoutBefore} ms`,
          );

        const invoice = await Invoice.findOneAsync(invoiceId)!;
        debug &&
          console.log(`Transaction ${id} read total of ${invoice.total}`);

        await Meteor._sleepForMs(timeoutBefore);
        debug && console.log(`Transaction ${id} updating`);

        await Invoice.updateAsync(invoiceId, {
          $set: {
            total: invoice.total + 50,
          },
        });

        debug &&
          console.log(
            `Transaction ${id} waiting after update ${timeoutAfter} ms`,
          );
        await Meteor._sleepForMs(timeoutAfter);
        debug && console.log(`Transaction ${id} done`);
      },
      {
        retry: true,
      },
    );
  },
});
