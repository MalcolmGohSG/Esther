# ETCBC Lesson Designer

A FastAPI-based web application that curates sermons, Bible studies, and one-to-one discipleship lessons rooted in the ETCBC
linguistic database.

## Features

- Guided wizard to capture audience, occasion, date, topic or passage, lesson type, and presentation duration.
- Automatic correlation of the selected date with the Jewish (Hebrew) calendar and congregation-specific milestones.
- Lesson generation that highlights Hebrew morphology, exegetical notes, and formation practices using curated ETCBC data.
- Editable canvas for introductions, teaching sections, and conclusions.
- Slide overview plus downloadable PowerPoint deck with notes.
- Visualization of exegetical depth and quick links to relevant GitHub/ETCBC sources.

## Getting Started

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open <http://localhost:8000> to use the interface.

## Project Structure

```
app/
  main.py             # FastAPI application
  data/
    etcbc_samples.json
    congregation_calendar.json
static/
  index.html
  styles.css
  app.js
requirements.txt
README.md
```

Generated PowerPoint files are stored in the `generated/` directory.
