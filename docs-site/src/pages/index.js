import React from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import styles from './index.module.css';

const steps = [
  ['01', 'Bring in a source', 'Start from a note, clipping, or PDF. The source stays yours and remains local.'],
  ['02', 'Read a useful slice', 'Resume at your read point instead of trying to finish everything in one sitting.'],
  ['03', 'Keep what matters', 'Turn a strong passage into an extract, then a durable question-and-answer card when useful.'],
  ['04', 'Return at the right time', 'Priority and A-Factor scheduling decide what comes back into the reading queue.'],
];

const releaseHighlights = [
  ['Open first', 'The next note paints before read-point positioning or card-review follow-up work begins.'],
  ['Refresh less', 'Inactive dashboards, queue timelines, and tree views stay quiet while you move between notes.'],
  ['One clear loop', 'Build the queue, open the next element, and grade reading topics. Keep cards in-house or send them to Anki.'],
];

export default function Home() {
  return <Layout title="Read less at once. Remember more over time." description="Beginner-friendly documentation for Incremental Reading Toolkit for Obsidian.">
    <main>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>OBSIDIAN · LOCAL-FIRST · DESKTOP</span>
          <Heading as="h1">Big reading,<br/><em>small returns.</em></Heading>
          <p>Incremental Reading Toolkit turns a pile of long sources into a calm stream of short reading sessions, useful extracts, and recall cards.</p>
          <div className={styles.actions}>
            <Link className="button button--primary button--lg" to="/docs/getting-started/what-is-incremental-reading">Start with the idea</Link>
            <Link className="button button--secondary button--lg" to="/docs/workflows/your-first-session">Run your first session</Link>
          </div>
        </div>
        <div className={styles.heroVisual} aria-label="Source to memory workflow">
          <div className={styles.paper}><i/><i/><i/><i/><i/></div>
          <div className={styles.flowArrow}>→</div>
          <div className={styles.sessionStack}><b/><b/><b/></div>
          <div className={styles.flowArrow}>→</div>
          <div className={styles.cardStack}><b>Q</b><b>A</b></div>
          <span>source → sessions → extracts → memory</span>
        </div>
      </section>

      <section className={styles.release}>
        <div className={styles.releaseHeading}>
          <span className={styles.releaseVersion}>NEW · VERSION 1.1.7</span>
          <Heading as="h2">Greatly faster.<br/>Calm under pressure.</Heading>
          <p>The work that made note switching and grading freeze—or crash on larger vaults—has been removed from the navigation path.</p>
          <Link to="/docs/releases/1.1.7">Read the performance update →</Link>
        </div>
        <div className={styles.releaseGrid}>
          {releaseHighlights.map(([title, body], index) => <article key={title}>
            <span>0{index + 1}</span>
            <Heading as="h3">{title}</Heading>
            <p>{body}</p>
          </article>)}
        </div>
      </section>

      <section className={styles.promise}>
        <p>Incremental reading is not speed-reading.</p>
        <Heading as="h2">It is permission to stop at the useful moment—and a system for knowing where to return.</Heading>
      </section>

      <section className={styles.steps}>
        {steps.map(([number, title, body]) => <article key={number}>
          <span>{number}</span><Heading as="h3">{title}</Heading><p>{body}</p>
        </article>)}
      </section>

      <section className={styles.split}>
        <div><span className={styles.eyebrow}>WHAT THIS PLUGIN DOES</span><Heading as="h2">Two schedules. One learning stream.</Heading></div>
        <div>
          <p><strong>Reading topics</strong>—sources and extracts—are scheduled by the Toolkit with priority and A-Factor.</p>
          <p><strong>Flashcards</strong> are ordinary Markdown cards reviewed in-house or delegated to Anki or Spaced Repetition.</p>
          <Link to="/docs/concepts/mixed-learning">See how the queues work together →</Link>
        </div>
      </section>
    </main>
  </Layout>;
}
