# AGENTS.md

## Cursor Cloud specific instructions

### Overview

ETCBC Lesson Designer — a single FastAPI web application (Python backend, vanilla HTML/CSS/JS frontend). No database, no Docker, no external services required. See `README.md` for project structure and getting-started commands.

### Running the dev server

```bash
export PATH="$HOME/.local/bin:$PATH"
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The app is served at `http://localhost:8000`.

### Key caveats

- **Pydantic v1 required:** The codebase uses `Field(regex=...)` which is Pydantic v1 syntax. The unpinned `requirements.txt` will pull Pydantic v2 by default, which breaks at import time. The update script pins `pydantic<2` and `fastapi<0.100.0` (last FastAPI version supporting Pydantic v1).
- **PATH for pip-installed scripts:** `uvicorn` and `fastapi` CLIs install to `~/.local/bin` which may not be on PATH. Prefix commands with `export PATH="$HOME/.local/bin:$PATH"` or use `python3 -m uvicorn ...`.
- **No linter or test suite configured.** Use `python3 -m py_compile app/main.py` for a basic syntax check.
- **GitHub API fallback:** The app calls `api.github.com` for ETCBC source references. If rate-limited or unreachable, it falls back to local data in `app/data/etcbc_samples.json` — no secrets needed.
- **Generated files:** PowerPoint output goes to a `generated/` directory (created automatically on first use).
