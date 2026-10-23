export function App() {
  return (
    <div className="viewer">
      <header className="viewer-header">
        <span className="brand">EnvClarity</span>
        <span className="viewer-label">Local report viewer</span>
      </header>
      <main>
        <p className="eyebrow">Your audit, at a glance</p>
        <h1>A clearer view of your environment.</h1>
        <p className="intro">
          Explore the findings from an EnvClarity audit in one place.
        </p>
        <section className="empty-state" aria-labelledby="setup-title">
          <span className="status">In development</span>
          <h2 id="setup-title">Report import is coming next</h2>
          <p>
            This is the starting point for the viewer. You cannot open reports
            here yet. Use the CLI to run audits and read their results.
          </p>
        </section>
      </main>
      <footer>Built for local audit reports.</footer>
    </div>
  );
}
