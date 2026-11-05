const App = (function () {
	const ui = {
		cluster: 'all',
		query: '',
		sort: 'heat',
		topicId: 't-op',
		focusId: null,
		highlightId: null,
		compact: false,
		modal: null,
		replyTo: null,
		replyBody: '',
		busy: false,
		notice: '',
		form: { title: '', body: '', error: '', info: '' }
	};

	function esc(s) {
		return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
			return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
		});
	}

	function when(iso) {
		const t = new Date(iso).getTime();
		if (!t) {
			return '';
		}
		const days = Math.round((Date.now() - t) / 86400000);
		if (Math.abs(days) < 1) {
			const h = Math.max(1, Math.round((Date.now() - t) / 3600000));
			return h + 'h';
		}
		return Math.abs(days) + 'd';
	}

	function clusterLabel(id) {
		const c = Store.clusters().find(function (x) { return x.id === id; });
		return c ? c.label : id;
	}

	function filteredTopics() {
		let list = Store.topics();
		if (ui.cluster !== 'all') {
			list = list.filter(function (t) { return t.cluster === ui.cluster; });
		}
		if (ui.query.trim()) {
			const q = ui.query.trim().toLowerCase();
			list = list.filter(function (t) {
				return (t.title + ' ' + t.summary + ' ' + t.body).toLowerCase().indexOf(q) !== -1;
			});
		}
		list.sort(function (a, b) {
			if (a.pinned && !b.pinned) {
				return -1;
			}
			if (b.pinned && !a.pinned) {
				return 1;
			}
			if (ui.sort === 'new') {
				return String(b.createdAt).localeCompare(String(a.createdAt));
			}
			if (ui.sort === 'replies') {
				return Store.replyCount(b.id) - Store.replyCount(a.id);
			}
			return (b.heat || 0) - (a.heat || 0);
		});
		return list;
	}

	function relatedHtml(items) {
		if (!items || !items.length) {
			return '';
		}
		const chips = [];
		items.forEach(function (item) {
			const resolved = Store.resolveRelated(item);
			if (!resolved) {
				return;
			}
			if (resolved.kind === 'topic') {
				chips.push(
					'<button type="button" class="rel" data-act="jump-topic" data-id="' +
					esc(resolved.topic.id) + '" title="' + esc(resolved.reason) + '">topic: ' +
					esc(resolved.topic.title) + '</button>'
				);
			} else {
				const label = resolved.comment.body.slice(0, 42);
				chips.push(
					'<button type="button" class="rel" data-act="jump-comment" data-id="' +
					esc(resolved.comment.id) + '" title="' + esc(resolved.reason) + '">' +
					esc(label) + (resolved.comment.body.length > 42 ? '…' : '') + '</button>'
				);
			}
		});
		if (!chips.length) {
			return '';
		}
		return '<div class="related">' + chips.join('') + '</div>';
	}

	function commentHtml(c, opts) {
		opts = opts || {};
		const kids = Store.children(c.id, c.topicId);
		const deep = Store.descendantCount(c.id);
		const isReplyTarget = ui.replyTo === c.id;
		let kidsHtml = '';
		if (opts.showKids) {
			const nested = kids.map(function (k) {
				return commentHtml(k, { showKids: false, nested: true });
			}).join('');
			if (nested) {
				kidsHtml = '<div class="kids">' + nested + '</div>';
			}
		} else if (deep > 0) {
			kidsHtml = '<button type="button" class="linkish" data-act="branch" data-id="' + esc(c.id) +
				'">Open branch (' + deep + ')</button>';
		}
		const reply = isReplyTarget ? replyFormHtml(c.id) : '';
		const flash = ui.highlightId === c.id ? ' flash' : '';
		const rootClass = opts.root ? ' root-view' : '';
		return (
			'<article class="comment' + flash + rootClass + '" id="c-' + esc(c.id) + '">' +
				'<header><span class="who">' + esc(c.author) + '</span><span>' +
				esc(when(c.createdAt)) + '</span><span>+' + esc(c.score || 0) + '</span></header>' +
				'<div class="text">' + esc(c.body) + '</div>' +
				relatedHtml(c.related) +
				'<div class="topic-actions">' +
					'<button type="button" class="ghost" data-act="reply" data-id="' + esc(c.id) + '">Reply</button>' +
				'</div>' +
				reply + kidsHtml +
			'</article>'
		);
	}

	function replyFormHtml(parentId) {
		return (
			'<div class="reply-box">' +
				'<textarea id="reply-body" placeholder="Reply in this room. AI will try to link related comments.">' +
				esc(ui.replyBody) + '</textarea>' +
				'<div class="row-actions">' +
					'<button type="button" class="ghost" data-act="reply-cancel">Cancel</button>' +
					'<button type="button" class="primary" data-act="reply-send" data-id="' +
					esc(parentId || '') + '"' + (ui.busy ? ' disabled' : '') + '>' +
					(ui.busy ? 'Linking…' : 'Post reply') + '</button>' +
				'</div>' +
			'</div>'
		);
	}

	function renderPost() {
		const p = Store.post();
		document.getElementById('post').innerHTML =
			'<div class="meta"><span>' + esc(p.source) + '</span><span>' + esc(p.date) +
			'</span><span>' + esc(p.author) + '</span>' +
			'<a href="' + esc(p.sourceUrl) + '" target="_blank" rel="noopener">source</a></div>' +
			'<h1>' + esc(p.title) + '</h1>' +
			'<div class="body">' + esc(p.body) + '</div>' +
			'<div class="summary"><strong>Summary. </strong>' + esc(p.summary) + '</div>' +
			'<div class="tags">' + p.tags.map(function (t) {
				return '<span class="tag">' + esc(t) + '</span>';
			}).join('') + '</div>';
	}

	function renderBoard() {
		const topics = filteredTopics();
		const clusters = Store.clusters();
		const compact = ui.compact || topics.length > 12;
		const board = document.getElementById('board');
		board.className = 'board' + (compact ? ' compact' : '');
		const clusterBtns = ['<button type="button" class="filter' + (ui.cluster === 'all' ? ' on' : '') +
			'" data-act="cluster" data-id="all">All</button>'].concat(clusters.map(function (c) {
			return '<button type="button" class="filter' + (ui.cluster === c.id ? ' on' : '') +
				'" data-act="cluster" data-id="' + esc(c.id) + '">' + esc(c.label) + '</button>';
		}));
		const cards = topics.map(function (t) {
			const on = t.id === ui.topicId ? ' on' : '';
			const pin = t.pinned ? ' pinned' : '';
			return (
				'<button type="button" class="card' + on + pin + '" data-act="open-topic" data-id="' + esc(t.id) + '">' +
					(t.pinned ? '<span class="kicker">OP topic</span>' : '<span class="kicker">' +
						esc(clusterLabel(t.cluster)) + '</span>') +
					'<h3>' + esc(t.title) + '</h3>' +
					'<p>' + esc(t.summary) + '</p>' +
					'<div class="foot"><span>' + Store.replyCount(t.id) + ' replies</span><span>heat ' +
					esc(t.heat) + '</span></div>' +
				'</button>'
			);
		}).join('');
		const chips = topics.map(function (t) {
			const on = t.id === ui.topicId ? ' on' : '';
			const pin = t.pinned ? ' pinned' : '';
			return '<button type="button" class="chip' + on + pin + '" data-act="open-topic" data-id="' +
				esc(t.id) + '">' + esc(t.title) + ' · ' + Store.replyCount(t.id) + '</button>';
		}).join('');
		board.innerHTML =
			'<div class="board-head">' +
				'<h2>Topics</h2>' +
				'<input class="search" id="topic-search" placeholder="Search topics" value="' + esc(ui.query) + '">' +
				'<select id="topic-sort">' +
					'<option value="heat"' + (ui.sort === 'heat' ? ' selected' : '') + '>Heat</option>' +
					'<option value="replies"' + (ui.sort === 'replies' ? ' selected' : '') + '>Replies</option>' +
					'<option value="new"' + (ui.sort === 'new' ? ' selected' : '') + '>New</option>' +
				'</select>' +
				'<button type="button" class="ghost" data-act="toggle-board">' +
					(compact ? 'Cards' : 'Chips') + '</button>' +
				'<button type="button" class="primary" data-act="new-topic">New topic</button>' +
			'</div>' +
			'<div class="filters">' + clusterBtns.join('') + '</div>' +
			'<div class="cards">' + (cards || '<div class="empty">No topics match.</div>') + '</div>' +
			'<div class="chips">' + chips + '</div>';
	}

	function renderRoom() {
		const t = Store.topic(ui.topicId);
		const el = document.getElementById('room');
		if (!t) {
			el.innerHTML = '<div class="empty">Pick a topic.</div>';
			return;
		}
		const path = ui.focusId ? Store.pathTo(ui.focusId) : [];
		const crumb = ['<button type="button" class="linkish" data-act="open-topic" data-id="' +
			esc(t.id) + '">' + esc(t.title) + '</button>'];
		path.forEach(function (c, i) {
			const last = i === path.length - 1;
			const label = c.body.slice(0, 28) + (c.body.length > 28 ? '…' : '');
			if (last) {
				crumb.push('<span>' + esc(label) + '</span>');
			} else {
				crumb.push('<button type="button" class="linkish" data-act="branch" data-id="' +
					esc(c.id) + '">' + esc(label) + '</button>');
			}
		});
		let thread;
		if (ui.focusId) {
			const root = Store.comment(ui.focusId);
			thread = root ? commentHtml(root, { showKids: true, root: true }) :
				'<div class="empty">Missing comment.</div>';
		} else {
			const tops = Store.children(null, t.id);
			thread = tops.length
				? tops.map(function (c) { return commentHtml(c, { showKids: true }); }).join('')
				: '<div class="empty">No replies yet.</div>';
			if (ui.replyTo === 'topic') {
				thread += replyFormHtml('');
			}
		}
		el.innerHTML =
			'<div class="crumb"><span>Topics</span><span>/</span>' + crumb.join('<span>/</span>') + '</div>' +
			(ui.notice ? '<div class="notice">' + esc(ui.notice) + '</div>' : '') +
			'<div class="topic-head">' +
				'<h2>' + esc(t.title) + '</h2>' +
				'<div class="byline">' + esc(t.author) + ' · ' + esc(clusterLabel(t.cluster)) +
				' · ' + Store.replyCount(t.id) + ' replies</div>' +
				'<div class="lede">' + esc(t.body) + '</div>' +
				'<div class="summary"><strong>Summary. </strong>' + esc(t.summary) +
				(t.description ? '<div>' + esc(t.description) + '</div>' : '') + '</div>' +
			'</div>' +
			'<div class="topic-actions">' +
				'<button type="button" class="ghost" data-act="reply" data-id="topic">Reply to topic</button>' +
				'<button type="button" class="ghost" data-act="summarize"' + (ui.busy ? ' disabled' : '') +
				'>Update summary</button>' +
			'</div>' +
			'<div class="thread">' + thread + '</div>';
	}

	function renderModal() {
		const box = document.getElementById('modal');
		if (ui.modal !== 'topic') {
			box.innerHTML = '';
			return;
		}
		box.innerHTML =
			'<div class="modal-back" data-act="modal-close">' +
				'<div class="modal" data-act="modal-inner">' +
					'<h2>New top-level topic</h2>' +
					'<p class="hint">Need a distinct claim, not a reply. AI will merge you into an existing topic if this is a duplicate.</p>' +
					'<label for="new-title">Claim title</label>' +
					'<input id="new-title" type="text" maxlength="90" value="' + esc(ui.form.title) +
					'" placeholder="Short unique claim">' +
					'<label for="new-body">Argument</label>' +
					'<textarea id="new-body" placeholder="Why this needs its own room.">' +
					esc(ui.form.body) + '</textarea>' +
					(ui.form.error ? '<div class="err">' + esc(ui.form.error) + '</div>' : '') +
					(ui.form.info ? '<div class="okmsg">' + esc(ui.form.info) + '</div>' : '') +
					'<div class="row-actions">' +
						'<button type="button" class="ghost" data-act="modal-close">Cancel</button>' +
						'<button type="button" class="primary" data-act="topic-send"' +
						(ui.busy ? ' disabled' : '') + '>' + (ui.busy ? 'Checking…' : 'Submit topic') + '</button>' +
					'</div>' +
				'</div>' +
			'</div>';
	}

	function render() {
		const st = AI.getStatus();
		const pill = document.getElementById('ai-pill');
		if (st.configured) {
			pill.className = 'pill ok';
			pill.textContent = st.model || 'OpenAI';
		} else {
			pill.className = 'pill bad';
			pill.textContent = 'Add API key';
		}
		renderPost();
		renderBoard();
		renderRoom();
		renderModal();
		const search = document.getElementById('topic-search');
		if (search && document.activeElement !== search) {
			search.value = ui.query;
		}
		if (ui.highlightId) {
			const node = document.getElementById('c-' + ui.highlightId);
			if (node) {
				node.scrollIntoView({ block: 'center', behavior: 'smooth' });
			}
		}
	}

	function grabReplyDraft() {
		const ta = document.getElementById('reply-body');
		if (ta) {
			ui.replyBody = ta.value;
		}
	}

	function grabTopicDraft() {
		const title = document.getElementById('new-title');
		const body = document.getElementById('new-body');
		if (title) {
			ui.form.title = title.value;
		}
		if (body) {
			ui.form.body = body.value;
		}
	}

	function openTopic(id) {
		ui.topicId = id;
		ui.focusId = null;
		ui.highlightId = null;
		ui.replyTo = null;
		ui.replyBody = '';
		ui.notice = '';
		ui.compact = true;
		render();
	}

	function openBranch(id) {
		ui.focusId = id;
		ui.highlightId = id;
		ui.replyTo = null;
		ui.replyBody = '';
		const c = Store.comment(id);
		if (c) {
			ui.topicId = c.topicId;
		}
		ui.compact = true;
		render();
	}

	function jumpComment(id) {
		const c = Store.comment(id);
		if (!c) {
			return;
		}
		ui.topicId = c.topicId;
		const kidsDeep = Store.descendantCount(id);
		const parentDeep = c.parentId ? Store.descendantCount(c.parentId) : 0;
		if (c.parentId && parentDeep > 0 && Store.pathTo(id).length > 2) {
			ui.focusId = c.parentId;
		} else if (kidsDeep > 0 && c.parentId) {
			ui.focusId = c.id;
		} else {
			ui.focusId = null;
		}
		ui.highlightId = id;
		ui.compact = true;
		render();
	}

	async function sendReply(parentId) {
		grabReplyDraft();
		const body = ui.replyBody.trim();
		if (body.length < 8) {
			ui.notice = 'Reply is too short.';
			render();
			return;
		}
		ui.busy = true;
		render();
		const parent = parentId ? Store.comment(parentId) : null;
		const comment = Store.addComment({
			topicId: ui.topicId,
			parentId: parent ? parent.id : null,
			body: body
		});
		try {
			const linked = await AI.linkComment(body, ui.topicId);
			const related = (linked.related || []).slice();
			(linked.alsoSeeTopicIds || []).forEach(function (tid) {
				related.push({ id: tid, kind: 'topic', reason: 'Related topic' });
			});
			Store.setRelated(comment.id, related);
			ui.notice = related.length ? 'Posted. AI linked ' + related.length + ' related item(s).' : 'Posted.';
		} catch (e) {
			ui.notice = 'Posted without links. ' + (e.message === 'no_api_key'
				? 'Add your OpenAI key in includes/secrets.php.'
				: String(e.message || e));
		}
		ui.busy = false;
		ui.replyTo = null;
		ui.replyBody = '';
		ui.highlightId = comment.id;
		render();
	}

	async function sendTopic() {
		grabTopicDraft();
		const title = ui.form.title.trim();
		const body = ui.form.body.trim();
		ui.form.error = '';
		ui.form.info = '';
		if (title.length < 8 || body.length < 40) {
			ui.form.error = 'Need a claim title (8+ chars) and an argument (40+ chars).';
			render();
			return;
		}
		ui.busy = true;
		render();
		try {
			const result = await AI.validateTopic(title, body);
			if (result.decision === 'reject') {
				ui.form.error = result.reason || 'Rejected as a top-level topic.';
				ui.busy = false;
				render();
				return;
			}
			if (result.decision === 'merge' && result.similarTopicId) {
				const existing = Store.topic(result.similarTopicId);
				const posted = Store.addComment({
					topicId: result.similarTopicId,
					parentId: null,
					body: body
				});
				ui.modal = null;
				ui.busy = false;
				ui.form = { title: '', body: '', error: '', info: '' };
				ui.topicId = result.similarTopicId;
				ui.focusId = null;
				ui.highlightId = posted.id;
				ui.compact = true;
				ui.notice = 'Merged into “' + (existing ? existing.title : 'existing topic') +
					'”. ' + (result.reason || '');
				render();
				return;
			}
			const created = Store.addTopic({
				title: title,
				body: body,
				summary: result.summary || title,
				description: result.reason || '',
				cluster: result.cluster || (ui.cluster === 'all' ? 'av' : ui.cluster)
			});
			ui.modal = null;
			ui.busy = false;
			ui.form = { title: '', body: '', error: '', info: '' };
			openTopic(created.id);
			ui.notice = 'New topic accepted.';
			render();
		} catch (e) {
			ui.busy = false;
			ui.form.error = e.message === 'no_api_key'
				? 'Add your OpenAI key in includes/secrets.php.'
				: String(e.message || e);
			render();
		}
	}

	async function summarize() {
		ui.busy = true;
		render();
		try {
			const result = await AI.summarizeTopic(ui.topicId);
			Store.updateTopic(ui.topicId, {
				summary: result.summary || Store.topic(ui.topicId).summary,
				description: result.description || Store.topic(ui.topicId).description
			});
			ui.notice = 'Summary updated from the whole thread, not only the opener.';
		} catch (e) {
			ui.notice = e.message === 'no_api_key'
				? 'Add your OpenAI key in includes/secrets.php.'
				: String(e.message || e);
		}
		ui.busy = false;
		render();
	}

	function onClick(e) {
		const inner = e.target.closest('[data-act="modal-inner"]');
		const close = e.target.closest('[data-act="modal-close"]');
		if (close && !inner) {
			ui.modal = null;
			ui.form.error = '';
			render();
			return;
		}
		if (inner && e.target.closest('[data-act="modal-inner"]') === inner && !e.target.closest('[data-act]')) {
			return;
		}
		const el = e.target.closest('[data-act]');
		if (!el) {
			return;
		}
		const act = el.getAttribute('data-act');
		const id = el.getAttribute('data-id');
		if (act === 'modal-inner') {
			e.stopPropagation();
			return;
		}
		grabReplyDraft();
		grabTopicDraft();
		if (act === 'open-topic') {
			openTopic(id);
		} else if (act === 'cluster') {
			ui.cluster = id;
			render();
		} else if (act === 'toggle-board') {
			ui.compact = !ui.compact;
			render();
		} else if (act === 'new-topic') {
			ui.modal = 'topic';
			ui.form.error = '';
			ui.form.info = '';
			render();
		} else if (act === 'modal-close') {
			ui.modal = null;
			render();
		} else if (act === 'topic-send') {
			sendTopic();
		} else if (act === 'branch') {
			openBranch(id);
		} else if (act === 'jump-topic') {
			openTopic(id);
		} else if (act === 'jump-comment') {
			jumpComment(id);
		} else if (act === 'reply') {
			if (id === 'topic') {
				ui.focusId = null;
			}
			ui.replyTo = id;
			ui.replyBody = '';
			render();
			const ta = document.getElementById('reply-body');
			if (ta) {
				ta.focus();
			}
		} else if (act === 'reply-cancel') {
			ui.replyTo = null;
			ui.replyBody = '';
			render();
		} else if (act === 'reply-send') {
			sendReply(id);
		} else if (act === 'summarize') {
			summarize();
		} else if (act === 'reset') {
			if (confirm('Clear local changes and reload the seed thread?')) {
				Store.reset();
				location.reload();
			}
		}
	}

	function onInput(e) {
		if (e.target.id === 'topic-search') {
			ui.query = e.target.value;
			const start = e.target.selectionStart;
			renderBoard();
			const search = document.getElementById('topic-search');
			if (search) {
				search.focus();
				search.setSelectionRange(start, start);
			}
		} else if (e.target.id === 'new-title') {
			ui.form.title = e.target.value;
		} else if (e.target.id === 'new-body') {
			ui.form.body = e.target.value;
		} else if (e.target.id === 'reply-body') {
			ui.replyBody = e.target.value;
		}
	}

	function onChange(e) {
		if (e.target.id === 'topic-sort') {
			ui.sort = e.target.value;
			render();
		}
	}

	function onKey(e) {
		if (e.key === 'Escape' && ui.modal) {
			ui.modal = null;
			render();
		}
	}

	async function init() {
		document.addEventListener('click', onClick);
		document.addEventListener('input', onInput);
		document.addEventListener('change', onChange);
		document.addEventListener('keydown', onKey);
		await Store.load();
		await AI.refreshStatus();
		render();
	}

	return { init: init };
})();

document.addEventListener('DOMContentLoaded', App.init);
