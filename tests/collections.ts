export const Invoice = new Mongo.Collection<any>('invoice');
export const InvoiceItem = new Mongo.Collection<any>('invoice_item');

// the thing with transactions is that they do throw errors when collection does NOT exist
// example: BulkWriteError: Cannot create namespace meteor.invoice in multi-document transaction.

// this forces creationg of all collections OUTSIDE of transaction
[Invoice, InvoiceItem].forEach(collection => {
    collection.insert({});
});

Invoice.remove({});
InvoiceItem.remove({});
