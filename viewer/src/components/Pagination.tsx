import { useEffect, useRef } from "react";

interface Props {
  readonly page: number;
  readonly pages: number;
  readonly label: string;
  readonly onChange: (page: number) => void;
  readonly previousLabel?: string;
  readonly nextLabel?: string;
}

/** Keep keyboard focus usable when reaching either end disables the activated button. */
export function Pagination({ page, pages, label, onChange, previousLabel = "Previous", nextLabel = "Next" }: Props) {
  const previous = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const activated = useRef<"previous" | "next" | null>(null);

  useEffect(() => {
    if (activated.current === "previous" && previous.current?.disabled) next.current?.focus();
    if (activated.current === "next" && next.current?.disabled) previous.current?.focus();
    activated.current = null;
  }, [page]);

  return (
    <nav className="pagination" aria-label={label}>
      <button ref={previous} type="button" className="secondary-button" disabled={page === 0} onClick={() => {
        activated.current = "previous";
        onChange(page - 1);
      }}>{previousLabel}</button>
      <span role="status" aria-atomic="true">Page {page + 1} of {pages}</span>
      <button ref={next} type="button" className="secondary-button" disabled={page + 1 >= pages} onClick={() => {
        activated.current = "next";
        onChange(page + 1);
      }}>{nextLabel}</button>
    </nav>
  );
}
