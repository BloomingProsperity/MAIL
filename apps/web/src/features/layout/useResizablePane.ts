import { useCallback, useEffect, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

export interface ResizablePaneOptions {
  initialSize: number;
  minSize: number;
  maxSize: number;
  storageKey: string;
  step?: number;
}

export function useResizablePane(options: ResizablePaneOptions) {
  const step = options.step ?? 16;
  const [size, setSize] = useState(() =>
    readStoredSize(options.storageKey, options.initialSize, options),
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(options.storageKey, String(size));
    } catch {
      // Ignore storage failures; resizing should still work for this session.
    }
  }, [options.storageKey, size]);

  const resizeTo = useCallback(
    (nextSize: number) => {
      setSize(clampPaneSize(nextSize, options));
    },
    [options],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startSize = size;

      function onPointerMove(moveEvent: globalThis.PointerEvent) {
        resizeTo(startSize + moveEvent.clientX - startX);
      }

      function stopResize() {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", stopResize);
        window.removeEventListener("pointercancel", stopResize);
      }

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", stopResize);
      window.addEventListener("pointercancel", stopResize);
    },
    [resizeTo, size],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        resizeTo(size - step);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        resizeTo(size + step);
      }
      if (event.key === "Home") {
        event.preventDefault();
        resizeTo(options.minSize);
      }
      if (event.key === "End") {
        event.preventDefault();
        resizeTo(options.maxSize);
      }
    },
    [options.maxSize, options.minSize, resizeTo, size, step],
  );

  return {
    size,
    separatorProps: {
      role: "separator",
      tabIndex: 0,
      "aria-orientation": "vertical" as const,
      "aria-valuemin": options.minSize,
      "aria-valuemax": options.maxSize,
      "aria-valuenow": size,
      onKeyDown,
      onPointerDown,
    },
  };
}

function readStoredSize(
  storageKey: string,
  fallback: number,
  options: Pick<ResizablePaneOptions, "minSize" | "maxSize">,
) {
  try {
    const stored = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(stored) ? clampPaneSize(stored, options) : fallback;
  } catch {
    return fallback;
  }
}

function clampPaneSize(
  size: number,
  options: Pick<ResizablePaneOptions, "minSize" | "maxSize">,
) {
  return Math.min(options.maxSize, Math.max(options.minSize, Math.round(size)));
}
