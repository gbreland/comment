# Topic-web comment demo

Comment board that keeps top-level topics on screen as cards. Deep replies open as a focus branch so indent does not grow. AI links related comments into a web.

Talking point: Tesla Cybercab engineering deep dive. The demo is the comment system, not the article.

## Run

Apache already serves `/var/www/html/comment`.

1. Copy `includes/secrets.example.php` to `includes/secrets.php`.
2. Set `openaiKey` to your OpenAI key. Leave `openaiModel` as `gpt-4o-mini` unless you want another chat model.
3. Open `/comment/` in the browser.

Without a key you can still browse seed topics, rooms, branches, and related chips. New-topic checks and auto-link need the key.

## Try

- Scan topic cards under the post. You do not scroll a 200-reply tree to see other top-level claims.
- Open **Waymo is better**. Open a nested **Open branch**. Left margin resets. Breadcrumb keeps the path.
- Click a green related chip. It jumps to another comment or topic.
- **New topic**: a thin "lol" should reject. A restatement of Waymo should merge. A distinct claim should accept.
- **Update summary** rewrites the card from the whole thread, not only the opener.

Reset seed clears `localStorage`.
