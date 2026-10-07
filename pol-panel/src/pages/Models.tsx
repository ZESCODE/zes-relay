import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Tabs } from "@/components/ui/Tabs";
import { Shell } from "@/components/layout/Shell";
import { ModelTable } from "@/components/models/ModelTable";
import { TestAllButton } from "@/components/models/TestAllButton";
import { loadFilter, saveFilter, useModels, type ModelChip } from "@/lib/hooks/useModels";
import type { RelayModel } from "@/lib/types";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function Models() {
  const {
    models,
    loading,
    error,
    run,
    sortByTest,
    refresh,
    bulk,
    reset,
    testAll,
    clearSort,
    enabledModels,
    disabledModels,
  } = useModels();

  const [chip, setChip] = useState<ModelChip>(() => loadFilter());
  const [query, setQuery] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [busyBulk, setBusyBulk] = useState<"enable" | "disable" | null>(null);

  useEffect(() => {
    saveFilter(chip);
  }, [chip]);

  const failing = useMemo(
    () => models.filter((model) => {
      const state = model.last_test;
      return state ? !state.ok : false;
    }),
    [models],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return models.filter((model: RelayModel) => {
      if (needle && !model.id.toLowerCase().includes(needle)) return false;
      switch (chip) {
        case "enabled":
          return model.enabled;
        case "disabled":
          return !model.enabled;
        case "failing":
          return model.last_test ? !model.last_test.ok : false;
        default:
          return true;
      }
    });
  }, [models, chip, query]);

  const runBulk = useCallback(
    async (target: "enable" | "disable") => {
      setBusyBulk(target);
      await bulk(target);
      setBusyBulk(null);
    },
    [bulk],
  );

  // Models-page shortcuts: t = test all, e = enable all, x = disable all.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "t") {
        event.preventDefault();
        if (!run?.active) testAll("sequential");
      } else if (key === "e") {
        event.preventDefault();
        void runBulk("enable");
      } else if (key === "x") {
        event.preventDefault();
        void runBulk("disable");
      } else if (key === "/") {
        event.preventDefault();
        document.getElementById("model-search")?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [run?.active, runBulk, testAll]);

  return (
    <Shell
      title="Models"
      subtitle={`${enabledModels.length} enabled · ${disabledModels.length} disabled`}
      actions={
        <Button
          size="icon"
          variant="ghost"
          onClick={() => void refresh({ force: true })}
          aria-label="Refresh model list"
          title="Refresh from upstream"
        >
          <Icon name="refresh" size={16} />
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Card>
          <CardHeader
            title="Test every model"
            subtitle={
              run?.active
                ? "Results stream in row by row"
                : "Row-by-row mode tests each model in turn; batch mode uses the relay's single test-all call"
            }
          />
          <TestAllButton disabled={models.length === 0} />
          {sortByTest && !run?.active ? (
            <div className="mt-2 flex items-center gap-2 text-xs text-[var(--frost-muted)]">
              <Badge tone="violet">sorted by test result</Badge>
              <button type="button" className="underline hover:text-[var(--frost-text)]" onClick={clearSort}>
                restore upstream order
              </button>
            </div>
          ) : null}
        </Card>

        <Card>
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--frost-muted)]">
                  <Icon name="search" size={16} />
                </span>
                <Input
                  id="model-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter by model id…  ( / )"
                  aria-label="Filter models"
                  className="pl-9"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="success"
                  loading={busyBulk === "enable"}
                  disabled={disabledModels.length === 0}
                  onClick={() => void runBulk("enable")}
                >
                  Enable all
                </Button>
                <Button
                  variant="danger"
                  loading={busyBulk === "disable"}
                  disabled={enabledModels.length === 0}
                  onClick={() => void runBulk("disable")}
                >
                  Disable all
                </Button>
                <Button variant="outline" onClick={() => setConfirmReset(true)}>
                  Reset
                </Button>
              </div>
            </div>

            <Tabs<ModelChip>
              ariaLabel="Model filters"
              value={chip}
              onChange={setChip}
              items={[
                { value: "all", label: "All", count: models.length },
                { value: "enabled", label: "Enabled", count: enabledModels.length },
                { value: "disabled", label: "Disabled", count: disabledModels.length },
                { value: "failing", label: "Failing", count: failing.length },
              ]}
            />
          </div>
        </Card>

        <ModelTable
          models={visible}
          loading={loading}
          error={error}
          emptyState={
            models.length === 0 && !loading && !error
              ? "The relay returned no models. Check POL_UPSTREAM_BASE on the Config page."
              : "No models match this filter."
          }
        />
      </div>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        tone="danger"
        title="Reset to default?"
        description="Every model becomes enabled again and the relay's disabled list is cleared."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await reset();
                setConfirmReset(false);
              }}
            >
              Reset all models
            </Button>
          </>
        }
      >
        <p className="text-[var(--frost-muted)]">
          This calls <span className="font-mono">POST /admin/models/reset</span> on the relay, which
          clears <span className="font-mono">data/models.json</span>.
        </p>
      </Modal>
    </Shell>
  );
}
