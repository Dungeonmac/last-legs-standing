// Every /api/* request is handled by the router in src/server/app.js.
import { handle } from '../../src/server/app.js';

export const onRequest = ({ request, env }) => handle(request, env);
