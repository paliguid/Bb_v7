import { useMemo } from 'react';
import { CATALOG } from '../lib/catalog.js';
import { GUIDES } from '../lib/guides.js';
import { LESSONS } from '../lib/lessons.js';
import { PartIcon, Icon } from './icons.jsx';
import { Inline } from './richtext.jsx';
import { Anatomy, ColorReader, Formulas, LedCalculator } from './Tools.jsx';

function LessonsTab({ progress, onStart }) {
  const recommended = LESSONS.find((l) => !progress[l.id])?.id;
  return (
    <div className="lesson-grid">
      {LESSONS.map((lesson, i) => {
        const done = !!progress[lesson.id];
        return (
          <article key={lesson.id} className={`lesson-card${done ? ' done' : ''}`}>
            <div className="lc-top">
              <span className="num">{i + 1}</span>
              <span className={`tag ${lesson.level.toLowerCase()}`}>{lesson.level}</span>
              <span className="mins">{lesson.minutes} min</span>
              {lesson.bench === 'pcb' && <span className="tag pcb">PCB</span>}
              {lesson.bench === 'mech' && <span className="tag mech">Mechanical</span>}
              {done && <span className="check" title="Completed">✓</span>}
              {!done && lesson.id === recommended && <span className="rec">Up next</span>}
            </div>
            <h3>{lesson.title}</h3>
            <p>{lesson.summary}</p>
            <ul>{lesson.learn.map((l) => <li key={l}>{l}</li>)}</ul>
            <button className={`btn ${!done && lesson.id === recommended ? 'primary' : ''}`} onClick={() => onStart(lesson.id)}>
              {done ? 'Do it again' : 'Start lesson'}
            </button>
          </article>
        );
      })}
    </div>
  );
}

function GuideTab({ type, onType, onPlace }) {
  const entries = useMemo(() => Object.values(CATALOG).filter((d) => GUIDES[d.id]), []);
  const def = CATALOG[type] ?? entries[0];
  const g = GUIDES[def.id];

  return (
    <div className="guide">
      <nav className="guide-list" aria-label="Components">
        {entries.map((d) => (
          <button key={d.id} aria-current={d.id === def.id} onClick={() => onType(d.id)}>
            <PartIcon type={d.id} size={18} />{d.name}
          </button>
        ))}
      </nav>
      <div className="guide-detail">
        <header>
          <span className="big"><PartIcon type={def.id} size={30} /></span>
          <div>
            <h3>{def.name}</h3>
            <p>{def.group}</p>
          </div>
          {!def.board && <button className="btn primary" onClick={() => onPlace(def.id)}>Add to board</button>}
        </header>
        <h4>What it is</h4>
        <p>{g.what}</p>
        <h4>How to use it</h4>
        <ul>{g.how.map((t) => <li key={t}><Inline text={t} /></li>)}</ul>
        <h4>Watch out for</h4>
        <ul className="warn">{g.watch.map((t) => <li key={t}><Inline text={t} /></li>)}</ul>
        {g.formula && <div className="formula-box">{g.formula}</div>}
      </div>
    </div>
  );
}

function CheatTab() {
  return (
    <div className="cheat">
      <Anatomy />
      <div className="col">
        <LedCalculator />
        <ColorReader />
      </div>
      <Formulas />
    </div>
  );
}

const TABS = [['lessons', 'Lessons'], ['guide', 'Component guide'], ['cheat', 'Cheat sheet']];

export default function LearnHub({ tab, guideType, progress, onTab, onGuideType, onStartLesson, onPlace, onClose }) {
  const finished = LESSONS.filter((l) => progress[l.id]).length;
  return (
    <div className="hub-backdrop" onClick={onClose}>
      <div className="hub glass" role="dialog" aria-modal="true" aria-label="Learn" onClick={(e) => e.stopPropagation()}>
        <div className="hub-head">
          <div>
            <h2>Learn electronics</h2>
            <p>{finished} of {LESSONS.length} lessons complete</p>
          </div>
          <div className="seg">
            {TABS.map(([id, label]) => (
              <button key={id} aria-pressed={tab === id} onClick={() => onTab(id)}>{label}</button>
            ))}
          </div>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close"><Icon.close size={17} /></button>
        </div>
        <div className="hub-body">
          {tab === 'lessons' && <LessonsTab progress={progress} onStart={onStartLesson} />}
          {tab === 'guide' && <GuideTab type={guideType} onType={onGuideType} onPlace={onPlace} />}
          {tab === 'cheat' && <CheatTab />}
        </div>
      </div>
    </div>
  );
}
