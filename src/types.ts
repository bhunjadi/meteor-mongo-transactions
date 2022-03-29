
import type {ClientSession} from 'mongodb';

export interface SessionContext {
    session: ClientSession;
    catchCallbackErrors: boolean;

    callbackCount: number;
    callbackErrors: unknown[];
    resolveCallbacks();
}
