import {
  createPrompt,
  useState,
  useKeypress,
  usePagination,
  useMemo,
  isUpKey,
  isDownKey,
  isSpaceKey,
  isEnterKey,
  isNumberKey,
  isBackspaceKey,
  Separator,
} from "@inquirer/core";
import type { KeypressEvent } from "@inquirer/core";
import { cursorHide } from "@inquirer/ansi";

export const CHECKBOX_BACK = "__back__" as const;
export type CheckboxBack = typeof CHECKBOX_BACK;

const b = (s: string) => `\x1b[1m${s}\x1b[0m`;
const d = (s: string) => `\x1b[2m${s}\x1b[0m`;
const g = (s: string) => `\x1b[32m${s}\x1b[0m`;
const c = (s: string) => `\x1b[36m${s}\x1b[0m`;
const r = (s: string) => `\x1b[31m${s}\x1b[0m`;

type NormalizedItem<T> = {
  value: T;
  name: string;
  short: string;
  checked: boolean;
  disabled: false | string;
};

type Item<T> = NormalizedItem<T> | Separator;

function isSelectable<T>(item: Item<T>): item is NormalizedItem<T> {
  return !Separator.isSeparator(item) && !item.disabled;
}

function isNavigable<T>(item: Item<T>): boolean {
  return !Separator.isSeparator(item);
}

function isChecked<T>(item: Item<T>): item is NormalizedItem<T> {
  return !Separator.isSeparator(item) && item.checked;
}

function toggle<T>(item: Item<T>): Item<T> {
  return isSelectable(item) ? { ...item, checked: !item.checked } : item;
}

function checkAll<T>(checked: boolean) {
  return (item: Item<T>): Item<T> =>
    isSelectable(item) ? { ...item, checked } : item;
}

function findLastNavigable<T>(items: Item<T>[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (isNavigable(items[i])) return i;
  }
  return 0;
}

function normalizeChoices<T>(
  choices: ReadonlyArray<
    | {
        name?: string;
        value: T;
        checked?: boolean;
        disabled?: boolean | string;
      }
    | Separator
  >,
): Array<Item<T>> {
  return choices.map((choice) => {
    if (Separator.isSeparator(choice)) return choice;
    const name = choice.name ?? String(choice.value);
    return {
      value: choice.value,
      name,
      short: name,
      checked: choice.checked ?? false,
      disabled:
        choice.disabled === true
          ? "(disabled)"
          : ((choice.disabled ?? false) as false | string),
    };
  });
}

function formatHelpTip(keys: [string, string][]): string {
  return keys.map(([k, a]) => `${b(k)} ${d(a)}`).join(d(" • "));
}

export type CheckboxChoice<T> = {
  name?: string;
  value: T;
  checked?: boolean;
  disabled?: boolean | string;
};

export type CheckboxWithBackConfig<T> = {
  message: string;
  choices: ReadonlyArray<CheckboxChoice<T> | Separator>;
  pageSize?: number;
};

const HELP_KEYS: [string, string][] = [
  ["↑↓", "navigate"],
  ["space", "select"],
  ["a", "all"],
  ["i", "invert"],
  ["⏎", "submit"],
  ["⌫", "back"],
  ["⌃x", "exit"],
];

function makeCheckboxWithBack<T>() {
  return createPrompt<T[] | CheckboxBack, CheckboxWithBackConfig<T>>(
    (cfg, done) => {
      const pageSize = cfg.pageSize ?? 7;
      const [status, setStatus] = useState<"idle" | "done">("idle");
      const [items, setItems] = useState<Array<Item<T>>>(
        normalizeChoices(cfg.choices),
      );
      const bounds = useMemo(() => {
        const first = items.findIndex(isNavigable);
        const last = findLastNavigable(items);
        return { first: first === -1 ? 0 : first, last };
      }, [items]);
      const [active, setActive] = useState(bounds.first);
      const [errorMsg, setError] = useState<string | undefined>(undefined);

      useKeypress((key: KeypressEvent) => {
        if (isBackspaceKey(key)) {
          setStatus("done");
          done(CHECKBOX_BACK);
          return;
        }
        if (key.ctrl && key.name === "x") {
          process.exit(0);
        }
        if (isEnterKey(key)) {
          setStatus("done");
          done(items.filter(isChecked).map((ch) => ch.value));
          return;
        }
        if (isUpKey(key) || isDownKey(key)) {
          if (errorMsg) setError(undefined);
          const offset = isUpKey(key) ? -1 : 1;
          let next = active;
          do {
            next = (next + offset + items.length) % items.length;
          } while (!isNavigable(items[next]) && next !== active);
          setActive(next);
          return;
        }
        if (isSpaceKey(key)) {
          const it = items[active];
          if (it && !Separator.isSeparator(it)) {
            if (it.disabled) {
              setError("This option is disabled and cannot be toggled.");
            } else {
              setError(undefined);
              setItems(items.map((x, i) => (i === active ? toggle(x) : x)));
            }
          }
          return;
        }
        if (key.name === "a") {
          const selectAll = items.some((x) => isSelectable(x) && !isChecked(x));
          setItems(items.map(checkAll(selectAll)));
          return;
        }
        if (key.name === "i") {
          setItems(items.map(toggle));
          return;
        }
        if (isNumberKey(key)) {
          const idx = Number(key.name) - 1;
          let selIdx = -1;
          const pos = items.findIndex((x) => {
            if (Separator.isSeparator(x)) return false;
            selIdx++;
            return selIdx === idx;
          });
          const it = items[pos];
          if (it && isSelectable(it)) {
            setActive(pos);
            setItems(items.map((x, i) => (i === pos ? toggle(x) : x)));
          }
        }
      });

      const msg = b(cfg.message);

      if (status === "done") {
        const sel = items.filter(isChecked);
        const answer = d(sel.map((ch) => ch.short).join(", ") || "(none)");
        return `${g("✔")} ${msg} ${answer}`;
      }

      const page = usePagination({
        items,
        active,
        renderItem({ item, isActive }) {
          if (Separator.isSeparator(item)) return ` ${item.separator}`;
          const cursor = isActive ? c("❯") : " ";
          if (item.disabled) {
            const lbl =
              typeof item.disabled === "string" ? item.disabled : "(disabled)";
            const icon = item.checked ? d("◉") : d("-");
            return d(`${cursor}${icon} ${item.name} ${lbl}`);
          }
          const icon = item.checked ? g("●") : "○";
          const name = isActive ? c(item.name) : item.name;
          return `${cursor}${icon} ${name}`;
        },
        pageSize,
        loop: true,
      });

      const lines = [
        `? ${msg}`,
        page,
        errorMsg ? r(`>> ${errorMsg}`) : "",
        formatHelpTip(HELP_KEYS),
      ]
        .filter(Boolean)
        .join("\n")
        .trimEnd();

      return `${lines}${cursorHide}`;
    },
  );
}

export function checkboxWithBack<T>(
  config: CheckboxWithBackConfig<T>,
): Promise<T[] | CheckboxBack> {
  return makeCheckboxWithBack<T>()(config);
}
