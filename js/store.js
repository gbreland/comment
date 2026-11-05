const Store = (function () {
	const KEY = 'topicweb-v1';
	let data = null;

	function clone(v) {
		return JSON.parse(JSON.stringify(v));
	}

	function uid(prefix) {
		return prefix + '-' + Math.random().toString(36).slice(2, 10);
	}

	function persist() {
		localStorage.setItem(KEY, JSON.stringify(data));
	}

	async function load() {
		const raw = localStorage.getItem(KEY);
		if (raw) {
			try {
				data = JSON.parse(raw);
				if (data && data.post && Array.isArray(data.topics) && Array.isArray(data.comments)) {
					return data;
				}
			} catch (e) {}
		}
		const res = await fetch('data/thread.json', { cache: 'no-store' });
		data = await res.json();
		persist();
		return data;
	}

	function reset() {
		localStorage.removeItem(KEY);
		data = null;
	}

	function get() {
		return data;
	}

	function topics() {
		return data.topics.slice();
	}

	function clusters() {
		return data.clusters.slice();
	}

	function post() {
		return data.post;
	}

	function topic(id) {
		return data.topics.find(function (t) { return t.id === id; }) || null;
	}

	function comment(id) {
		return data.comments.find(function (c) { return c.id === id; }) || null;
	}

	function commentsFor(topicId) {
		return data.comments.filter(function (c) { return c.topicId === topicId; });
	}

	function children(parentId, topicId) {
		return data.comments.filter(function (c) {
			if (c.parentId !== parentId) {
				return false;
			}
			if (topicId && c.topicId !== topicId) {
				return false;
			}
			return true;
		}).sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
	}

	function pathTo(commentId) {
		const path = [];
		let c = comment(commentId);
		const guard = {};
		while (c && !guard[c.id]) {
			guard[c.id] = true;
			path.unshift(c);
			c = c.parentId ? comment(c.parentId) : null;
		}
		return path;
	}

	function descendantCount(id) {
		let n = 0;
		function walk(pid) {
			data.comments.forEach(function (c) {
				if (c.parentId === pid) {
					n += 1;
					walk(c.id);
				}
			});
		}
		walk(id);
		return n;
	}

	function replyCount(topicId) {
		return commentsFor(topicId).length;
	}

	function addTopic(fields) {
		const t = {
			id: uid('t'),
			title: fields.title,
			summary: fields.summary || '',
			description: fields.description || '',
			author: fields.author || 'u/you',
			pinned: false,
			cluster: fields.cluster || 'av',
			heat: 40,
			createdAt: new Date().toISOString(),
			body: fields.body
		};
		data.topics.push(t);
		persist();
		return t;
	}

	function addComment(fields) {
		const c = {
			id: uid('c'),
			topicId: fields.topicId,
			parentId: fields.parentId || null,
			author: fields.author || 'u/you',
			body: fields.body,
			createdAt: new Date().toISOString(),
			score: 1,
			related: fields.related || []
		};
		data.comments.push(c);
		const t = topic(c.topicId);
		if (t) {
			t.heat = Math.min(99, (t.heat || 0) + 1);
		}
		persist();
		return c;
	}

	function setRelated(commentId, related) {
		const c = comment(commentId);
		if (!c) {
			return;
		}
		c.related = related || [];
		persist();
	}

	function updateTopic(id, patch) {
		const t = topic(id);
		if (!t) {
			return;
		}
		Object.keys(patch).forEach(function (k) {
			t[k] = patch[k];
		});
		persist();
	}

	function resolveRelated(item) {
		if (!item || !item.id) {
			return null;
		}
		if (item.kind === 'topic' || topic(item.id)) {
			const t = topic(item.id);
			if (t) {
				return { kind: 'topic', topic: t, reason: item.reason || '' };
			}
		}
		const c = comment(item.id);
		if (c) {
			return { kind: 'comment', comment: c, topic: topic(c.topicId), reason: item.reason || '' };
		}
		const t = topic(item.id);
		if (t) {
			return { kind: 'topic', topic: t, reason: item.reason || '' };
		}
		return null;
	}

	function sampleComments(limit) {
		const list = data.comments.slice().sort(function (a, b) {
			return (b.score || 0) - (a.score || 0);
		});
		return list.slice(0, limit || 24);
	}

	return {
		clone: clone,
		uid: uid,
		load: load,
		reset: reset,
		get: get,
		topics: topics,
		clusters: clusters,
		post: post,
		topic: topic,
		comment: comment,
		commentsFor: commentsFor,
		children: children,
		pathTo: pathTo,
		descendantCount: descendantCount,
		replyCount: replyCount,
		addTopic: addTopic,
		addComment: addComment,
		setRelated: setRelated,
		updateTopic: updateTopic,
		resolveRelated: resolveRelated,
		sampleComments: sampleComments
	};
})();
