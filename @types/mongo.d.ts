import {Collection} from 'mongodb';

declare module 'meteor/mongo' {
    module MongoInternals {
        // const Connection: {
        //     _insert(collectionName: string, document: any, callback?: Function): void;
        // }
        const Connection: any;
    }    
}
