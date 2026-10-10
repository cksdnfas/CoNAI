/**
 * On the stdio entry stdout carries JSON-RPC only: the app's console logging (config, migrations, services) goes to
 * stderr instead. Imported first by stdio.ts, before any module that logs while loading.
 */
for (const method of ['log', 'info', 'debug'] as const) console[method] = console.error;

export {};
