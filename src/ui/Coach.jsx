import { useState } from 'react';
import { Icon } from './icons.jsx';
import { Inline } from './richtext.jsx';

function Quiz({ quiz, done, onCorrect }) {
  const [picked, setPicked] = useState(null);
  const [wrong, setWrong] = useState([]);

  const choose = (i) => {
    if (done) return;
    setPicked(i);
    if (i === quiz.answer) onCorrect();
    else setWrong((w) => (w.includes(i) ? w : [...w, i]));
  };

  return (
    <div className="quiz">
      <p className="q"><Inline text={quiz.question} /></p>
      <div className="opts" role="group">
        {quiz.options.map((opt, i) => {
          const isRight = done && i === quiz.answer;
          const isWrong = wrong.includes(i) && !done;
          return (
            <button
              key={opt}
              className={`opt${isRight ? ' right' : ''}${isWrong ? ' wrong' : ''}`}
              aria-pressed={picked === i}
              onClick={() => choose(i)}
            >
              <span className="mark">{isRight ? '✓' : isWrong ? '✕' : String.fromCharCode(65 + i)}</span>
              <span><Inline text={opt} /></span>
            </button>
          );
        })}
      </div>
      {wrong.length > 0 && !done && <p className="nudge">Not quite — have another go.</p>}
      {done && <p className="why"><Inline text={quiz.why} /></p>}
    </div>
  );
}

function StepView({ step, done, onDone }) {
  const [hint, setHint] = useState(false);
  const isCheck = !!step.check;
  const isQuiz = !!step.quiz;

  return (
    <>
      <h3>{step.title}</h3>
      <p className="lesson-body"><Inline text={step.body} /></p>

      {isQuiz && <Quiz quiz={step.quiz} done={done} onCorrect={onDone} />}

      {isCheck && (
        <div className={`status-line${done ? ' ok' : ''}`} role="status">
          {done
            ? <><span className="tick">✓</span> Nice work — that’s it.</>
            : <><span className="pulse" /> Waiting for you to try it…</>}
        </div>
      )}

      {isCheck && !done && step.hint && (
        hint
          ? <p className="hint-box"><Inline text={step.hint} /></p>
          : <button className="link" onClick={() => setHint(true)}>Stuck? Show a hint</button>
      )}

      {!isCheck && !isQuiz && !done && (
        <button className="btn primary" onClick={onDone}>Got it</button>
      )}
    </>
  );
}

export default function Coach({
  lesson, stepIndex, done, finished, nextLesson,
  onDone, onNext, onBack, onExit, onSolution, onHub, onStartLesson,
}) {
  const [confirm, setConfirm] = useState(false);
  const total = lesson.steps.length;
  const step = lesson.steps[stepIndex];

  return (
    <aside className="panel coach glass" aria-label="Lesson">
      <div className="panel-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="eyebrow">{lesson.level} · Lesson</p>
          <h2>{lesson.title}</h2>
        </div>
        <button className="btn icon ghost" onClick={onExit} aria-label="Leave lesson" title="Leave lesson"><Icon.close size={17} /></button>
      </div>

      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={finished ? total : stepIndex}>
        {lesson.steps.map((s, i) => (
          <i key={s.title} className={finished || i < stepIndex ? 'done' : i === stepIndex ? 'now' : ''} />
        ))}
      </div>

      <div className="body">
        {finished ? (
          <>
            <h3>Lesson complete 🎉</h3>
            <p className="lesson-body">You now know how to:</p>
            <ul className="recap">{lesson.learn.map((l) => <li key={l}>{l}</li>)}</ul>
            <div className="coach-actions">
              {nextLesson && <button className="btn primary" onClick={() => onStartLesson(nextLesson.id)}>Next: {nextLesson.title}</button>}
              <button className="btn" onClick={onHub}>All lessons</button>
              <button className="btn ghost" onClick={onExit}>Keep experimenting</button>
            </div>
          </>
        ) : (
          <>
            <p className="step-count">Step {stepIndex + 1} of {total}</p>
            <StepView key={`${lesson.id}:${stepIndex}`} step={step} done={done} onDone={onDone} />
            <div className="coach-actions">
              <button className="btn ghost" onClick={onBack} disabled={stepIndex === 0}>Back</button>
              <button className="btn primary" onClick={onNext} disabled={!done}>
                {stepIndex === total - 1 ? 'Finish' : 'Next'}
              </button>
            </div>
            {lesson.solution && (
              confirm ? (
                <div className="confirm">
                  Replace your circuit with the finished one?
                  <span>
                    <button className="link" onClick={() => { setConfirm(false); onSolution(); }}>Yes, show me</button>
                    <button className="link" onClick={() => setConfirm(false)}>Cancel</button>
                  </span>
                </div>
              ) : (
                <button className="link" onClick={() => setConfirm(true)}>Show me the finished circuit</button>
              )
            )}
          </>
        )}
      </div>
    </aside>
  );
}
