import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

interface Props<Value extends string> {
  readonly label: string;
  readonly value: Value;
  readonly options: readonly { readonly value: Value; readonly label: string }[];
  readonly onChange: (value: Value) => void;
}

export function FilterSelect<Value extends string>({ label, value, options, onChange }: Props<Value>) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const optionElements = useRef<(HTMLLIElement | null)[]>([]);
  const search = useRef({ text: "", time: 0 });
  const [open, setOpen] = useState(false);
  const selected = Math.max(0, options.findIndex(option => option.value === value));
  const [active, setActive] = useState(selected);

  useEffect(() => {
    if (open) optionElements.current[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;

    function handleOutsideClick(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        search.current.text = "";
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handleOutsideClick);
    return () => document.removeEventListener("pointerdown", handleOutsideClick);
  }, [open]);

  function close() {
    search.current.text = "";
    setOpen(false);
  }

  function choose(index: number) {
    const option = options[index];
    if (option !== undefined) onChange(option.value);
    close();
  }

  function searchOptions(key: string) {
    const now = Date.now();
    const previous = now - search.current.time < 700 ? search.current.text : "";
    const text = previous + key.toLowerCase();
    search.current = { text, time: now };

    // Repeated letters cycle through matching options instead of building a word.
    const repeated = [...text].every(character => character === text[0]);
    const query = repeated ? text[0]! : text;
    const start = repeated ? (open ? active : selected) + 1 : 0;
    for (let offset = 0; offset < options.length; offset++) {
      const index = (start + offset) % options.length;
      if (options[index]!.label.toLowerCase().startsWith(query)) {
        setActive(index);
        break;
      }
    }
    setOpen(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const { key } = event;
    if (key === "Tab") {
      if (open) choose(active);
      return;
    }
    if (key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      if (open) choose(active);
      else {
        search.current.text = "";
        setActive(selected);
        setOpen(true);
      }
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) {
      event.preventDefault();
      if (key === "ArrowUp" && event.altKey && open) {
        choose(active);
        return;
      }

      let next = selected;
      if (key === "Home") next = 0;
      else if (key === "End") next = options.length - 1;
      else if (open) {
        const step = key === "ArrowDown" ? 1 : -1;
        next = Math.max(0, Math.min(options.length - 1, active + step));
      }
      setActive(next);
      setOpen(true);
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      searchOptions(key);
    }
  }

  return (
    <div className="filter-select" ref={root} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) close();
    }}>
      <span id={`${id}-label`}>{label}</span>
      <button
        type="button"
        className="select-trigger"
        role="combobox"
        aria-labelledby={`${id}-label`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open ? `${id}-option-${active}` : undefined}
        onClick={() => {
          search.current.text = "";
          setActive(selected);
          setOpen(!open);
        }}
        onKeyDown={handleKeyDown}
      >
        <span>{options[selected]?.label}</span>
        <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <ul id={`${id}-list`} className="select-options" role="listbox" aria-labelledby={`${id}-label`}>
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-option-${index}`}
              ref={element => { optionElements.current[index] = element; }}
              role="option"
              aria-selected={option.value === value}
              className={index === active ? "is-active" : undefined}
              onPointerMove={() => setActive(index)}
              onPointerDown={event => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              <span aria-hidden="true">{option.value === value ? "✓" : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
