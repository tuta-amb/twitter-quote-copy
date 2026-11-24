# twitter-quote-copy

Userscript for X/Twitter that adds a quote-copy button to every post's action bar (left of the Grok button).

Clicking it copies the post as a blockquote, and on a permalink page (`/user/status/id`) it nests the thread above it, oldest ancestor deepest:

```
> > parent post
>
> selected post

<small>https://twitter.com/user/status/123...</small>
```

## Install

1. Install [Violentmonkey](https://violentmonkey.github.io/) or Tampermonkey.
2. Open the raw script: <https://raw.githubusercontent.com/tuta-amb/twitter-quote-copy/main/twitter-quote-copy.user.js> — the manager will offer to install it. Updates come from this URL automatically.
