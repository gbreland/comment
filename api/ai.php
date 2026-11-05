<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$secretsFile = __DIR__ . '/../includes/secrets.php';
if (!is_file($secretsFile)) {
	http_response_code(503);
	echo json_encode(array('error' => 'no_api_key'));
	exit;
}
require $secretsFile;

function ai_out($code, $data) {
	http_response_code($code);
	echo json_encode($data);
	exit;
}

function ai_key() {
	$key = trim((string)secrets::openaiKey);
	if ($key === '' || $key === 'CHANGE_ME') {
		return '';
	}
	return $key;
}

function ai_model() {
	$model = trim((string)secrets::openaiModel);
	return $model !== '' ? $model : 'gpt-4o-mini';
}

function ai_read_json() {
	$raw = file_get_contents('php://input');
	$in = json_decode($raw, true);
	return is_array($in) ? $in : null;
}

function ai_chat($system, $user) {
	$key = ai_key();
	if ($key === '') {
		return array('error' => 'no_api_key');
	}
	$body = array(
		'model' => ai_model(),
		'temperature' => 0.2,
		'response_format' => array('type' => 'json_object'),
		'messages' => array(
			array('role' => 'system', 'content' => $system),
			array('role' => 'user', 'content' => $user)
		)
	);
	$ch = curl_init('https://api.openai.com/v1/chat/completions');
	curl_setopt_array($ch, array(
		CURLOPT_RETURNTRANSFER => true,
		CURLOPT_POST => true,
		CURLOPT_HTTPHEADER => array(
			'Content-Type: application/json',
			'Authorization: Bearer '.$key
		),
		CURLOPT_POSTFIELDS => json_encode($body),
		CURLOPT_TIMEOUT => 45
	));
	$raw = curl_exec($ch);
	$errno = curl_errno($ch);
	$http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
	curl_close($ch);
	if ($errno || $raw === false) {
		return array('error' => 'upstream');
	}
	$decoded = json_decode($raw, true);
	if (!is_array($decoded) || $http >= 400) {
		$msg = 'upstream';
		if (is_array($decoded) && isset($decoded['error']['message'])) {
			$msg = (string)$decoded['error']['message'];
		}
		return array('error' => $msg, 'http' => $http);
	}
	$text = '';
	if (isset($decoded['choices'][0]['message']['content'])) {
		$text = (string)$decoded['choices'][0]['message']['content'];
	}
	$text = trim($text);
	if (preg_match('/^```(?:json)?\s*([\s\S]*?)\s*```$/', $text, $m)) {
		$text = trim($m[1]);
	}
	$json = json_decode($text, true);
	if (!is_array($json)) {
		return array('error' => 'bad_model_json');
	}
	return array('ok' => true, 'data' => $json);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
	$action = isset($_GET['action']) ? (string)$_GET['action'] : 'status';
	if ($action === 'status') {
		ai_out(200, array(
			'configured' => ai_key() !== '',
			'model' => ai_model()
		));
	}
	ai_out(400, array('error' => 'bad_action'));
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
	ai_out(405, array('error' => 'method'));
}

$in = ai_read_json();
if ($in === null) {
	ai_out(400, array('error' => 'bad_json'));
}

$action = isset($in['action']) ? (string)$in['action'] : '';
if (ai_key() === '') {
	ai_out(503, array('error' => 'no_api_key'));
}

if ($action === 'validateTopic') {
	$title = trim(isset($in['title']) ? (string)$in['title'] : '');
	$body = trim(isset($in['body']) ? (string)$in['body'] : '');
	$topics = isset($in['topics']) && is_array($in['topics']) ? $in['topics'] : array();
	if (strlen($title) < 8 || strlen($body) < 40) {
		ai_out(200, array(
			'decision' => 'reject',
			'reason' => 'Need a short claim title and a real argument. This is too thin for a new top-level topic.',
			'similarTopicId' => null,
			'summary' => ''
		));
	}
	$slim = array();
	foreach ($topics as $t) {
		if (!is_array($t)) {
			continue;
		}
		$slim[] = array(
			'id' => isset($t['id']) ? (string)$t['id'] : '',
			'title' => isset($t['title']) ? (string)$t['title'] : '',
			'summary' => isset($t['summary']) ? (string)$t['summary'] : ''
		);
	}
	$system = 'You gate new top-level topics on a comment board. '
		.'Reject thin, off-topic, joke-only, or empty claims. '
		.'Merge ONLY when the new title restates the same core claim as an existing topic. '
		.'Related is not the same as duplicate. Sharing a subject (manufacturing, Waymo, brakes) is not enough to merge. '
		.'Accept a substantial new thesis even if it could also be a reply. Battery packs, paint, labor, permits, insurance, and similar distinct theses should accept if no existing title already says that. '
		.'Return JSON keys: decision (accept|merge|reject), reason (short), similarTopicId (existing id or null), summary (one line if accept, else empty), cluster (one of av, mfg, safety, cost). '
		.'If merge, similarTopicId MUST be one of the provided topic ids.';
	$user = json_encode(array(
		'title' => $title,
		'body' => $body,
		'topics' => $slim
	));
	$res = ai_chat($system, $user);
	if (!isset($res['ok'])) {
		ai_out(502, $res);
	}
	$data = $res['data'];
	$decision = isset($data['decision']) ? strtolower(trim((string)$data['decision'])) : 'reject';
	if (!in_array($decision, array('accept', 'merge', 'reject'), true)) {
		$decision = 'reject';
	}
	$similar = isset($data['similarTopicId']) ? (string)$data['similarTopicId'] : '';
	$known = array();
	foreach ($slim as $t) {
		$known[$t['id']] = true;
	}
	if ($similar !== '' && !isset($known[$similar])) {
		$similar = '';
	}
	if ($decision === 'merge' && $similar === '') {
		$decision = 'reject';
	}
	$cluster = isset($data['cluster']) ? strtolower(trim((string)$data['cluster'])) : 'av';
	if (!in_array($cluster, array('av', 'mfg', 'safety', 'cost'), true)) {
		$cluster = 'av';
	}
	ai_out(200, array(
		'decision' => $decision,
		'reason' => isset($data['reason']) ? (string)$data['reason'] : '',
		'similarTopicId' => $similar !== '' ? $similar : null,
		'summary' => isset($data['summary']) ? (string)$data['summary'] : '',
		'cluster' => $cluster
	));
}

