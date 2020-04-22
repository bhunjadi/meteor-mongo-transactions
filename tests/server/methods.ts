import {Invoice, InvoiceItem} from '../collections';
import {runInTransaction} from 'meteor/bhunjadi:mongo-transactions';
import {_} from 'meteor/underscore';

function throwError() {
    throw new Meteor.Error('failed');
}

function shouldFail(chance) {
    return Math.random() < chance;
}

Meteor.methods({
    resetDatabase() {
        Invoice.remove({});
        InvoiceItem.remove({});
    },
    insertInvoice(invoice, items, {fails}) {
        /**
         * If it should fail, failure can happen:
         * - after invoice insert
         * - after each item insert
         * 
         * This is to cover wider range of possibilities of errors
         */
        const numberOfInserts = 1 + items.length;
        const chance = 1 / numberOfInserts;

        function insert() {
            const id = Invoice.insert(invoice);

            if (fails && shouldFail(chance)) {
                // console.log('fail immediately');
                throwError();
            }

            const itemIds = items.map(item => {
                if (fails && shouldFail(chance)) {
                    // console.log('fail on item');
                    throwError();
                }

                return InvoiceItem.insert({
                    ...item,
                    invoiceId: id,
                });
            });

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

        return runInTransaction(() => {
            return insert();
        });
    },
    findInvoices(filters) {
        return Invoice.find(filters).fetch();
    },
    findInvoiceItems(filters) {
        return InvoiceItem.find(filters).fetch();
    }
});
