const AI = (function () {
	let status = { configured: false, model: 'gpt-4o-mini' };

	async function refreshStatus() {
		try {
			const res = await fetch('api/ai.php?action=status', { cache: 'no-store' });
			status = await res.json();
		} catch (e) {
			status = { configured: false, model: '', error: 'status_failed' };
		}
		return status;
	}

	function getStatus() {
		return status;
	}

	async function post(payload) {
		const res = await fetch('api/ai.php', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		const data = await res.json().catch(function () { return { error: 'bad_response' }; });
		if (!res.ok) {
			const err = new Error(data.error || 'ai_failed');
			err.payload = data;
			throw err;
		}
		return data;
	}

	function topicSlim() {
		return Store.topics().map(function (t) {
			return { id: t.id, title: t.title, summary: t.summary };
		});
	}

	async function validateTopic(title, body) {
		return post({
			action: 'validateTopic',
			title: title,
			body: body,
			topics: topicSlim()
		});
	}

	async function linkComment(body, topicId) {
		const comments = Store.sampleComments(28).map(function (c) {
			return { id: c.id, topicId: c.topicId, body: c.body };
		});
		return post({
			action: 'linkComment',
			body: body,
			topicId: topicId,
			comments: comments,
			topics: topicSlim()
		});
	}

	async function summarizeTopic(topicId) {
		const t = Store.topic(topicId);
		const comments = Store.commentsFor(topicId).map(function (c) {
			return { body: c.body };
		});
		return post({
			action: 'summarizeTopic',
			title: t ? t.title : '',
			body: t ? t.body : '',
			comments: comments
		});
	}

	return {
		refreshStatus: refreshStatus,
		getStatus: getStatus,
		validateTopic: validateTopic,
		linkComment: linkComment,
		summarizeTopic: summarizeTopic
	};
})();
