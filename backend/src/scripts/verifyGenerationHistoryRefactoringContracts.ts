import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildHistoryFilterClause } from '../repositories/history/historyQueryFilter';
import type { GenerationHistoryFilterOptions } from '../types/generationHistory';

function waitForTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function main() {
  const completeFilter = buildHistoryFilterClause({
    ids: [4, 9],
    service_type: 'codex',
    generation_status: 'processing',
    workflow_id: 3,
    queue_job_id: 12,
    requested_by_account_id: 7,
    requested_by_account_type: 'guest',
    server_id: 5,
  }, { tableAlias: 'gh' });

  assert.equal(
    completeFilter.sql,
    ' AND gh.id IN (?,?) AND gh.service_type = ? AND gh.generation_status = ? AND gh.workflow_id = ? AND gh.queue_job_id = ? AND gh.requested_by_account_id = ? AND gh.requested_by_account_type = ? AND gh.server_id = ?',
    'the shared history filter builder must preserve SQL predicate order',
  );
  assert.deepEqual(
    completeFilter.params,
    [4, 9, 'codex', 'processing', 3, 12, 7, 'guest', 5],
    'the shared history filter builder must preserve binding order',
  );

  const legacyPlainListFilter = buildHistoryFilterClause({ ids: [4, 9], service_type: 'codex' }, {
    includeIds: false,
  });
  assert.equal(
    legacyPlainListFilter.sql,
    ' AND service_type = ?',
    'the legacy plain-row list must deliberately preserve its historical ids-ignore behavior',
  );
  assert.deepEqual(legacyPlainListFilter.params, ['codex']);

  const tempBasePath = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-history-refactor-'));
  process.env.RUNTIME_BASE_PATH = tempBasePath;

  let closeUserSettingsDb: (() => void) | null = null;
  let closeMainDatabase: (() => void) | null = null;
  let unsubscribe: (() => void) | null = null;
  let httpServer: import('node:http').Server | null = null;

  try {
    const { ensureRuntimeDirectories } = await import('../config/runtimePaths');
    const mainDatabase = await import('../database/init');
    const userSettings = await import('../database/userSettingsDb');
    const apiGenerationDatabase = await import('../database/apiGenerationDb');
    const { HistoryQueryRepository } = await import('../repositories/history/HistoryQueryRepository');
    const {
      HistoryCommandService,
      overrideHistoryCommandSideEffectsForTests,
    } = await import('../services/historyCommandService');
    const {
      resetRuntimeEventBusForTests,
      subscribeToRuntimeEvents,
    } = await import('../services/runtime-events/runtimeEventBus');

    closeUserSettingsDb = userSettings.closeUserSettingsDb;
    closeMainDatabase = mainDatabase.closeDatabase;
    ensureRuntimeDirectories();
    await mainDatabase.initializeDatabase();
    userSettings.initializeUserSettingsDb();
    apiGenerationDatabase.initializeApiGenerationDb();

    resetRuntimeEventBusForTests();
    const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
    let createdEventObservedAfterWriteAndInvalidation = false;
    unsubscribe = subscribeToRuntimeEvents((event) => {
      events.push({ name: event.name, payload: event.payload as Record<string, unknown> });
      if (event.name === 'history.record.created') {
        const historyId = Number((event.payload as { history_id?: unknown }).history_id);
        createdEventObservedAfterWriteAndInvalidation = Boolean(HistoryQueryRepository.findById(historyId))
          && HistoryQueryRepository.getListCountCacheStats().invalidations > 0;
      }
    });

    HistoryQueryRepository.resetListCountCacheForTests();
    assert.equal(HistoryQueryRepository.countListRecords(), 0);
    assert.equal(HistoryQueryRepository.countListRecords(), 0);
    assert.deepEqual(
      HistoryQueryRepository.getListCountCacheStats(),
      { hits: 1, misses: 1, invalidations: 0, entries: 1, ttl_ms: 3000 },
      'history count cache behavior must remain observable after repository extraction',
    );

    const commandTrace: string[] = [];
    const observedTraceTable: Array<{ command: string; trace: string[] }> = [];
    let failPublish = false;
    const restoreSideEffects = overrideHistoryCommandSideEffectsForTests({
      invalidateCache: () => { commandTrace.push('cache'); },
      publishEvent: (_historyId, eventName) => {
        commandTrace.push(eventName);
        if (failPublish) {
          throw new Error('forced publish failure');
        }
      },
      requestRetention: () => { commandTrace.push('retention'); },
    });
    const captureTrace = <T>(command: string, expected: string[], run: () => T): T => {
      commandTrace.length = 0;
      const result = run();
      const trace = [...commandTrace];
      observedTraceTable.push({ command, trace });
      assert.deepEqual(trace, expected, `${command} side-effect trace changed`);
      return result;
    };

    try {
      const traceId = captureTrace('create', ['cache', 'history.record.created'], () => HistoryCommandService.create({
        service_type: 'codex',
        generation_status: 'pending',
        queue_job_id: 901,
      }));
      captureTrace('update(fields)', ['cache'], () => HistoryCommandService.update(traceId, { workflow_name: 'trace' }));
      captureTrace('update(no-op)', [], () => HistoryCommandService.update(traceId, { id: traceId }));
      captureTrace('update(status)', ['cache', 'history.record.status'], () => {
        HistoryCommandService.update(traceId, { generation_status: 'processing' });
      });
      captureTrace('update(terminal)', ['cache', 'history.record.status', 'retention'], () => {
        HistoryCommandService.update(traceId, { generation_status: 'completed' });
      });
      captureTrace('updateStatus(non-terminal)', ['cache', 'history.record.status'], () => {
        HistoryCommandService.updateStatus(traceId, 'processing');
      });
      captureTrace('updateStatus(terminal)', ['cache', 'history.record.status', 'retention'], () => {
        HistoryCommandService.updateStatus(traceId, 'completed');
      });
      captureTrace('updateImagePaths', ['cache', 'history.record.status'], () => {
        HistoryCommandService.updateImagePaths(traceId, { compositeHash: 'trace-hash' });
      });
      captureTrace('recordError', ['cache', 'history.record.status', 'retention'], () => {
        HistoryCommandService.recordError(traceId, 'trace failure');
      });

      const batchOne = HistoryCommandService.create({
        service_type: 'novelai', generation_status: 'pending', queue_job_id: 902,
      });
      const batchTwo = HistoryCommandService.create({
        service_type: 'novelai', generation_status: 'processing', queue_job_id: 903,
      });
      captureTrace(
        'recordErrorByQueueJobIds',
        ['cache', 'history.record.status', 'history.record.status', 'retention'],
        () => HistoryCommandService.recordErrorByQueueJobIds([902, 903, 903], 'batch trace failure'),
      );

      failPublish = true;
      captureTrace('publish failure isolation', ['cache', 'history.record.status', 'retention'], () => {
        HistoryCommandService.updateStatus(traceId, 'failed');
      });
      failPublish = false;
      assert.equal(
        HistoryQueryRepository.findById(traceId)?.generation_status,
        'failed',
        'a publish failure must not roll back the successful terminal write',
      );

      const deleteByHashId = HistoryCommandService.create({
        service_type: 'codex', generation_status: 'pending', composite_hash: 'delete-by-hash',
      });
      HistoryCommandService.updateImagePaths(deleteByHashId, { compositeHash: 'delete-by-hash' });
      const deleteManyOne = HistoryCommandService.create({ service_type: 'codex', generation_status: 'pending' });
      const deleteManyTwo = HistoryCommandService.create({ service_type: 'codex', generation_status: 'pending' });
      captureTrace('delete', ['cache'], () => HistoryCommandService.delete(traceId));
      captureTrace('deleteByCompositeHash', ['cache'], () => {
        assert.equal(HistoryCommandService.deleteByCompositeHash('delete-by-hash'), 1);
      });
      captureTrace('deleteMany', ['cache'], () => {
        assert.equal(HistoryCommandService.deleteMany([deleteManyOne, deleteManyTwo]), 2);
      });
      captureTrace('deleteMany(empty)', [], () => assert.equal(HistoryCommandService.deleteMany([]), 0));
      HistoryCommandService.deleteMany([batchOne, batchTwo, deleteByHashId]);
    } finally {
      restoreSideEffects();
    }
    assert.equal(observedTraceTable.length, 15, 'the command trace table must cover every write variant');
    apiGenerationDatabase.apiGenDb.prepare('DELETE FROM api_generation_history').run();
    HistoryQueryRepository.resetListCountCacheForTests();

    const ownerHistoryId = HistoryCommandService.create({
      service_type: 'codex',
      generation_status: 'pending',
      requested_by_account_id: 7,
      requested_by_account_type: 'guest',
      queue_job_id: 101,
      positive_prompt: 'owner row',
    });
    const otherHistoryId = HistoryCommandService.create({
      service_type: 'codex',
      generation_status: 'pending',
      requested_by_account_id: 9,
      requested_by_account_type: 'guest',
      queue_job_id: 102,
      positive_prompt: 'other row',
    });

    assert.equal(createdEventObservedAfterWriteAndInvalidation, true);
    assert.equal(events.filter((event) => event.name === 'history.record.created').length, 2);
    assert.deepEqual(
      HistoryQueryRepository.findAll({ requested_by_account_id: 7 }).map((row) => row.id),
      [ownerHistoryId],
      'account-scoped query filters must continue isolating guest history rows',
    );
    assert.equal(
      HistoryQueryRepository.findAll({ ids: [ownerHistoryId] }).length,
      2,
      'plain findAll must preserve the historical behavior that ignored ids',
    );
    assert.deepEqual(
      HistoryQueryRepository.findAllWithMetadata({ ids: [ownerHistoryId] }).map((row) => row.id),
      [ownerHistoryId],
      'metadata list ids filtering must remain active for media route owner-scope checks',
    );
    assert.equal(HistoryQueryRepository.findById(ownerHistoryId)?.id, ownerHistoryId);
    assert.notEqual(otherHistoryId, ownerHistoryId);

    const eventCountBeforeNonStatusUpdate = events.length;
    HistoryCommandService.update(ownerHistoryId, { workflow_name: 'renamed' });
    assert.equal(
      events.length,
      eventCountBeforeNonStatusUpdate,
      'non-status generic updates must not publish history status events',
    );

    HistoryCommandService.update(ownerHistoryId, { generation_status: 'processing' });
    HistoryCommandService.updateImagePaths(ownerHistoryId, { compositeHash: 'owner-hash' });
    HistoryCommandService.updateStatus(ownerHistoryId, 'completed');
    assert.deepEqual(
      events.slice(-3).map((event) => event.name),
      ['history.record.status', 'history.record.status', 'history.record.status'],
      'generic status, media-link, and explicit status writes must each publish',
    );
    assert.equal(
      events.at(-1)?.payload.generation_status,
      'completed',
      'status events must be built from the row after the write completes',
    );

    const batchPendingId = HistoryCommandService.create({
      service_type: 'novelai',
      generation_status: 'pending',
      queue_job_id: 201,
    });
    const batchProcessingId = HistoryCommandService.create({
      service_type: 'novelai',
      generation_status: 'processing',
      queue_job_id: 202,
    });
    const statusEventCountBeforeBatch = events.filter((event) => event.name === 'history.record.status').length;
    assert.equal(
      HistoryCommandService.recordErrorByQueueJobIds([201, 202, 202], 'queue recovery failed'),
      2,
    );
    assert.equal(HistoryQueryRepository.findById(batchPendingId)?.generation_status, 'failed');
    assert.equal(HistoryQueryRepository.findById(batchProcessingId)?.generation_status, 'failed');
    assert.equal(
      events.filter((event) => event.name === 'history.record.status').length - statusEventCountBeforeBatch,
      2,
      'batch queue recovery failures must publish once per affected history row',
    );

    const filterRecordIds = [
      HistoryCommandService.create({
        service_type: 'codex', generation_status: 'completed', requested_by_account_id: 7,
        requested_by_account_type: 'guest', queue_job_id: 301, server_id: 11,
      }),
      HistoryCommandService.create({
        service_type: 'codex', generation_status: 'failed', requested_by_account_id: 7,
        requested_by_account_type: 'guest', queue_job_id: 302, server_id: 12,
      }),
      HistoryCommandService.create({
        service_type: 'novelai', generation_status: 'completed', requested_by_account_id: 9,
        requested_by_account_type: 'guest', queue_job_id: 303, server_id: 11,
      }),
      HistoryCommandService.create({
        service_type: 'codex', generation_status: 'completed', requested_by_account_id: 7,
        requested_by_account_type: 'admin', queue_job_id: 304, server_id: 11,
      }),
    ];
    const filterCombinations: GenerationHistoryFilterOptions[] = [
      { service_type: 'codex', generation_status: 'completed' },
      {
        service_type: 'codex', generation_status: 'completed', requested_by_account_id: 7,
        requested_by_account_type: 'guest', server_id: 11,
      },
      { ids: [filterRecordIds[0], filterRecordIds[2]], generation_status: 'completed', server_id: 11 },
      { queue_job_id: 302, requested_by_account_id: 7, requested_by_account_type: 'guest' },
    ];
    for (const filters of filterCombinations) {
      const rows = HistoryQueryRepository.findAllWithMetadata(filters);
      const count = HistoryQueryRepository.countListRecords(filters);
      const stats = HistoryQueryRepository.getListStatistics(filters);
      assert.equal(rows.length, count, `list/count mismatch for ${JSON.stringify(filters)}`);
      assert.equal(stats.total, count, `statistics total mismatch for ${JSON.stringify(filters)}`);
      for (const serviceType of ['comfyui', 'novelai', 'codex'] as const) {
        assert.equal(
          stats[serviceType],
          rows.filter((row) => row.service_type === serviceType).length,
          `${serviceType} statistics mismatch for ${JSON.stringify(filters)}`,
        );
      }
      for (const status of ['completed', 'failed', 'pending', 'processing'] as const) {
        assert.equal(
          stats[status],
          rows.filter((row) => row.generation_status === status).length,
          `${status} statistics mismatch for ${JSON.stringify(filters)}`,
        );
      }
    }

    const mediaDb = mainDatabase.db;
    const mediaFolder = mediaDb.prepare('SELECT id FROM watched_folders ORDER BY id ASC LIMIT 1')
      .get() as { id: number };
    const insertMedia = mediaDb.prepare(`
      INSERT INTO media_metadata (
        composite_hash, width, height, postprocess_status, postprocess_completed_at
      ) VALUES (?, 96, 64, ?, ?)
    `);
    const insertMediaFile = mediaDb.prepare(`
      INSERT INTO image_files (
        composite_hash, file_type, original_file_path, folder_id,
        file_status, file_size, mime_type, scan_date
      ) VALUES (?, 'image', ?, ?, 'active', 100, 'image/png', CURRENT_TIMESTAMP)
    `);
    insertMedia.run('history-ready-hash', 'ready', new Date().toISOString());
    insertMedia.run('history-pending-hash', 'pending', null);
    insertMediaFile.run('history-ready-hash', path.join(tempBasePath, 'history-ready.png'), mediaFolder.id);
    insertMediaFile.run('history-pending-hash', path.join(tempBasePath, 'history-pending.png'), mediaFolder.id);
    const readyMediaHistoryId = HistoryCommandService.create({
      service_type: 'novelai', generation_status: 'completed', composite_hash: 'history-ready-hash',
      requested_by_account_id: 7, requested_by_account_type: 'guest',
    });
    const pendingMediaHistoryId = HistoryCommandService.create({
      service_type: 'novelai', generation_status: 'completed', composite_hash: 'history-pending-hash',
      requested_by_account_id: 7, requested_by_account_type: 'guest',
    });
    HistoryCommandService.updateImagePaths(readyMediaHistoryId, { compositeHash: 'history-ready-hash' });
    HistoryCommandService.updateImagePaths(pendingMediaHistoryId, { compositeHash: 'history-pending-hash' });
    assert.equal(
      HistoryQueryRepository.findByIdWithMetadata(readyMediaHistoryId)?.actual_composite_hash,
      'history-ready-hash',
      'ready media must project through history detail queries',
    );
    assert.equal(
      HistoryQueryRepository.findByIdWithMetadata(pendingMediaHistoryId)?.actual_composite_hash ?? null,
      null,
      'pending media must remain hidden from history detail projections',
    );

    const express = (await import('express')).default;
    const generationHistoryRouter = (await import('../routes/generation-history.routes')).default;
    const app = express();
    app.use((req, _res, next) => {
      const accountId = Number(req.header('x-test-account-id'));
      const accountType = req.header('x-test-account-type');
      Object.defineProperty(req, 'session', {
        configurable: true,
        value: {
          accountId: Number.isInteger(accountId) ? accountId : undefined,
          accountType: accountType === 'admin' || accountType === 'guest' ? accountType : undefined,
        },
      });
      next();
    });
    app.use('/api/generation-history', generationHistoryRouter);
    const listeningServer = await new Promise<import('node:http').Server>((resolve) => {
      const server = app.listen(0, '127.0.0.1', () => resolve(server));
    });
    httpServer = listeningServer;
    const address = listeningServer.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}/api/generation-history`;
    const guestHeaders = { 'x-test-account-id': '7', 'x-test-account-type': 'guest' };
    const otherGuestHeaders = { 'x-test-account-id': '9', 'x-test-account-type': 'guest' };

    const removedLegacyRoutes = [
      ['POST', `${baseUrl}/comfyui`],
      ['POST', `${baseUrl}/novelai`],
      ['POST', `${baseUrl}/${readyMediaHistoryId}/upload-image`],
      ['GET', `${baseUrl}/job/obsolete-job-id`],
    ] as const;
    for (const [method, url] of removedLegacyRoutes) {
      const response = await fetch(url, { method, headers: guestHeaders });
      assert.equal(response.status, 404, `${method} ${url} must stay removed after the queue/runtime-job migration`);
    }

    const ownerDetailResponse = await fetch(`${baseUrl}/${readyMediaHistoryId}`, { headers: guestHeaders });
    assert.equal(ownerDetailResponse.status, 200, 'an owner history detail request must return 200');
    const ownerDetail = await ownerDetailResponse.json() as { record: { actual_composite_hash?: string | null } };
    assert.equal(ownerDetail.record.actual_composite_hash, 'history-ready-hash');
    assert.equal(
      (await fetch(`${baseUrl}/${readyMediaHistoryId}`, { headers: otherGuestHeaders })).status,
      403,
      'a different guest history detail request must return 403',
    );

    const recentResponse = await fetch(`${baseUrl}/recent?limit=100`, { headers: guestHeaders });
    assert.equal(recentResponse.status, 200);
    const recentBody = await recentResponse.json() as {
      records: Array<{ requested_by_account_id?: number | null; requested_by_account_type?: string | null }>;
    };
    assert.ok(recentBody.records.length > 0);
    assert.ok(
      recentBody.records.some((row) => row.requested_by_account_id === 9 && row.requested_by_account_type === 'guest'),
      'recent history must preserve its historical global response scope',
    );

    const statisticsResponse = await fetch(`${baseUrl}/statistics`, { headers: guestHeaders });
    assert.equal(statisticsResponse.status, 200);
    const statisticsBody = await statisticsResponse.json() as { statistics: { total: number } };
    assert.equal(
      statisticsBody.statistics.total,
      HistoryQueryRepository.getListStatistics().total,
      'statistics must preserve its historical global response scope',
    );

    const workflowStatisticsResponse = await fetch(`${baseUrl}/workflow/31/statistics`, { headers: guestHeaders });
    assert.equal(workflowStatisticsResponse.status, 200);
    const workflowStatisticsBody = await workflowStatisticsResponse.json() as { statistics: { total: number } };
    assert.equal(
      workflowStatisticsBody.statistics.total,
      HistoryQueryRepository.getWorkflowListStatistics(31).total,
      'workflow statistics must preserve its historical global response scope',
    );

    await waitForTurn();
    await waitForTurn();

    const compatibilityModelPath = path.resolve(process.cwd(), 'src/models/GenerationHistory.ts');
    const legacyJobTrackerPath = path.resolve(process.cwd(), 'src/services/jobTracker.ts');
    const queueTypesSource = fs.readFileSync(path.resolve(process.cwd(), 'src/types/generationQueue.ts'), 'utf8');
    const historyTypesSource = fs.readFileSync(path.resolve(process.cwd(), 'src/types/generationHistory.ts'), 'utf8');
    assert.equal(
      fs.existsSync(compatibilityModelPath),
      false,
      'the unused GenerationHistory compatibility model must not be restored',
    );
    assert.equal(
      fs.existsSync(legacyJobTrackerPath),
      false,
      'the unused in-memory JobTracker must not be restored alongside the database-backed runtime job system',
    );
    assert.doesNotMatch(
      queueTypesSource,
      /models\/GenerationHistory/,
      'generation queue types must not recreate the GenerationHistory runtime-event import cycle',
    );
    assert.doesNotMatch(
      historyTypesSource,
      /models\/AuthAccount/,
      'generation history types must import account ownership types from a neutral types module',
    );

    console.log('✅ Generation history query/command refactoring contracts verified');
  } finally {
    unsubscribe?.();
    await waitForTurn();
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
    }
    closeUserSettingsDb?.();
    closeMainDatabase?.();
    fs.rmSync(tempBasePath, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('Generation history refactoring contract verification failed:', error);
  process.exit(1);
});
