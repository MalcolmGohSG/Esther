# theophilusbible.com — Lesson Generation Performance Audit

Scope: the FastAPI backend in `app/main.py` that powers the "Generate Lesson"
wizard (the site's "analysis" step). This document records what was found,
what was fixed in this branch, and what still needs a deployment-level
decision from the site owner. It also answers the standalone-app / local-AI
question at the end.

## Summary

The generation pipeline itself is cheap — string templating, a Hebrew
calendar calculation over ~24 date candidates, and a PowerPoint export. None
of that is CPU-heavy and none of it calls a language model. There is no AI
inference anywhere in this code path today. The "extremely long / often
unable to generate" symptom traced to two concrete bugs, not to the workload:

1. **The app could fail to start at all** on any fresh install or restart,
   because `requirements.txt` pins nothing and a plain `pip install` today
   pulls Pydantic 2.13, which removed the `Field(regex=...)` kwarg used in
   `LessonRequest`. Reproduced locally: `pip install -r requirements.txt`
   followed by importing `app.main` raised
   `PydanticUserError: 'regex' is removed. use 'pattern' instead` before a
   single request could be served.
2. **Every request blocked the entire server** for up to 5 seconds, because
   `search_etcbc()` used a synchronous `httpx.Client` call inside an
   `async def` route without offloading it to a thread. FastAPI/Uvicorn run
   one event loop; a blocking network call inside a coroutine freezes *all*
   connections on that worker, not just the one that made the call. Any
   second visitor arriving mid-request queued behind the first, so wait
   times scaled with concurrent traffic rather than staying flat.

Both are fixed in this branch. Details, verification, and the remaining
recommendations (which require an infra/hosting decision) are below.

## Root causes

### 1. Dependency drift breaks the app outright (Critical)

`requirements.txt` had no version pins:

```
fastapi
uvicorn
jinja2
httpx
python-pptx
convertdate
python-dateutil
pydantic
```

`app/main.py` declared:

```python
lesson_type: str = Field(regex="^(expository|topical|bible_study|personal)$")
```

Pydantic 2.x renamed `regex` to `pattern` and made the old kwarg a hard
error (not a deprecation warning). Any environment that installs fresh
dependencies — a redeploy, a new container build, a dyno restart, a CI run —
gets whatever is newest on PyPI (currently Pydantic 2.13.4) and the app dies
on import, before `uvicorn` can bind a socket. This is very likely the actual
explanation for "often unable to generate": it isn't timing out, it's
crash-looping or serving nothing on a subset of restarts/deploys, and looks
identical to "hung" from the browser.

**Fix applied:** pinned all dependencies to a tested-compatible set and
changed `regex=` to `pattern=`. Verified `app.main` imports cleanly and the
`/api/generate` endpoint returns `200` end-to-end against the pinned set.

### 2. Blocking I/O inside the async request handler (Critical)

```python
def search_etcbc(query: str, limit: int = 5) -> List[dict]:
    ...
    with httpx.Client(timeout=5.0) as client:
        response = client.get(url, params=params, headers=headers)
```

called from:

```python
@app.post("/api/generate", ...)
async def generate_lesson(payload: LessonRequest):
    ...
    github_sources = search_etcbc(github_query)
```

`httpx.Client` (sync) performs real blocking socket I/O. Calling it directly
from an `async def` handler — instead of via `httpx.AsyncClient`/`await` or
`run_in_threadpool` — stalls the single-threaded asyncio event loop for the
full round trip (up to the 5s timeout on failure). While that's happening,
Uvicorn cannot make progress on *any other connection*, including unrelated
users. With N concurrent "Generate" clicks, the Nth one waits behind
roughly N × (call latency), which is exactly the "extremely long" symptom
under any real traffic (e.g., several people prepping sermons the same
evening).

Compounding this: the call hits GitHub's **code search** API
unauthenticated, which is capped at ~10 requests/minute total (far stricter
than GitHub's general API limits, and shared across every visitor hitting
the site from the server's egress IP). Once traffic exceeds that, most calls
pay the full network round trip only to get rate-limited (403) and fall
back to local samples anyway — latency spent for no benefit, on top of the
serialization problem above. There was also no caching, so identical queries
(e.g., the same passage searched twice) re-paid this cost every time.

**Fix applied:**
- Converted `search_etcbc` to `async def` using `httpx.AsyncClient`, properly
  awaited from the route, so it no longer blocks the event loop.
- Cut the timeout from 5s to 2s.
- Added a 5-minute in-memory TTL cache keyed by query, so repeated/rate-limited
  lookups don't keep re-paying network latency.
- Verified with 8 concurrent requests: total wall time for all 8 was ~0.3s
  (previously would have been ~8× a single request's latency in the worst
  case). Single-request latency is now ~0.05–0.5s depending on cache state.

### 3. Remaining issues — need a deployment decision, not a code patch

These weren't fixed in this branch because they depend on how/where the app
is actually hosted (information not present in this repo):

- **Single worker process.** The README's run command
  (`uvicorn app.main:app --reload`) is a dev invocation with one worker.
  `--reload` should never run in production, and without `--workers N` (or a
  process manager like `gunicorn -k uvicorn.workers.UvicornWorker -w 4`),
  the whole site has exactly one process handling requests. Fixing bug #2
  removes the *blocking* penalty, but true concurrency still benefits from
  ≥2–4 workers behind a load balancer.
- **Generated files live on local disk with no cleanup.** `create_pptx()`
  writes every generated deck to `generated/` and nothing ever deletes them.
  On a small/ephemeral container this fills disk over time, which surfaces
  as write failures (another way to "fail to generate"). If the app ever
  runs on more than one instance, a `/api/pptx/{filename}` request can land
  on an instance that never wrote that file → 404 for the user who just
  generated it. Recommend either (a) a scheduled cleanup job plus sticky
  routing / shared volume if staying single-instance, or (b) generating the
  file in-memory and streaming it back / storing it in object storage (S3)
  if running multiple instances.
- **No end-to-end request timeout or user-visible failure state.** The
  frontend (`static/app.js`) sets the button to "Generating…" and simply
  `alert()`s on a thrown error; if the server hangs (as it did under bug #2),
  the user has no way to tell "still working" from "stuck" and no
  server-enforced cap exists to guarantee a bound on worst-case latency.
  Worth adding a client-side fetch timeout/AbortController and a server-side
  overall budget now that the one unbounded dependency (GitHub) is capped
  at 2s.

## What was changed in this branch

- `requirements.txt`: pinned `fastapi`, `uvicorn[standard]`, `jinja2`,
  `httpx`, `python-pptx`, `convertdate`, `python-dateutil`, `pydantic` to a
  tested-compatible set.
- `app/main.py`:
  - `Field(regex=...)` → `Field(pattern=...)` (Pydantic v2 compatible).
  - `search_etcbc` is now `async` and uses `httpx.AsyncClient`, awaited from
    `generate_lesson`.
  - Added a 5-minute TTL in-memory cache for GitHub search results, keyed by
    query.
  - Reduced the GitHub call timeout from 5s to 2s.

No behavior visible to the user changed (same response shape, same fallback
semantics) — this is a latency/reliability fix, not a feature change.

## Does a standalone app / App Store app fix this?

No, not on its own. Nothing in the current bottleneck is caused by "the
client is a website" or by heavy computation that only a native app could
handle faster — there's no on-device or on-server AI inference in this code
path at all; the "analysis" is template text filled in from a 3-entry local
sample dataset plus a date calculation. If you shipped this exact backend
behind a native iOS/macOS app instead of a browser, you'd inherit the same
crash-on-deploy and same request-serialization bug, because the bottleneck
lives in the server, not the client. An App Store app also adds real
recurring costs (review cycles, multi-platform maintenance, update latency)
that don't address any of the root causes above.

Where a fully local/offline client *would* genuinely help: if the goal is
"the lesson wizard should work with zero network dependency at all" (e.g.,
for use in low-connectivity settings), note that every part of today's
pipeline except the optional GitHub source list — the templating, the
Hebrew/Gregorian date correlation, the congregation JSON lookup, even the
PPTX export — is already fast enough to run entirely on-device in
milliseconds, no AI required. The simplest version of "a standalone app"
that would actually change the reliability story is one that bundles the
JSON sample data and does the templating locally, treating the GitHub
lookup as a nice-to-have that's dropped entirely offline. That's a product/
distribution decision, independent of the server bugs, which should be fixed
either way since the current site will hit them regardless of what clients exist.

## Is "a local AI" the fix?

Not for the current problem — there is no LLM call in the pipeline today,
so on-device inference wouldn't remove any bottleneck that exists right
now. It becomes relevant only if/when you decide the canned templates
(3 hardcoded samples) aren't enough and you want dynamically generated
exegetical content. At that point there's a real tradeoff, not a clear
winner:

- **Cloud LLM call from the existing server** (e.g., a small fast model like
  Claude Haiku) — least engineering effort, highest content quality, easy to
  update/improve over time, but adds per-request cost and a new network
  dependency (mitigate with the same async/timeout/caching discipline used
  in the fix above).
- **On-device small model** (e.g., Apple's on-device Foundation Models
  framework on iOS 18+, or a quantized 2–4B model via Core ML / llama.cpp) —
  gives true offline generation and no per-request cost, but: meaningfully
  lower quality than a frontier model for nuanced exegetical/theological
  writing, adds 1–4 GB to app size, needs a reasonably recent device for
  acceptable latency, and someone has to own prompt/fine-tune quality for
  theological accuracy — a higher bar than for generic on-device tasks.
- **Hybrid** — keep the current fast local templating as the guaranteed
  baseline (works offline, sub-second, no AI needed), and offer an optional
  "enrich with AI" step that calls a cloud model only when the user wants
  deeper content and has connectivity. This avoids forcing every user
  through a slow/uncertain path and matches what the app actually needs
  today.

**Recommendation:** ship the bug fixes in this branch first — they should
turn "extremely long / often fails" into consistently sub-second responses,
since nothing in the real pipeline is inherently slow. Only revisit
native-app or local-AI investment once you've decided you want (a) offline
capability or (b) richer, non-templated content; neither is required to fix
the reported problem.
