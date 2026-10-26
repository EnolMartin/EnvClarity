import { useMemo, useState } from "react";
import { FilterSelect } from "./FilterSelect";
import type { AuditIssue, AuditReport, IssueCode } from "../../../src/core/types.js";
import { displayLabel, EMPTY_FILTERS, filterIssues, FINDINGS_PAGE_SIZE } from "../report/filter";
import type { IssueFilters } from "../report/filter";

const descriptions: Record<IssueCode, { title: string; explanation: string }> = {
  MISSING_VARIABLE: { title: "Missing variable", explanation: "Documented in the selected example, absent from the selected environment." },
  UNDOCUMENTED_VARIABLE: { title: "Undocumented variable", explanation: "Used by a direct reference but not documented in the selected example." },
  EMPTY_VARIABLE: { title: "Empty variable", explanation: "Documented in the selected example, with an empty value in the selected environment. Empty may be intentional." },
  POSSIBLY_UNUSED_VARIABLE: { title: "Possibly unused variable", explanation: "Documented, but no direct reference was found. Unsupported access patterns may still use it; do not delete it automatically." },
  DYNAMIC_REFERENCE: { title: "Dynamic reference", explanation: "This access does not identify a literal variable name. Review the source location manually." },
};

function Finding({ issue }: { readonly issue: AuditIssue }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const references = issue.code === "DYNAMIC_REFERENCE" ? [issue.reference] : issue.references;
  const pages = Math.ceil(references.length / FINDINGS_PAGE_SIZE);
  const description = descriptions[issue.code];
  return (
    <article className="finding">
      <div className="finding-heading">
        <span className={`severity severity-${issue.severity}`}>{issue.severity === "error" ? "! ERROR" : "! WARNING"}</span>
        <h3>{description.title}</h3>
      </div>
      <p className="issue-code">{issue.code}</p>
      {issue.code !== "DYNAMIC_REFERENCE" && <p className="variable-name"><bdi>{displayLabel(issue.name)}</bdi></p>}
      <p>{description.explanation}</p>
      {references.length === 0 ? <p className="section-note">No direct location was recorded.</p> : (
        <details onToggle={event => setOpen(event.currentTarget.open)}>
          <summary>View locations ({references.length})</summary>
          {open && (
            <>
              <ul className="locations">
                {references.slice(page * FINDINGS_PAGE_SIZE, (page + 1) * FINDINGS_PAGE_SIZE).map((reference, index) => (
                  <li key={index}><bdi>{displayLabel(reference.location.path)}</bdi> : {reference.location.line} : {reference.location.column}<span className="location-origin">{reference.origin}</span></li>
                ))}
              </ul>
              {pages > 1 && <nav className="pagination" aria-label={`${description.title} locations`}>
                <button type="button" className="secondary-button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous locations</button>
                <span>Page {page + 1} of {pages}</span>
                <button type="button" className="secondary-button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next locations</button>
              </nav>}
            </>
          )}
        </details>
      )}
    </article>
  );
}

export function Findings({ report }: { readonly report: AuditReport }) {
  const [filters, setFilters] = useState<IssueFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const matches = useMemo(() => filterIssues(report.issues, filters), [report, filters]);
  const pages = Math.max(1, Math.ceil(matches.length / FINDINGS_PAGE_SIZE));
  function update(next: IssueFilters) { setFilters(next); setPage(0); }
  return (
    <section className="empty-state findings" aria-labelledby="findings-title">
      <h2 id="findings-title">Explore findings</h2>
      <div className="filters">
        <FilterSelect<IssueFilters["severity"]> label="Severity" value={filters.severity}
          options={[{ value: "all", label: "All severities" }, { value: "error", label: "Errors" }, { value: "warning", label: "Warnings" }]}
          onChange={severity => update({ ...filters, severity })} />
        <FilterSelect<IssueFilters["code"]> label="Type" value={filters.code}
          options={[{ value: "all", label: "All types" }, ...Object.entries(descriptions).map(([code, item]) => ({ value: code as IssueCode, label: item.title }))]}
          onChange={code => update({ ...filters, code })} />
        <label className="search-label">Search variable or file<input type="search" maxLength={4096} value={filters.query} onChange={event => update({ ...filters, query: event.currentTarget.value })} /></label>
      </div>
      <div className="filter-summary">
        <p role="status">Showing {matches.length} of {report.issues.length} findings</p>
        <button type="button" className="secondary-button" onClick={() => update(EMPTY_FILTERS)}>Reset filters</button>
      </div>
      {matches.length === 0 && <div className="no-matches">
        <h3>No matching findings</h3>
        <p>Try another variable name or source path, change the filters, or reset them to see all findings. The report summary above still includes every finding.</p>
      </div>}
      {matches.length > 0 && <ol className="finding-list" start={page * FINDINGS_PAGE_SIZE + 1}>
        {matches.slice(page * FINDINGS_PAGE_SIZE, (page + 1) * FINDINGS_PAGE_SIZE).map(({ issue, index }) => <li key={index}><Finding issue={issue} /></li>)}
      </ol>}
      {matches.length > 0 && <nav className="pagination" aria-label="Findings pages">
        <button type="button" className="secondary-button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
        <span>Page {page + 1} of {pages}</span>
        <button type="button" className="secondary-button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
      </nav>}
    </section>
  );
}
