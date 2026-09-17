import { MixedPracticeError, mixedTutorRequest } from './mixed-practice.js';

// Small HTTP adapter. The service owns all questions, keys, assistance flags,
// submitted choices, and topic evidence. The client supplies identifiers only.
export function createMixedPracticeApi({ service, readBody, sendJson, complete, isConfigured, recordAttempt }) {
  return async function handleMixedPractice(req, res, url) {
    const profileId = url.searchParams.get('profile') || 'learner';
    if (!/^[a-z0-9-]{1,55}$/.test(profileId)) return sendJson(res, 400, { error: 'Choose a valid learner workspace.', code: 'INVALID_PROFILE' });
    const path = url.pathname.slice('/api/mixed/'.length);
    try {
      if (path === 'topics' && req.method === 'GET') return sendJson(res, 200, { topics: service.topics(), version: 1 });
      if (path === 'session' && req.method === 'GET') return sendJson(res, 200, service.restore(profileId, url.searchParams.get('sessionId')));
      if (path === 'session' && req.method === 'DELETE') return sendJson(res, 200, service.close(profileId, url.searchParams.get('sessionId')));
      if (!['session', 'topics', 'next', 'answer', 'hint', 'tutor', 'assisted'].includes(path)) return sendJson(res, 404, { error: 'Unknown mixed-practice endpoint.' });
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST for this mixed-practice action.' });
      let body;
      try { body = JSON.parse(await readBody(req, 40_000)); } catch { return sendJson(res, 400, { error: 'The request must contain valid JSON.' }); }
      if (!body || Array.isArray(body) || typeof body !== 'object') return sendJson(res, 400, { error: 'The request must be a JSON object.' });
      const { sessionId, questionId } = body;
      const persistAttempt = async () => {
        if (!recordAttempt) return {};
        const evidence = service.attemptEvidence(profileId, sessionId, questionId);
        if (!evidence) return {};
        try { await recordAttempt({profileId,evidence}); return {historySaved:true}; }
        catch { return {historySaved:false,historyNotice:'Your answer is checked, but it could not be saved to long-term practice history. The current session still has it. Check the same answer again to retry saving.'}; }
      };
      if (path === 'session') return sendJson(res, 201, service.create(profileId, { topicIds: body.topicIds, difficulty: body.difficulty, requestId: body.requestId }));
      if (path === 'topics') return sendJson(res, 200, service.updateTopics(profileId, sessionId, body.topicIds));
      if (path === 'next') return sendJson(res, 200, service.next(profileId, sessionId, {mode:body.mode}));
      if (path === 'answer') { const result=service.answer(profileId, sessionId, questionId, body.answerIndex); return sendJson(res,200,{...result,...await persistAttempt()}); }
      if (path === 'hint') { const result=service.hint(profileId, sessionId, questionId); return sendJson(res,200,{...result,...await persistAttempt()}); }
      if (path === 'assisted') { const result=service.tutorReceived(profileId, sessionId, questionId, true); return sendJson(res,200,{...result,...await persistAttempt()}); }
      const context = service.tutorContext(profileId, sessionId, questionId);
      if (!isConfigured()) return sendJson(res, 200, { available: false, assisted: context.assisted,
        text: 'The AI coach is unavailable on this server. The built-in hints and checked solution remain available.' });
      const response = await complete(mixedTutorRequest(context, { followUp: body.followUp, transcript: body.transcript }), req, res);
      // A known closed connection means the learner canceled or left before
      // this explanation could be delivered. Do not count that as help.
      if (res.destroyed || res.writableEnded) return;
      // The session is checked again after the request; an expired or closed
      // session cannot receive a late answer or regain independent credit.
      service.tutorContext(profileId, sessionId, questionId);
      if (response.refusal) return sendJson(res, 200, { available: true, questionId, refusal: true, assisted: context.assisted,
        text: 'The coach could not help with that request. Ask about a concept or a step in this problem.', model: response.model, fallback: response.fallback });
      if (!response.text) return sendJson(res, 502, { error: 'The coach could not be reached. Try a built-in hint or retry.', code: 'COACH_UNAVAILABLE' });
      const evidence = service.tutorReceived(profileId, sessionId, questionId, context.beforeAnswer);
      const history = await persistAttempt();
      return sendJson(res, 200, { available: true, questionId, phase: context.beforeAnswer ? 'before-answer' : 'after-answer', ...evidence,...history,
        text: response.text + (response.truncated ? '\n\nThis reply reached its length limit. Ask a narrower follow-up to continue.' : ''),
        model: response.model, fallback: response.fallback, recordReads: response.recordReads || [] });
    } catch (error) {
      if (error instanceof MixedPracticeError) return sendJson(res, error.status, { error: error.message, code: error.code });
      return sendJson(res, 500, { error: 'The mixed-practice request could not be completed.', code: 'MIXED_REQUEST_FAILED' });
    }
  };
}
