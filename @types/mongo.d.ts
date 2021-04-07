import {Collection} from 'mongodb';

declare module 'meteor/mongo' {
    module MongoInternals {
        var NpmModule: {
            Collection: Collection & {
                prototype: Record<string, any>;
            };
        };
    }    
}
