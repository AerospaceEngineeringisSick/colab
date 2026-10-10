// Background jobs with live step tracking. Jobs run in-process; state is persisted so the UI can poll.
// Secrets (generated passwords) are kept in memory only and handed out exactly once.

export function createJobs({ store, now = () => new Date().toISOString() }) {
  const secrets = new Map(); // jobId -> Record<string,string>

  // A restart kills in-flight work: don't leave jobs spinning forever.
  for (const j of store.all('jobs')) {
    if (j.status === 'queued' || j.status === 'running') {
      store.update('jobs', j.id, {
        status: 'failed',
        error: 'The server restarted while this job was running.',
        steps: j.steps.map((s) => (s.status === 'running' || s.status === 'pending' ? { ...s, status: s.status === 'running' ? 'failed' : 'skipped' } : s)),
        updatedAt: now(),
      });
    }
  }
  // Keep the store tidy: only the 200 newest jobs.
  const old = store.all('jobs').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(200);
  old.forEach((j) => store.remove('jobs', j.id));

  const patch = (id, p) => store.update('jobs', id, { ...p, updatedAt: now() });

  /**
   * start({ kind, steps: [{key,label}] }, worker) -> Job (returned immediately; worker runs in the background)
   * worker receives { step(key, fn), setStep(key, status, detail), secret(k, v), result(obj) }
   */
  function start({ kind, steps }, worker) {
    const job = store.insert('jobs', {
      kind, status: 'running', createdAt: now(), updatedAt: now(),
      steps: steps.map((s) => ({ key: s.key, label: s.label, status: 'pending' })),
    });
    const id = job.id;

    const setStep = (key, status, detail) => {
      const cur = store.get('jobs', id);
      patch(id, { steps: cur.steps.map((s) => (s.key === key ? { ...s, status, ...(detail ? { detail } : {}) } : s)) });
    };
    const api = {
      setStep,
      /** Run one step: marks running, awaits fn, marks done (fn may return a detail string) or failed (and rethrows). */
      async step(key, fn) {
        setStep(key, 'running');
        try {
          const detail = await fn();
          setStep(key, 'done', typeof detail === 'string' ? detail : undefined);
        } catch (e) {
          setStep(key, 'failed', e.message);
          throw e;
        }
      },
      secret(k, v) { secrets.set(id, { ...(secrets.get(id) || {}), [k]: v }); },
      result(r) { patch(id, { result: { ...(store.get('jobs', id).result || {}), ...r } }); },
    };

    queueMicrotask(async () => {
      try {
        await worker(api);
        const cur = store.get('jobs', id);
        patch(id, { status: 'done', steps: cur.steps.map((s) => (s.status === 'pending' ? { ...s, status: 'skipped' } : s)) });
      } catch (e) {
        const cur = store.get('jobs', id);
        if (!e.status) console.error(`[job ${id}]`, e);
        patch(id, { status: 'failed', error: e.message || 'Job failed', steps: cur.steps.map((s) => (s.status === 'pending' ? { ...s, status: 'skipped' } : s)) });
      }
    });
    return store.get('jobs', id);
  }

  return {
    start,
    /** Returns the job; includes `secrets` the first time a finished job is read, then forgets them. */
    get(id) {
      const job = store.get('jobs', id);
      if (!job) return undefined;
      if ((job.status === 'done' || job.status === 'failed') && secrets.has(id)) {
        const s = secrets.get(id);
        secrets.delete(id);
        return { ...job, secrets: s };
      }
      return job;
    },
  };
}
