const wizardForm = document.getElementById('wizard-form');
const steps = Array.from(document.querySelectorAll('.wizard-step'));
const resultsCard = document.getElementById('results');
const lessonTitle = document.getElementById('lesson-title');
const runtimeEl = document.getElementById('runtime');
const introCanvas = document.getElementById('intro-canvas');
const conclusionCanvas = document.getElementById('conclusion-canvas');
const sectionsCanvas = document.getElementById('sections-canvas');
const festivalList = document.getElementById('festival-list');
const congregationContext = document.getElementById('congregation-context');
const githubList = document.getElementById('github-list');
const hebrewFocus = document.getElementById('hebrew-focus');
const slidesList = document.getElementById('slides-list');
const pptxDownload = document.getElementById('pptx-download');
const chartCanvas = document.getElementById('linguistic-chart');

let currentStepIndex = 0;
let linguisticChart = null;

// Everything below that builds markup from the API response passes each value
// through escapeHtml first. The values are mostly curated JSON today, but
// github_sources comes from GitHub's search API and the congregation fields
// from an editable file, so none of it is trusted to be markup.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only web links become hrefs; a javascript: or data: URL would run on click.
function safeUrl(value) {
  try {
    const url = new URL(String(value), window.location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '#';
  } catch {
    return '#';
  }
}

function updateStep(newIndex) {
  if (newIndex < 0 || newIndex >= steps.length) return;
  steps[currentStepIndex].classList.remove('active');
  currentStepIndex = newIndex;
  steps[currentStepIndex].classList.add('active');
}

steps.forEach((step, index) => {
  const nextBtn = step.querySelector('.next');
  const prevBtn = step.querySelector('.prev');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => updateStep(index + 1));
  }
  if (prevBtn) {
    prevBtn.addEventListener('click', () => updateStep(index - 1));
  }
});

async function handleSubmit(event) {
  event.preventDefault();
  const submitBtn = wizardForm.querySelector('[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Generating...';

  const formData = new FormData(wizardForm);
  const payload = Object.fromEntries(formData.entries());
  payload.estimated_minutes = Number(payload.estimated_minutes || 35);
  payload.interpreted = formData.get('interpreted') === 'on';

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const message = await response.json();
      throw new Error(message.detail || 'Unable to generate lesson');
    }

    const data = await response.json();
    renderResults(data);
    resultsCard.classList.remove('hidden');
    window.scrollTo({ top: resultsCard.offsetTop - 40, behavior: 'smooth' });
  } catch (error) {
    alert(error.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Generate Lesson';
  }
}

function renderResults(data) {
  const { lesson, festivals, congregation, github_sources, runtime_minutes, pptx_download } = data;
  lessonTitle.textContent = lesson.title;
  runtimeEl.textContent = `Planned runtime: ${runtime_minutes} minutes`;
  introCanvas.textContent = lesson.introduction;
  conclusionCanvas.textContent = lesson.conclusion;
  hebrewFocus.textContent = `${lesson.hebrew_focus} — ${lesson.morphology.part_of_speech} (root ${lesson.morphology.root}). ${lesson.morphology.notes}`;

  sectionsCanvas.innerHTML = '';
  lesson.sections.forEach((section, index) => {
    const block = document.createElement('div');
    block.className = 'section-block';
    block.innerHTML = `
      <h4>${index + 1}. ${escapeHtml(section.title)}</h4>
      <div class="editable" contenteditable="true">${escapeHtml(section.content)}</div>
      <h5>Exegetical Notes</h5>
      <div class="editable" contenteditable="true">${escapeHtml(section.exegetical.join('\n'))}</div>
      <h5>Formation &amp; Practice</h5>
      <div class="editable" contenteditable="true">${escapeHtml(section.application)}</div>
    `;
    sectionsCanvas.appendChild(block);
  });

  festivalList.innerHTML = '';
  if (festivals.length === 0) {
    festivalList.innerHTML = '<li>No festival correlations within three weeks.</li>';
  } else {
    festivals.forEach((festival) => {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${escapeHtml(festival.festival)}</strong><br/>${escapeHtml(festival.emphasis)}<br/><small>${escapeHtml(festival.days_apart)} day(s) from your date • ${escapeHtml(festival.festival_date)}</small>`;
      festivalList.appendChild(li);
    });
  }

  congregationContext.innerHTML = '';
  if (congregation.name) {
    const heading = document.createElement('p');
    heading.innerHTML = `<strong>${escapeHtml(congregation.name)}</strong> — ${escapeHtml(congregation.location || 'Local context')}`;
    congregationContext.appendChild(heading);
  }
  if (congregation.values && congregation.values.length) {
    const values = document.createElement('p');
    values.textContent = `Values: ${congregation.values.join(', ')}`;
    congregationContext.appendChild(values);
  }
  if (congregation.nearby_events && congregation.nearby_events.length) {
    const list = document.createElement('ul');
    list.className = 'info-list';
    congregation.nearby_events.forEach((event) => {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${escapeHtml(event.description)}</strong><br/><small>${escapeHtml(event.days_apart)} day(s) away • Emphasis: ${escapeHtml(event.emphasis)}</small>`;
      list.appendChild(li);
    });
    congregationContext.appendChild(list);
  } else {
    const empty = document.createElement('p');
    empty.textContent = 'No nearby community events within three weeks.';
    congregationContext.appendChild(empty);
  }

  githubList.innerHTML = '';
  github_sources.forEach((source) => {
    const li = document.createElement('li');
    li.innerHTML = `<a href="${escapeHtml(safeUrl(source.html_url))}" target="_blank" rel="noopener">${escapeHtml(source.name)}</a><br/><small>${escapeHtml(source.repository)}</small>`;
    githubList.appendChild(li);
  });

  slidesList.innerHTML = '';
  lesson.slides.forEach((slide, index) => {
    const card = document.createElement('div');
    card.className = 'slide-card';
    card.innerHTML = `
      <h5>Slide ${index + 1}: ${escapeHtml(slide.title)}</h5>
      <ul>${slide.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
      <p><strong>Speaker Notes:</strong> ${escapeHtml(slide.notes)}</p>
    `;
    slidesList.appendChild(card);
  });

  pptxDownload.href = safeUrl(pptx_download);
  pptxDownload.setAttribute('download', `${lesson.title.replace(/\s+/g, '_')}.pptx`);

  renderChart(lesson);
}

function renderChart(lesson) {
  const exegeticalCounts = lesson.sections.map((section) => section.exegetical.length);
  const labels = lesson.sections.map((section, idx) => `${idx + 1}. ${section.title}`);

  const data = {
    labels,
    datasets: [
      {
        label: 'Exegetical Depth',
        data: exegeticalCounts,
        backgroundColor: 'rgba(234, 179, 8, 0.6)',
        borderColor: 'rgba(234, 179, 8, 1)',
        borderWidth: 1.5,
      },
    ],
  };

  if (linguisticChart) {
    linguisticChart.data = data;
    linguisticChart.update();
  } else {
    linguisticChart = new Chart(chartCanvas, {
      type: 'bar',
      data,
      options: {
        scales: {
          x: {
            ticks: { color: '#e2e8f0' },
            grid: { color: 'rgba(148, 163, 184, 0.2)' },
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#e2e8f0', precision: 0 },
            grid: { color: 'rgba(148, 163, 184, 0.2)' },
          },
        },
        plugins: {
          legend: {
            labels: { color: '#f8fafc' },
          },
        },
      },
    });
  }
}

wizardForm.addEventListener('submit', handleSubmit);