if ($action === 'linkComment') {
	$body = trim(isset($in['body']) ? (string)$in['body'] : '');
	$comments = isset($in['comments']) && is_array($in['comments']) ? $in['comments'] : array();
	$topics = isset($in['topics']) && is_array($in['topics']) ? $in['topics'] : array();
	$currentTopicId = isset($in['topicId']) ? (string)$in['topicId'] : '';
	$slimC = array();
	$knownC = array();
	foreach ($comments as $c) {
		if (!is_array($c) || !isset($c['id'])) {
			continue;
		}
		$id = (string)$c['id'];
		$knownC[$id] = true;
		$slimC[] = array(
			'id' => $id,
			'topicId' => isset($c['topicId']) ? (string)$c['topicId'] : '',
			'body' => isset($c['body']) ? substr((string)$c['body'], 0, 400) : ''
		);
	}
	$slimT = array();
	$knownT = array();
	foreach ($topics as $t) {
		if (!is_array($t) || !isset($t['id'])) {
			continue;
		}
		$id = (string)$t['id'];
		$knownT[$id] = true;
		$slimT[] = array(
			'id' => $id,
			'title' => isset($t['title']) ? (string)$t['title'] : '',
			'summary' => isset($t['summary']) ? (string)$t['summary'] : ''
		);
	}
	$system = 'You link a new comment into an existing comment web. '
		.'Return JSON keys: related (array of {id, reason}), alsoSeeTopicIds (array of topic ids). '
		.'Use only ids from the provided lists. Prefer 2-4 comment links. Prefer 0-2 topic links. '
		.'Do not link to the current topic. Skip weak matches.';
	$user = json_encode(array(
		'newComment' => $body,
		'currentTopicId' => $currentTopicId,
		'comments' => $slimC,
		'topics' => $slimT
	));
	$res = ai_chat($system, $user);
	if (!isset($res['ok'])) {
		ai_out(502, $res);
	}
	$data = $res['data'];
	$related = array();
	if (isset($data['related']) && is_array($data['related'])) {
		foreach ($data['related'] as $row) {
			if (!is_array($row) || !isset($row['id'])) {
				continue;
			}
			$id = (string)$row['id'];
			if (!isset($knownC[$id])) {
				continue;
			}
			$related[] = array(
				'id' => $id,
				'kind' => 'comment',
				'reason' => isset($row['reason']) ? (string)$row['reason'] : ''
			);
			if (count($related) >= 4) {
				break;
			}
		}
	}
	$topicsOut = array();
	if (isset($data['alsoSeeTopicIds']) && is_array($data['alsoSeeTopicIds'])) {
		foreach ($data['alsoSeeTopicIds'] as $id) {
			$id = (string)$id;
			if (!isset($knownT[$id]) || $id === $currentTopicId) {
				continue;
			}
			$topicsOut[] = $id;
			if (count($topicsOut) >= 2) {
				break;
			}
		}
	}
	ai_out(200, array(
		'related' => $related,
		'alsoSeeTopicIds' => $topicsOut
	));
}

if ($action === 'summarizeTopic') {
	$title = trim(isset($in['title']) ? (string)$in['title'] : '');
	$opener = trim(isset($in['body']) ? (string)$in['body'] : '');
	$comments = isset($in['comments']) && is_array($in['comments']) ? $in['comments'] : array();
	$slim = array();
	foreach ($comments as $c) {
		if (!is_array($c)) {
			continue;
		}
		$slim[] = isset($c['body']) ? substr((string)$c['body'], 0, 280) : '';
		if (count($slim) >= 24) {
			break;
		}
	}
	$system = 'Summarize a comment topic so a reader can judge it without reading the opener only. '
		.'The summary must reflect where the thread went, including later interesting turns. '
		.'Return JSON keys: summary (one line, max 140 chars), description (two short sentences).';
	$user = json_encode(array(
		'title' => $title,
		'opener' => $opener,
		'comments' => $slim
	));
	$res = ai_chat($system, $user);
	if (!isset($res['ok'])) {
		ai_out(502, $res);
	}
	$data = $res['data'];
	ai_out(200, array(
		'summary' => isset($data['summary']) ? (string)$data['summary'] : '',
		'description' => isset($data['description']) ? (string)$data['description'] : ''
	));
}

ai_out(400, array('error' => 'bad_action'));
