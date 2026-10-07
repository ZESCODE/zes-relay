import { useEffect, useRef } from "react";

/**
 * setInterval as a hook.
 * `pauseWhenHidden` stops the work while the tab is backgrounded — on a phone
 * this is the difference between a dashboard that drains the battery and one
 * that does not.
 */
export function useInterval(callback: () => void, delay: number | null, pauseWhenHidden = true): void {
  const saved = useRef(callback);

  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => saved.current(), delay);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (!pauseWhenHidden) return;
      if (document.hidden) stop();
      else {
        saved.current();
        start();
      }
    };

    if (!(pauseWhenHidden && document.hidden)) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [delay, pauseWhenHidden]);
}
