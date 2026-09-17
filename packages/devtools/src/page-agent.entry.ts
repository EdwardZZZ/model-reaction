/**
 * Injected entry for the page agent. The content script adds this file to the
 * page at `document_start` (MAIN world) so the global hook is installed before
 * the app's first `createModel` call.
 */
import { installAgent } from './page-agent';

installAgent(window);
